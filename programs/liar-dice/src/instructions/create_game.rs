use anchor_lang::prelude::*;

use crate::errors::LiarDiceError;
use crate::state::*;

/// Create a new game table in `Waiting`. `game_id` is host-chosen (part of the PDA seeds);
/// `entry_fee` is the per-player buy-in (0 = free); `timeout_grace` is the seconds each player
/// gets to make a pending move before `force_timeout` can evict them.
pub fn create_game(
    ctx: Context<CreateGame>,
    game_id: u64,
    entry_fee: u64,
    timeout_grace: i64,
) -> Result<()> {
    // A non-positive grace period would make every move instantly time out.
    require!(timeout_grace > 0, LiarDiceError::InvalidTimeout);

    // Initialize the table empty; players and pot fill in as they join.
    ctx.accounts.game.set_inner(Game {
        host: ctx.accounts.host.key(),
        game_id,
        status: GameStatus::Waiting,
        players: Vec::new(),
        dice_counts: Vec::new(),
        is_active: Vec::new(),
        current_turn: 0,
        round: 0,
        current_bid: None,
        last_loser: 0,
        challenger: 0,
        last_reveal: Vec::new(),
        entry_fee_lamports: entry_fee,
        pot_lamports: 0, // grows as players join
        phase: RoundPhase::Rolling, // meaningful only once Active
        participating: Vec::new(),
        missed_rolls: Vec::new(),
        timeout_grace,
        action_deadline: 0, // armed once the game starts
        bump: ctx.bumps.game,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreateGame<'info> {
    /// The player creating the table. Pays rent for the game account.
    #[account(mut)]
    pub host: Signer<'info>,

    /// The game state account, a PDA unique to (host, game_id).
    #[account(
        init,
        payer = host,
        space = Game::SPACE,
        seeds = [GAME_SEED, host.key().as_ref(), game_id.to_le_bytes().as_ref()],
        bump
    )]
    pub game: Account<'info, Game>,

    pub system_program: Program<'info, System>,
}
