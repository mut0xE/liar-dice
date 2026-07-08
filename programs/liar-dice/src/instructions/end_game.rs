use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};
use ephemeral_rollups_sdk::anchor::{action, commit};
use ephemeral_rollups_sdk::ephem::{CallHandler, FoldableIntentBuilder, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};

use crate::errors::LiarDiceError;
use crate::state::*;

/// End the game atomically on the ER: commit + undelegate the `Game` and every `PlayerHand`,
/// then run the base-layer `payout` as a post-commit Magic Action so the pot can't be paid against a stale game.
/// Anyone may trigger it; the winner is re-verified in `payout`. Hands to release come in via `remaining_accounts`.
pub fn end_game<'info>(ctx: Context<'_, '_, 'info, 'info, EndGame<'info>>) -> Result<()> {
    let game = &ctx.accounts.game;
    require!(
        game.status == GameStatus::Ended,
        LiarDiceError::BadGameState
    );

    // The last active player is the winner; the passed `winner` account must match.
    let winner_idx = game.winner_index().ok_or(LiarDiceError::NoWinner)?;
    require_keys_eq!(
        ctx.accounts.winner.key(),
        game.players[winner_idx as usize],
        LiarDiceError::Unauthorized
    );

    // Accounts to commit + undelegate: the game plus every hand from `remaining_accounts`.
    let game_key = ctx.accounts.game.key();
    let mut to_undelegate: Vec<AccountInfo<'info>> =
        Vec::with_capacity(1 + ctx.remaining_accounts.len());
    to_undelegate.push(ctx.accounts.game.to_account_info());

    for hand_ai in ctx.remaining_accounts.iter() {
        // try_from checks owner + discriminator, so this is a real hand of ours.
        let hand: Account<PlayerHand> = Account::try_from(hand_ai)?;

        // Must belong to this game.
        require_keys_eq!(hand.game, game_key, LiarDiceError::Unauthorized);

        // Must be the canonical hand PDA for its player (blocks look-alikes).
        let (expected, _) = Pubkey::find_program_address(
            &[HAND_SEED, game_key.as_ref(), hand.player.as_ref()],
            &crate::ID,
        );
        require_keys_eq!(hand_ai.key(), expected, LiarDiceError::Unauthorized);

        // The player must be seated in this game.
        require!(
            game.players.contains(&hand.player),
            LiarDiceError::Unauthorized
        );

        to_undelegate.push(hand_ai.clone());
    }

    // The base-layer instruction the Magic program runs after commit; account order mirrors the `Payout` context.
    // `#[action]` appends `escrow_auth` + `escrow` to the `Payout` struct, so we must supply their
    // metas here (right after the declared fields) or the action fails with NotEnoughAccountKeys.
    let escrow_authority_key = ctx.accounts.caller.key();
    let escrow_pda = Pubkey::find_program_address(
        &[b"balance", escrow_authority_key.as_ref(), &[255u8]],
        &ephemeral_rollups_sdk::cpi::DELEGATION_PROGRAM_ID,
    )
    .0;

    let payout_ix_data = anchor_lang::InstructionData::data(&crate::instruction::Payout {});
    let payout = CallHandler {
        destination_program: crate::ID,
        accounts: vec![
            ShortAccountMeta {
                pubkey: ctx.accounts.game.key(),
                is_writable: true,
            },
            ShortAccountMeta {
                pubkey: ctx.accounts.vault.key(),
                is_writable: true,
            },
            ShortAccountMeta {
                pubkey: ctx.accounts.winner.key(),
                is_writable: true,
            },
            ShortAccountMeta {
                pubkey: ctx.accounts.system_program.key(),
                is_writable: false,
            },
            // [4] escrow_auth — appended by #[action]
            ShortAccountMeta {
                pubkey: escrow_authority_key,
                is_writable: true,
            },
            // [5] escrow — appended by #[action]
            ShortAccountMeta {
                pubkey: escrow_pda,
                is_writable: true,
            },
        ],
        args: ActionArgs::new(payout_ix_data),
        // Caller pays the base-layer action fee from its escrow.
        escrow_authority: ctx.accounts.caller.to_account_info(),
        compute_units: 200_000,
    };

    MagicIntentBundleBuilder::new(
        ctx.accounts.caller.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&to_undelegate)
    .add_post_commit_actions([payout])
    .build_and_invoke()?;

    Ok(())
}

/// ER-side accounts for the commit-and-undelegate + payout. `#[commit]` injects `magic_context`/`magic_program`.
#[commit]
#[derive(Accounts)]
pub struct EndGame<'info> {
    /// Anyone may trigger this; also the ER payer and escrow authority for the `payout` action.
    #[account(mut)]
    pub caller: Signer<'info>,

    /// The finished game, delegated on the ER. Committed + undelegated here.
    #[account(mut)]
    pub game: Account<'info, Game>,

    /// CHECK: the game's vault PDA; referenced only for its key here (the actual
    /// lamport transfer happens in the base-layer `payout` action). Not `mut`:
    /// it's a non-delegated base-layer account, so marking it writable on the ER
    /// would trip `InvalidWritableAccount`.
    #[account(seeds = [VAULT_SEED, game.key().as_ref()], bump)]
    pub vault: SystemAccount<'info>,

    /// CHECK: verified against game.players[winner_idx] here and again in `payout`.
    pub winner: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Base-layer payout run by the Magic program after the `Game` is committed (never called directly).
/// Pays the whole pot to the winner.
pub fn payout(ctx: Context<Payout>) -> Result<()> {
    // `game` arrives unchecked (it was delegated), so deserialize it by hand.
    let game_info = ctx.accounts.game.to_account_info();
    let mut game: Game = {
        let data = game_info.try_borrow_data()?;
        Game::try_deserialize(&mut &data[..])?
    };

    // Confirm this is the canonical game PDA for its (host, game_id).
    let (expected_game, _) = Pubkey::find_program_address(
        &[
            GAME_SEED,
            game.host.as_ref(),
            game.game_id.to_le_bytes().as_ref(),
        ],
        &crate::ID,
    );
    require_keys_eq!(expected_game, game_info.key(), LiarDiceError::Unauthorized);

    require!(
        game.status == GameStatus::Ended,
        LiarDiceError::BadGameState
    );

    // Re-verify the winner against the committed game state (the account list is untrusted).
    let winner_idx = game.winner_index().ok_or(LiarDiceError::NoWinner)?;
    require_keys_eq!(
        ctx.accounts.winner.key(),
        game.players[winner_idx as usize],
        LiarDiceError::Unauthorized
    );

    // The vault is a PDA, so the program signs for it with its seeds.
    let game_key = game_info.key();
    let vault_bump = ctx.bumps.vault;
    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, game_key.as_ref(), &[vault_bump]]];

    // The winner takes the whole pot.
    let winner_payout = game.pot_lamports;

    // Send the pot to the winner.
    if winner_payout > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.winner.to_account_info(),
                },
                signer_seeds,
            ),
            winner_payout,
        )?;
    }

    // Persist the emptied pot, but only while the account is undelegated back to us.
    game.pot_lamports = 0;
    if ctx.accounts.game.owner == &crate::ID {
        game.try_serialize(&mut &mut ctx.accounts.game.try_borrow_mut_data()?[..])?;
    }
    Ok(())
}

/// Accounts for the payout action; `#[action]` appends `escrow_auth`/`escrow`. Field order must match `end_game`.
#[action]
#[derive(Accounts)]
pub struct Payout<'info> {
    /// CHECK: was delegated on the ER — its PDA and data are verified manually in
    /// the handler (`GAME_SEED` derivation + `Game::try_deserialize` + status/winner checks).
    #[account(mut)]
    pub game: UncheckedAccount<'info>,

    /// CHECK: vault was never delegated — safe to constrain normally. Holds the pot.
    #[account(mut, seeds = [VAULT_SEED, game.key().as_ref()], bump)]
    pub vault: SystemAccount<'info>,

    /// CHECK: verified against game.players[winner_idx] in the handler.
    #[account(mut)]
    pub winner: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}
