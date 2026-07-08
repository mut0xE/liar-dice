use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::CreateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::{
    EphemeralMembersArgs, Member, PERMISSION_SEED, TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};

use crate::errors::LiarDiceError;
use crate::state::*;

/// Make the caller's hand private on the ER (once, right after `delegate`).
/// Creates an owner-only ephemeral permission so opponents can't read the dice.
/// The hand PDA pays (from rent pre-funded in `join_game`); idempotent if it already exists.
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

    CreateEphemeralPermissionCpi {
        payer: ctx.accounts.player_hand.to_account_info(),
        permissioned_account: ctx.accounts.player_hand.to_account_info(),
        permission: ctx.accounts.permission.to_account_info(),
        vault: ctx.accounts.ephemeral_vault.to_account_info(),
        magic_program: ctx.accounts.magic_program.to_account_info(),
        permission_program: ctx.accounts.permission_program.to_account_info(),
        args: EphemeralMembersArgs {
            is_private: true,
            // Owner may read their own dice (logs / message / balances).
            members: vec![Member {
                flags: TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG,
                pubkey: player_key,
            }],
        },
    }
    .invoke_signed(&[signers])?;
    Ok(())
}

#[derive(Accounts)]
pub struct InitHandPermission<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    /// The caller's own hand (delegated → owned by this program again on the ER).
    #[account(
        mut,
        seeds = [HAND_SEED, player_hand.game.as_ref(), player.key().as_ref()],
        bump = player_hand.bump,
        has_one = player @ LiarDiceError::Unauthorized,
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
