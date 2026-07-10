use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::state::*;

/// Delegate the CALLER'S OWN hand to the ER. Called once per player, in the SAME tx
/// as `join_game` (which `init`s the hand a beat earlier). The game PDA stays on base
/// so more players can still join; only the hand moves to the ER here.
///
/// Idempotent: `owner == this_program` means "still on base, not yet delegated". On a
/// resume the hand is already owned by the delegation program, so we skip and the tx
/// is a harmless no-op (build the tx conditionally on the client to avoid the popup).
pub fn delegate_hand(ctx: Context<DelegateHand>, game_id: u64) -> Result<()> {
    let _ = game_id; // part of the derived game seed; bound via the accounts struct.
    let game_key = ctx.accounts.game.key();
    let player_key = ctx.accounts.player.key();
    let validator = ctx.accounts.validator.as_ref().map(|v| v.key());

    if ctx.accounts.player_hand.owner == &crate::id() {
        ctx.accounts.delegate_player_hand(
            &ctx.accounts.player,
            &[HAND_SEED, game_key.as_ref(), player_key.as_ref()],
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
    }
    Ok(())
}

/// Delegate the shared Game PDA to the ER. Host-only, called once in the SAME tx as
/// `start_game`. Hands are already delegated (at join); this moves the game so the
/// round loop (roll/bid/challenge/settle) can run on the ER.
pub fn delegate_game(ctx: Context<DelegateGame>, game_id: u64) -> Result<()> {
    let host_key = ctx.accounts.host.key();
    let validator = ctx.accounts.validator.as_ref().map(|v| v.key());

    if ctx.accounts.game.owner == &crate::id() {
        ctx.accounts.delegate_game(
            &ctx.accounts.payer,
            &[GAME_SEED, host_key.as_ref(), game_id.to_le_bytes().as_ref()],
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
    }
    Ok(())
}

#[delegate]
#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct DelegateHand<'info> {
    /// The joining player; signs the delegation of their own hand.
    #[account(mut)]
    pub player: Signer<'info>,

    /// CHECK: only the host's key is used to derive the game PDA seeds; not a signer.
    pub host: UncheckedAccount<'info>,

    /// CHECK: the Game PDA. Read-only here (still on base while players join); used to
    /// derive the hand seeds. NOT delegated by this instruction.
    #[account(
        seeds = [GAME_SEED, host.key().as_ref(), game_id.to_le_bytes().as_ref()],
        bump
    )]
    pub game: UncheckedAccount<'info>,

    /// CHECK: the caller's own PlayerHand PDA. `del` adds its delegation accounts + `delegate_player_hand()`.
    #[account(
        mut,
        del,
        seeds = [HAND_SEED, game.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub player_hand: UncheckedAccount<'info>,

    /// CHECK: optional target validator (needed to land on a specific TEE for PER).
    pub validator: Option<UncheckedAccount<'info>>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct DelegateGame<'info> {
    /// Whoever pays for the delegation (the host, in the start_game tx).
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: only the host's key is used to derive the game PDA seeds; not a signer.
    pub host: UncheckedAccount<'info>,

    /// CHECK: the Game PDA. `del` adds its delegation accounts + `delegate_game()`.
    #[account(
        mut,
        del,
        seeds = [GAME_SEED, host.key().as_ref(), game_id.to_le_bytes().as_ref()],
        bump
    )]
    pub game: UncheckedAccount<'info>,

    /// CHECK: optional target validator (needed to land on a specific TEE for PER).
    pub validator: Option<UncheckedAccount<'info>>,
}
