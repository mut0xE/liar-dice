use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::CreateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::{
    EphemeralMembersArgs, Member, PERMISSION_SEED, TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};

use crate::errors::LiarDiceError;
use crate::state::*;

/// Make the caller's hand private on the ER (once, right after `delegate`).
/// Session-key aware: the permission member is resolved from `authority`, never `signer`.
#[session_auth_or(
    ctx.accounts.authority.key() == ctx.accounts.signer.key(),
    LiarDiceError::Unauthorized
)]
pub fn init_hand_permission(ctx: Context<InitHandPermission>) -> Result<()> {
    // Idempotency guard: a funded permission PDA means it already exists, so bail early.
    if ctx.accounts.permission.lamports() > 0 {
        return Ok(());
    }

    let game_key = ctx.accounts.player_hand.game;
    let player_key = ctx.accounts.player_hand.player;
    let hand_bump = ctx.accounts.player_hand.bump;
    // The hand PDA is both payer and permissioned account, so it must sign via its seeds.
    let signers: &[&[u8]] = &[
        HAND_SEED,
        game_key.as_ref(),
        player_key.as_ref(),
        &[hand_bump],
    ];

    let flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;
    let mut members = vec![Member {
        flags,
        pubkey: player_key,
    }];
    let signer_key = ctx.accounts.signer.key();
    if signer_key != player_key {
        members.push(Member {
            flags,
            pubkey: signer_key,
        });
    }

    CreateEphemeralPermissionCpi {
        payer: ctx.accounts.player_hand.to_account_info(),
        permissioned_account: ctx.accounts.player_hand.to_account_info(),
        permission: ctx.accounts.permission.to_account_info(),
        vault: ctx.accounts.ephemeral_vault.to_account_info(),
        magic_program: ctx.accounts.magic_program.to_account_info(),
        permission_program: ctx.accounts.permission_program.to_account_info(),
        args: EphemeralMembersArgs {
            is_private: true,
            // Owner and their session key may read their own dice. Opponents still cannot.
            members,
        },
    }
    .invoke_signed(&[signers])?;
    Ok(())
}

#[derive(Accounts, Session)]
pub struct InitHandPermission<'info> {
    /// The tx signer: the player's wallet OR a session key for `authority`.
    pub signer: Signer<'info>,

    /// The seat owner (real wallet), not a signer. Used for the hand seeds and as the
    /// permission member.
    /// CHECK: identity only; authorization is enforced by `session_auth_or`.
    pub authority: UncheckedAccount<'info>,

    /// Optional session token proving `signer` may act for `authority`.
    #[session(signer = signer, authority = authority.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,

    /// The caller's own hand (delegated → owned by this program again on the ER).
    /// Seeds tie it to `authority`, so no one can init another player's permission.
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

    /// CHECK: ephemeral rent vault (fixed address), pays permission rent on the ER.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,

    /// CHECK: Magic program (fixed address).
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}
