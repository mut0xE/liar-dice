use anchor_lang::prelude::*;

use crate::errors::LiarDiceError;
use crate::logic::{count_face_reveals, next_active_player};
use crate::state::*;

/// Resolve a challenge once every active player has revealed, counting over the public `last_reveal`.
/// If the count meets the claim the bid holds (challenger loses a die); otherwise the bidder loses one.
pub fn settle_round(ctx: Context<SettleRound>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let game = &mut ctx.accounts.game;
    require!(game.status == GameStatus::Active, LiarDiceError::BadGameState);
    require!(game.awaiting_reveal, LiarDiceError::NotSettled);

    // Strict path: everyone revealed, settle immediately. Timeout path: reveals are
    // missing but the deadline has passed, so slash every active player who failed to
    // reveal and settle the bid over whoever did.
    let all_revealed = game.last_reveal.len() == game.active_count();
    if !all_revealed {
        require!(game.action_deadline != 0, LiarDiceError::BadGameState);
        require!(now > game.action_deadline, LiarDiceError::DeadlineNotReached);

        let revealed: Vec<u8> = game.last_reveal.iter().map(|r| r.player_idx).collect();
        for idx in 0..game.players.len() {
            if game.is_active[idx] && !revealed.contains(&(idx as u8)) {
                // Non-revealer loses a die (their dice also never counted toward the bid),
                // and is eliminated if that was their last one.
                if game.dice_counts[idx] > 0 {
                    game.dice_counts[idx] -= 1;
                    if game.dice_counts[idx] == 0 {
                        game.is_active[idx] = false;
                    }
                }
            }
        }
    }

    let bid = game.current_bid.ok_or(LiarDiceError::NothingToChallenge)?;
    let actual = count_face_reveals(&game.last_reveal, bid.face);

    // Bid held (actual >= claimed) → challenger loses; else the bidder was bluffing.
    let bid_held = actual >= bid.quantity as u32;
    let loser = if bid_held { game.challenger } else { bid.bidder };

    // The loser drops a die and is eliminated if it was their last (no-op if already zeroed).
    let loser_idx = loser as usize;
    game.last_loser = loser;
    if game.dice_counts[loser_idx] > 0 {
        game.dice_counts[loser_idx] -= 1;
        if game.dice_counts[loser_idx] == 0 {
            game.is_active[loser_idx] = false;
        }
    }

    game.awaiting_reveal = false;

    if game.active_count() <= 1 {
        game.status = GameStatus::Ended;
        game.action_deadline = 0; // nothing is owed once the game is over
    } else {
        game.round += 1;
        game.current_bid = None;
        game.last_reveal.clear();
        // The loser starts the next round, or the next active player if they were just eliminated.
        game.current_turn = if game.is_active[game.last_loser as usize] {
            game.last_loser
        } else {
            next_active_player(game, game.last_loser)
        };
        // The next round's first mover owes a move; start their clock.
        game.arm_deadline(now);
    }
    Ok(())
}

#[derive(Accounts)]
pub struct SettleRound<'info> {
    pub caller: Signer<'info>,
    #[account(mut)]
    pub game: Account<'info, Game>,
}
