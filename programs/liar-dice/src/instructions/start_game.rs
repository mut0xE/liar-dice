use anchor_lang::prelude::*;

use crate::errors::LiarDiceError;
use crate::state::*;

/// Host-only: move a `Waiting` table into play. Requires at least two players.
/// Flips the game to `Active`, opens round 1, and gives seat 0 the first move.
pub fn start_game(ctx: Context<StartGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Can only start a table that is still open and has enough players.
    require!(game.status == GameStatus::Waiting, LiarDiceError::BadGameState);
    require!(game.players.len() >= 2, LiarDiceError::NotEnoughPlayers);

    game.status = GameStatus::Active;
    game.round = 1;
    game.current_turn = 0;
    // Seat 0 now owes the first move (roll -> bid); start their clock.
    game.arm_deadline(Clock::get()?.unix_timestamp);
    Ok(())
}

#[derive(Accounts)]
pub struct StartGame<'info> {
    /// Only the host who created the table may start it.
    pub host: Signer<'info>,

    /// The game being started; `has_one` ties it to the host.
    #[account(mut, has_one = host @ LiarDiceError::Unauthorized)]
    pub game: Account<'info, Game>,
}
