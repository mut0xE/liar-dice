use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::CloseEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::PERMISSION_SEED;
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};

use crate::errors::LiarDiceError;
use crate::state::*;

/// Close the caller's hand permission on the ER, refunding its rent back to the hand
/// PDA. Must run BEFORE `end_game` commits + undelegates the hand — once the hand
/// leaves the ER, this permission is no longer reachable by any instruction. Callers
/// (frontend) should fire this as soon as a player is eliminated, or right before the
/// host calls `end_game` for the last standing round.
#[session_auth_or(
    ctx.accounts.authority.key() == ctx.accounts.signer.key(),
    LiarDiceError::Unauthorized
)]
pub fn close_hand_permission(ctx: Context<CloseHandPermission>) -> Result<()> {
    // Idempotency guard: nothing to close if it was never created (or already closed).
    if ctx.accounts.permission.lamports() == 0 {
        return Ok(());
    }

    let game_key = ctx.accounts.player_hand.game;
    let player_key = ctx.accounts.player_hand.player;
    let hand_bump = ctx.accounts.player_hand.bump;
    let signers: &[&[u8]] = &[
        HAND_SEED,
        game_key.as_ref(),
        player_key.as_ref(),
        &[hand_bump],
    ];

    CloseEphemeralPermissionCpi {
        payer: ctx.accounts.player_hand.to_account_info(),
        permissioned_account: ctx.accounts.player_hand.to_account_info(),
        permission: ctx.accounts.permission.to_account_info(),
        vault: ctx.accounts.ephemeral_vault.to_account_info(),
        magic_program: ctx.accounts.magic_program.to_account_info(),
        permission_program: ctx.accounts.permission_program.to_account_info(),
        authority: ctx.accounts.player_hand.to_account_info(),
        authority_is_signer: false, // the hand PDA signs via the seeds above
    }
    .invoke_signed(&[signers])?;
    Ok(())
}

#[derive(Accounts, Session)]
pub struct CloseHandPermission<'info> {
    /// The tx signer: the player's wallet OR a session key for `authority`.
    pub signer: Signer<'info>,

    /// The seat owner (real wallet), not a signer. Used for the hand seeds.
    /// CHECK: identity only; authorization is enforced by `session_auth_or`.
    pub authority: UncheckedAccount<'info>,

    /// Optional session token proving `signer` may act for `authority`.
    #[session(signer = signer, authority = authority.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,

    /// The caller's own hand (delegated → owned by this program again on the ER).
    #[account(
        mut,
        seeds = [HAND_SEED, player_hand.game.as_ref(), authority.key().as_ref()],
        bump = player_hand.bump,
    )]
    pub player_hand: Account<'info, PlayerHand>,

    /// CHECK: the ephemeral permission PDA for this hand; verified by the program.
    #[account(
        mut,
        seeds = [PERMISSION_SEED, player_hand.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID,
    )]
    pub permission: UncheckedAccount<'info>,

    /// CHECK: MagicBlock permission program (fixed address).
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,

    /// CHECK: ephemeral rent vault (fixed address), receives back the permission rent.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,

    /// CHECK: Magic program (fixed address).
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}
