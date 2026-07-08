use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::errors::LiarDiceError;
use crate::state::*;

/// Refund everyone if the game never started.
/// Pass every player's wallet in `remaining_accounts` in the same order as game.players.
pub fn cancel_game<'info>(ctx: Context<'_, '_, '_, 'info, CancelGame<'info>>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    require!(game.status == GameStatus::Waiting, LiarDiceError::BadGameState);

    let player_count = game.players.len();
    require!(
        ctx.remaining_accounts.len() == player_count,
        LiarDiceError::MissingHand
    );

    let game_key = game.key();
    let vault_bump = ctx.bumps.vault;
    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, game_key.as_ref(), &[vault_bump]]];

    // Each player paid exactly one entry fee on join, so that's what we refund.
    let refund_per_player = game.entry_fee_lamports;

    for player_idx in 0..player_count {
        let player_account = &ctx.remaining_accounts[player_idx];
        require_keys_eq!(
            *player_account.key,
            game.players[player_idx],
            LiarDiceError::Unauthorized
        );

        if refund_per_player > 0 {
            system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: player_account.clone(),
                    },
                    signer_seeds,
                ),
                refund_per_player,
            )?;
        }
    }

    game.pot_lamports = 0;
    game.status = GameStatus::Ended;
    Ok(())
}

#[derive(Accounts)]
pub struct CancelGame<'info> {
    /// Only the host may cancel their own game (enforced by `has_one`).
    pub host: Signer<'info>,

    /// The game to cancel. Must still be in `Waiting`.
    #[account(mut, has_one = host @ LiarDiceError::Unauthorized)]
    pub game: Account<'info, Game>,

    /// The game's vault PDA that entry fees are refunded from.
    #[account(mut, seeds = [VAULT_SEED, game.key().as_ref()], bump)]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}
