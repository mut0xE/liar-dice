use anchor_lang::prelude::*;
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};

use crate::errors::LiarDiceError;
use crate::state::*;

/// Call "Liar!" on the standing bid. Can't count dice directly (private hands), so it just
/// freezes the round into the `Revealing` phase; players then `reveal` and `settle_round` counts.
/// Supports session keys; the seat is resolved from `authority`.
#[session_auth_or(
    ctx.accounts.authority.key() == ctx.accounts.signer.key(),
    LiarDiceError::Unauthorized
)]
pub fn challenge(ctx: Context<Challenge>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    require!(
        game.status == GameStatus::Active,
        LiarDiceError::BadGameState
    );
    require!(
        game.phase == RoundPhase::Bidding,
        LiarDiceError::BadGameState
    );

    // There must be a standing bid to challenge.
    require!(
        game.current_bid.is_some(),
        LiarDiceError::NothingToChallenge
    );

    // Only the player whose turn it is may challenge (resolved by authority).
    let challenger = game
        .player_index(&ctx.accounts.authority.key())
        .ok_or(LiarDiceError::NotYourTurn)?;
    require!(game.current_turn == challenger, LiarDiceError::NotYourTurn);

    // Freeze the round for reveals, keeping `current_bid` so `settle_round` knows what's challenged.
    game.challenger = challenger;
    game.last_reveal.clear();
    game.phase = RoundPhase::Revealing;
    // All participating players now owe a reveal; start the reveal clock.
    game.arm_deadline(Clock::get()?.unix_timestamp);
    Ok(())
}

#[derive(Accounts, Session)]
pub struct Challenge<'info> {
    /// The tx signer: the player's wallet OR an authorized session key.
    pub signer: Signer<'info>,

    /// The seat owner (real wallet) calling "Liar!". Not a signer.
    /// CHECK: identity only; authorization is enforced by `session_auth_or`.
    pub authority: UncheckedAccount<'info>,

    /// Optional session token proving `signer` may act for `authority`.
    #[session(signer = signer, authority = authority.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,

    #[account(mut)]
    pub game: Account<'info, Game>,
}
