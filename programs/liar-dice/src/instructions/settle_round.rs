use anchor_lang::prelude::*;
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};

use crate::errors::LiarDiceError;
use crate::logic::count_face_reveals;
use crate::state::*;

/// Resolve a challenge once every participating player has revealed, counting over the public `last_reveal`.
/// If the count meets the claim the bid holds (challenger loses a die); otherwise the bidder loses one.
/// Caller-agnostic (anyone may settle); supports session keys so the session signer can trigger it.
#[session_auth_or(
    ctx.accounts.authority.key() == ctx.accounts.signer.key(),
    LiarDiceError::Unauthorized
)]
pub fn settle_round(ctx: Context<SettleRound>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let game = &mut ctx.accounts.game;
    require!(game.status == GameStatus::Active, LiarDiceError::BadGameState);
    require!(game.phase == RoundPhase::Revealing, LiarDiceError::NotSettled);

    // Strict path: everyone revealed, settle immediately. Timeout path: reveals are
    // missing but the deadline has passed, so slash every participant who failed to
    // reveal and settle the bid over whoever did.
    let all_revealed = game.last_reveal.len() == game.participating_count();
    // Seats already slashed for missing their reveal below — the bid-outcome loser
    // (often the very same seat, since a non-revealing bidder's dice never counted
    // toward the bid) must not also take the separate loser penalty further down,
    // or they'd lose two dice in a single settle_round call.
    let mut already_slashed = vec![false; game.players.len()];
    if !all_revealed {
        require!(game.action_deadline != 0, LiarDiceError::BadGameState);
        require!(now > game.action_deadline, LiarDiceError::DeadlineNotReached);

        let revealed: Vec<u8> = game.last_reveal.iter().map(|r| r.player_idx).collect();
        for idx in 0..game.players.len() {
            // Only participants owe a reveal; a skipped (non-rolling) player is exempt.
            if game.participating[idx] && !revealed.contains(&(idx as u8)) {
                // Non-revealer loses a die (their dice also never counted toward the bid),
                // and is eliminated if that was their last one.
                if game.dice_counts[idx] > 0 {
                    game.dice_counts[idx] -= 1;
                    if game.dice_counts[idx] == 0 {
                        game.is_active[idx] = false;
                    }
                }
                already_slashed[idx] = true;
            }
        }
    }

    let bid = game.current_bid.ok_or(LiarDiceError::NothingToChallenge)?;
    let actual = count_face_reveals(&game.last_reveal, bid.face);

    // Bid held (actual >= claimed) → challenger loses; else the bidder was bluffing.
    let bid_held = actual >= bid.quantity as u32;
    let loser = if bid_held { game.challenger } else { bid.bidder };

    // The loser drops a die and is eliminated if it was their last (no-op if already
    // zeroed, or if they already lost a die above for failing to reveal this round).
    let loser_idx = loser as usize;
    game.last_loser = loser;
    if !already_slashed[loser_idx] && game.dice_counts[loser_idx] > 0 {
        game.dice_counts[loser_idx] -= 1;
        if game.dice_counts[loser_idx] == 0 {
            game.is_active[loser_idx] = false;
        }
    }

    if game.active_count() <= 1 {
        game.status = GameStatus::Ended;
        game.action_deadline = 0; // nothing is owed once the game is over
    } else {
        // Next round reopens in the Rolling phase; begin_bidding seats the starter
        // later (using last_loser as the seed seat) once everyone has rolled.
        game.round += 1;
        game.phase = RoundPhase::Rolling;
        game.current_bid = None;
        game.last_reveal.clear();
        for p in game.participating.iter_mut() {
            *p = false;
        }
        // Everyone owes a roll again; start the shared roll window.
        game.arm_deadline(now);
    }
    Ok(())
}

#[derive(Accounts, Session)]
pub struct SettleRound<'info> {
    /// The tx signer: any wallet OR an authorized session key.
    pub signer: Signer<'info>,

    /// The seat owner (real wallet) the signer acts for. Not a signer.
    /// CHECK: identity only; authorization is enforced by `session_auth_or`.
    pub authority: UncheckedAccount<'info>,

    /// Optional session token proving `signer` may act for `authority`.
    #[session(signer = signer, authority = authority.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,

    #[account(mut)]
    pub game: Account<'info, Game>,
}
