use anchor_lang::prelude::*;
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};

use crate::errors::LiarDiceError;
use crate::state::*;

/// Publish your own hand after a challenge: copy the private dice into the public `Game.last_reveal`.
/// Each participating player calls this once while the round is in the `Revealing` phase, then `settle_round` counts.
/// Supports session keys; the hand and seat are resolved from `authority`.
#[session_auth_or(
    ctx.accounts.authority.key() == ctx.accounts.signer.key(),
    LiarDiceError::Unauthorized
)]
pub fn reveal(ctx: Context<Reveal_>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let hand = &mut ctx.accounts.player_hand;

    require!(game.status == GameStatus::Active, LiarDiceError::BadGameState);
    require!(game.phase == RoundPhase::Revealing, LiarDiceError::BadGameState);
    // Must have rolled FOR THIS ROUND; the round check blocks revealing stale dice.
    require!(
        hand.rolled && hand.rolled_round == game.round,
        LiarDiceError::NotRolled
    );

    let player_idx = game
        .player_index(&ctx.accounts.authority.key())
        .ok_or(LiarDiceError::Unauthorized)?;
    require!(game.is_active[player_idx as usize], LiarDiceError::Eliminated);

    // One reveal per challenge (`revealed` resets on each fresh roll).
    require!(!hand.revealed, LiarDiceError::DuplicateHand);

    let revealed = Reveal {
        player_idx,
        dice: hand.dice,
        dice_count: hand.dice_count,
    };
    game.last_reveal.push(revealed);
    hand.revealed = true;
    // Someone revealed on time; give whoever still owes a reveal a fresh window.
    game.arm_deadline(Clock::get()?.unix_timestamp);
    Ok(())
}

/// Trailing underscore avoids clashing with the `Reveal` state struct.
#[derive(Accounts, Session)]
pub struct Reveal_<'info> {
    /// The tx signer: the player's wallet OR an authorized session key.
    pub signer: Signer<'info>,

    /// The seat owner (real wallet) whose hand is being revealed. Not a signer.
    /// CHECK: identity only; authorization is enforced by `session_auth_or`.
    pub authority: UncheckedAccount<'info>,

    /// Optional session token proving `signer` may act for `authority`.
    #[session(signer = signer, authority = authority.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,

    #[account(mut)]
    pub game: Account<'info, Game>,

    /// The seat owner's own hand; seeds + `has_one` ensure only `authority`'s dice can be revealed.
    #[account(
        mut,
        seeds = [HAND_SEED, game.key().as_ref(), authority.key().as_ref()],
        bump = player_hand.bump,
        has_one = game @ LiarDiceError::Unauthorized,
        constraint = player_hand.player == authority.key() @ LiarDiceError::Unauthorized,
    )]
    pub player_hand: Account<'info, PlayerHand>,
}
