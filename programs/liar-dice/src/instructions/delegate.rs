use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::state::*;

/// Delegate the game + the caller's own hand to the ER (once per player, after `start_game`).
/// Idempotent: the first caller delegates the shared game, and each caller delegates their own hand.
/// Privacy is set up separately on the ER via `init_hand_permission`; the game stays public.
pub fn delegate(ctx: Context<Delegate>, game_id: u64) -> Result<()> {
    let host_key = ctx.accounts.host.key();
    let game_key = ctx.accounts.game.key();
    let player_key = ctx.accounts.player.key();
    let this_program = crate::id();
    let validator = ctx.accounts.validator.as_ref().map(|v| v.key());

    // Once delegated, the account is owned by the delegation program, not us.
    // So `owner == this_program` means "still on base, not yet delegated" — the guard
    // that makes this idempotent when several players call delegate.
    // Delegate the shared game once (whoever gets here first).
    if ctx.accounts.game.owner == &this_program {
        ctx.accounts.delegate_game(
            &ctx.accounts.player,
            &[GAME_SEED, host_key.as_ref(), game_id.to_le_bytes().as_ref()],
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
    }

    // Same guard for the hand: skip if this player already delegated theirs.
    if ctx.accounts.player_hand.owner == &this_program {
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

#[delegate]
#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct Delegate<'info> {
    /// Any joined player. Signs both delegations.
    #[account(mut)]
    pub player: Signer<'info>,

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
