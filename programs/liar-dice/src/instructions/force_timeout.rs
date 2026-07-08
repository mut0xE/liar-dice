use anchor_lang::prelude::*;
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};

use crate::errors::LiarDiceError;
use crate::logic::next_active_player;
use crate::state::*;

/// Liveness escape hatch: evict the `current_turn` player once they stall past the deadline.
/// Permissionless — anyone (or a session key) may fire it; reveal-stalls go through `settle_round`.
/// The staller is forfeited; the game ends if one player remains, else the round resets.
#[session_auth_or(
    ctx.accounts.authority.key() == ctx.accounts.signer.key(),
    LiarDiceError::Unauthorized
)]
pub fn force_timeout(ctx: Context<ForceTimeout>, target: Pubkey) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let game = &mut ctx.accounts.game;

    require!(game.status == GameStatus::Active, LiarDiceError::BadGameState);
    // A deadline of 0 means nothing is currently owed.
    require!(game.action_deadline != 0, LiarDiceError::BadGameState);
    require!(now > game.action_deadline, LiarDiceError::DeadlineNotReached);

    let idx = game
        .player_index(&target)
        .ok_or(LiarDiceError::Unauthorized)?;
    require!(game.is_active[idx as usize], LiarDiceError::Eliminated);

    // Reveal-stalling is handled by `settle_round` (it slashes every non-revealer and
    // settles the bid); `force_timeout` only covers a player stalling on their turn.
    require!(!game.awaiting_reveal, LiarDiceError::BadGameState);
    require!(game.current_turn == idx, LiarDiceError::NotStalling);

    // Forfeit the staller entirely and wipe the in-flight round.
    game.is_active[idx as usize] = false;
    game.dice_counts[idx as usize] = 0;
    game.last_loser = idx;
    game.awaiting_reveal = false;
    game.current_bid = None;
    game.last_reveal.clear();

    if game.active_count() <= 1 {
        game.status = GameStatus::Ended;
        game.action_deadline = 0;
    } else {
        game.round += 1;
        // `idx` is now inactive, so hand the turn to the next active seat after it.
        game.current_turn = next_active_player(game, idx);
        game.arm_deadline(now);
    }
    Ok(())
}

#[derive(Accounts, Session)]
pub struct ForceTimeout<'info> {
    /// The tx signer: any wallet, OR an authorized session key for `authority`.
    pub signer: Signer<'info>,

    /// Whoever the trigger is attributed to. Not a signer.
    /// CHECK: identity only; authorization is enforced by `session_auth_or`.
    pub authority: UncheckedAccount<'info>,

    /// Optional session token proving `signer` may act for `authority`.
    #[session(signer = signer, authority = authority.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,

    #[account(mut)]
    pub game: Account<'info, Game>,
}
