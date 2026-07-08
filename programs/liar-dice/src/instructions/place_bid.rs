use anchor_lang::prelude::*;
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};

use crate::errors::LiarDiceError;
use crate::logic::{next_active_player, validate_bid};
use crate::state::*;

/// Raise the standing bid on your turn (a claim about ALL dice on the table, e.g. "five 4s").
/// Only records the claim and advances the turn; dice are never read here (that happens in `settle_round`).
/// Supports session keys: `signer` may be the wallet or a session key for `authority`, but the seat is resolved from `authority`.
#[session_auth_or(
    ctx.accounts.authority.key() == ctx.accounts.signer.key(),
    LiarDiceError::Unauthorized
)]
pub fn place_bid(ctx: Context<PlaceBid>, quantity: u16, face: u8) -> Result<()> {
    let game = &mut ctx.accounts.game;
    require!(game.status == GameStatus::Active, LiarDiceError::BadGameState);
    // No bidding once "Liar!" has frozen the round, or the challenge could be dodged.
    require!(!game.awaiting_reveal, LiarDiceError::BadGameState);

    // Resolve the seat by authority (not the signer); a non-player has no index.
    let bidder = game
        .player_index(&ctx.accounts.authority.key())
        .ok_or(LiarDiceError::NotYourTurn)?;
    // Must be your turn.
    require!(game.current_turn == bidder, LiarDiceError::NotYourTurn);
    // Must have rolled FOR THIS ROUND; the round check blocks stale dice and pending rolls.
    require!(
        ctx.accounts.player_hand.rolled && ctx.accounts.player_hand.rolled_round == game.round,
        LiarDiceError::NotRolled
    );

    let bid = Bid {
        quantity,
        face,
        bidder,
    };
    // Validate face/quantity and that it's strictly higher than the current bid.
    validate_bid(&bid, &game.current_bid, game.total_dice())?;

    // Commit the bid and pass the turn to the next active player.
    game.current_bid = Some(bid);
    game.current_turn = next_active_player(game, game.current_turn);
    // The next player now owes a bid-or-challenge; start their clock.
    game.arm_deadline(Clock::get()?.unix_timestamp);
    Ok(())
}

#[derive(Accounts, Session)]
pub struct PlaceBid<'info> {
    /// The tx signer: the player's wallet OR a session key for `authority`.
    pub signer: Signer<'info>,

    /// The seat owner (real wallet), not a signer. Used for the seat lookup and hand seeds.
    /// CHECK: identity only; authorization is enforced by `session_auth_or`.
    pub authority: UncheckedAccount<'info>,

    /// Optional session token proving `signer` may act for `authority`.
    #[session(signer = signer, authority = authority.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,

    /// Shared game state: the standing bid and turn cursor (mutated here).
    #[account(mut)]
    pub game: Account<'info, Game>,

    /// The seat owner's own hand, read only for the `rolled` check (seeds tie it to authority).
    #[account(
        seeds = [HAND_SEED, game.key().as_ref(), authority.key().as_ref()],
        bump = player_hand.bump
    )]
    pub player_hand: Account<'info, PlayerHand>,
}
