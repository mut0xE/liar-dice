use anchor_lang::prelude::*;

use crate::errors::LiarDiceError;
use crate::state::*;

/// Reclaim a hand's rent once the game is over. Permissionless — anyone may trigger the
/// cleanup, but the rent always returns to the hand's owner (`close = player`).
///
/// Only works after `end_game` has committed + undelegated the hands back to base: a
/// still-delegated hand is owned by the delegation program, so `Account<PlayerHand>`
/// deserialization fails and this can't run. The `Ended` check is a second guard.
pub fn close_hand(ctx: Context<CloseHand>) -> Result<()> {
    require!(
        ctx.accounts.game.status == GameStatus::Ended,
        LiarDiceError::BadGameState
    );
    Ok(())
}

#[derive(Accounts)]
pub struct CloseHand<'info> {
    /// Anyone may trigger cleanup; they don't receive the rent.
    pub caller: Signer<'info>,

    /// The finished game (must be `Ended` and undelegated back to base).
    pub game: Account<'info, Game>,

    /// The rent recipient — must be the hand's owner (enforced by `has_one` below).
    #[account(mut)]
    pub player: SystemAccount<'info>,

    /// The hand to close; rent goes to `player`. Seeds + `has_one` tie it to (game, player).
    #[account(
        mut,
        close = player,
        seeds = [HAND_SEED, game.key().as_ref(), player.key().as_ref()],
        bump = player_hand.bump,
        has_one = player @ LiarDiceError::Unauthorized,
        has_one = game @ LiarDiceError::Unauthorized,
    )]
    pub player_hand: Account<'info, PlayerHand>,
}
