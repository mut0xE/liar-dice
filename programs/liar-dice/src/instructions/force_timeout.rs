use anchor_lang::prelude::*;
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};

use crate::errors::LiarDiceError;
use crate::state::*;

/// Liveness escape hatch for the BIDDING phase: evict the `current_turn` player once they
/// stall past the deadline without bidding or challenging. Permissionless (any signer or
/// session key). Roll-stalls are handled by `begin_bidding`, reveal-stalls by `settle_round`.
/// The staller is forfeited; the game ends if one player remains, else a fresh round opens.
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

    // Only a bidding turn-stall is force_timeout's job (roll -> begin_bidding, reveal -> settle_round).
    require!(game.phase == RoundPhase::Bidding, LiarDiceError::BadGameState);
    require!(game.current_turn == idx, LiarDiceError::NotStalling);

    // Forfeit the staller entirely and wipe the in-flight round.
    game.is_active[idx as usize] = false;
    game.dice_counts[idx as usize] = 0;
    game.participating[idx as usize] = false;
    game.last_loser = idx;
    game.current_bid = None;
    game.last_reveal.clear();

    if game.active_count() <= 1 {
        game.status = GameStatus::Ended;
        game.action_deadline = 0;
    } else {
        // Reopen a fresh round in the Rolling phase; begin_bidding seats the next starter.
        game.round += 1;
        game.phase = RoundPhase::Rolling;
        for p in game.participating.iter_mut() {
            *p = false;
        }
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
