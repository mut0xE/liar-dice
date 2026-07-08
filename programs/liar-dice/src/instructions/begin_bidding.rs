use anchor_lang::prelude::*;

use crate::errors::LiarDiceError;
use crate::logic::next_participating_player;
use crate::state::*;

/// Close the shared roll window and open bidding. Permissionless — any signer may fire it,
/// including a player's ephemeral session key (it's just a signer; no wallet pop-up needed).
/// Pass EVERY active player's hand in `remaining_accounts` so the roll check is honest.
///
/// - If all active players rolled, bidding opens immediately.
/// - Otherwise the roll deadline must have passed; then each non-roller is skipped for
///   the round (keeps their dice) and takes a strike — the `MISS_LIMIT`-th consecutive
///   strike forfeits them. If fewer than two players end up participating, a fresh roll
///   window opens instead of bidding (and the game ends if one player remains).
pub fn begin_bidding<'info>(
    ctx: Context<'_, '_, 'info, 'info, BeginBidding<'info>>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let game = &mut ctx.accounts.game;
    require!(game.status == GameStatus::Active, LiarDiceError::BadGameState);
    require!(game.phase == RoundPhase::Rolling, LiarDiceError::BadGameState);

    let game_key = game.key();
    let n = game.players.len();

    // Read which active seats actually rolled for this round, from the passed hands.
    let mut rolled = vec![false; n];
    let mut seen = vec![false; n];
    for hand_ai in ctx.remaining_accounts.iter() {
        // try_from checks owner + discriminator, so this is a genuine hand of ours.
        let hand: Account<PlayerHand> = Account::try_from(hand_ai)?;
        require_keys_eq!(hand.game, game_key, LiarDiceError::Unauthorized);

        // Must be the canonical hand PDA for its player (blocks look-alikes).
        let (expected, _) = Pubkey::find_program_address(
            &[HAND_SEED, game_key.as_ref(), hand.player.as_ref()],
            &crate::ID,
        );
        require_keys_eq!(hand_ai.key(), expected, LiarDiceError::Unauthorized);

        let idx = game
            .player_index(&hand.player)
            .ok_or(LiarDiceError::Unauthorized)? as usize;
        seen[idx] = true;
        if game.is_active[idx] && hand.rolled && hand.rolled_round == game.round {
            rolled[idx] = true;
        }
    }

    // Every active seat's hand must be provided, or the skip decision could be gamed.
    for i in 0..n {
        if game.is_active[i] {
            require!(seen[i], LiarDiceError::MissingHand);
        }
    }

    let all_rolled = (0..n).all(|i| !game.is_active[i] || rolled[i]);

    if all_rolled {
        // Fast path: everyone in — participants are exactly the active seats.
        for i in 0..n {
            game.participating[i] = game.is_active[i];
            if game.is_active[i] {
                game.missed_rolls[i] = 0;
            }
        }
        msg!(
            "begin_bidding: all {} active players rolled -> opening bidding (round {})",
            game.active_count(),
            game.round
        );
        open_bidding(game, now);
        return Ok(());
    }

    // Slow path: some didn't roll, so the shared window must have expired.
    require!(game.action_deadline != 0, LiarDiceError::BadGameState);
    require!(now > game.action_deadline, LiarDiceError::DeadlineNotReached);
    msg!(
        "begin_bidding: roll window expired for round {} -> skipping/striking no-shows",
        game.round
    );

    for i in 0..n {
        if !game.is_active[i] {
            game.participating[i] = false;
            continue;
        }
        if rolled[i] {
            game.participating[i] = true;
            game.missed_rolls[i] = 0;
        } else {
            // Skipped this round; strike them, and forfeit on the K-th straight miss.
            game.participating[i] = false;
            game.missed_rolls[i] = game.missed_rolls[i].saturating_add(1);
            if game.missed_rolls[i] >= MISS_LIMIT && game.active_count() > 1 {
                game.is_active[i] = false;
                game.dice_counts[i] = 0;
                msg!(
                    "  seat {} missed {} rolls in a row -> ELIMINATED",
                    i,
                    game.missed_rolls[i]
                );
            } else if game.missed_rolls[i] >= MISS_LIMIT {
                // Would be eliminated, but they're the last one standing, so a fully
                // abandoned table always leaves exactly one winner (never a stuck pot).
                msg!(
                    "  seat {} missed {} rolls but is the last player -> WINS by default",
                    i,
                    game.missed_rolls[i]
                );
            } else {
                msg!(
                    "  seat {} skipped (strike {}/{})",
                    i,
                    game.missed_rolls[i],
                    MISS_LIMIT
                );
            }
        }
    }

    // One (or zero) player left standing → the game is over.
    if game.active_count() <= 1 {
        game.status = GameStatus::Ended;
        game.action_deadline = 0;
        msg!("begin_bidding: <=1 player left -> game ENDED");
        return Ok(());
    }

    if game.participating_count() >= 2 {
        msg!(
            "begin_bidding: {} rolled -> opening bidding",
            game.participating_count()
        );
        open_bidding(game, now);
    } else {
        // Not enough rollers to bid; open a fresh roll window (strikes already stand).
        game.round += 1;
        for p in game.participating.iter_mut() {
            *p = false;
        }
        game.arm_deadline(now);
        msg!(
            "begin_bidding: fewer than 2 rolled -> reopening roll window for round {}",
            game.round
        );
    }
    Ok(())
}

/// Flip Rolling → Bidding: clear any stale bid/reveals, seat the starter, arm the clock.
fn open_bidding(game: &mut Game, now: i64) {
    game.phase = RoundPhase::Bidding;
    game.current_bid = None;
    game.last_reveal.clear();
    // The last loser leads if they're playing this round, else the next participant.
    game.current_turn = if game.participating[game.last_loser as usize] {
        game.last_loser
    } else {
        next_participating_player(game, game.last_loser)
    };
    game.arm_deadline(now);
}

#[derive(Accounts)]
pub struct BeginBidding<'info> {
    /// Any signer may open bidding — a plain wallet or a player's session key.
    pub caller: Signer<'info>,

    /// Shared game state; the round phase + participation are decided here.
    /// (Active player hands come in via `remaining_accounts`.)
    #[account(mut)]
    pub game: Account<'info, Game>,
}
