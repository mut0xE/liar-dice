use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use ephemeral_vrf_sdk::anchor::vrf;
use ephemeral_vrf_sdk::instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};

use crate::errors::LiarDiceError;
use crate::state::*;

/// Step 1 of the VRF roll: fire an async request to the oracle with `consume_roll` as the callback.
/// Dice are marked pending (`rolled = false`) until the oracle calls back. Runs on the ER.
/// Supports session keys: `signer` (wallet or session key) pays; the hand rolled belongs to `authority`.
#[session_auth_or(
    ctx.accounts.authority.key() == ctx.accounts.signer.key(),
    LiarDiceError::Unauthorized
)]
pub fn request_roll(ctx: Context<RequestRoll>, client_seed: u8) -> Result<()> {
    // Read what we need off the shared game before mutating the hand.
    let game = &ctx.accounts.game;
    require!(
        game.status == GameStatus::Active,
        LiarDiceError::BadGameState
    );
    // Rolling only happens during the shared roll window, before bidding opens.
    require!(game.phase == RoundPhase::Rolling, LiarDiceError::BadGameState);

    // Resolve the seat by authority (not the raw signer).
    let idx = game
        .player_index(&ctx.accounts.authority.key())
        .ok_or(LiarDiceError::Unauthorized)?;
    // `game.dice_counts` is the source of truth; sync it into the hand so the callback rolls the right number.
    let dice_count = game.dice_counts[idx as usize];
    require!(dice_count > 0, LiarDiceError::Eliminated);
    let round = game.round;
    let hand_rolled_round = ctx.accounts.player_hand.rolled_round;

    // Exactly one roll per round, so a player can't re-roll to change their hand.
    require!(hand_rolled_round < round, LiarDiceError::AlreadyRolled);

    let hand = &mut ctx.accounts.player_hand;
    hand.dice_count = dice_count;
    hand.rolled_round = round;
    // Mark pending: no bidding until the callback lands.
    hand.rolled = false;

    // Note: the roll window is shared and armed once at round start, so a single
    // player's roll must NOT re-arm it (that would let the window drift forever).

    let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.signer.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::ConsumeRoll::DISCRIMINATOR.to_vec(),
        // Client entropy — the oracle mixes this with its own VRF output.
        caller_seed: [client_seed; 32],
        // The callback gets the hand as a writable account so it can write dice.
        accounts_metas: Some(vec![SerializableAccountMeta {
            pubkey: ctx.accounts.player_hand.key(),
            is_signer: false,
            is_writable: true,
        }]),
        ..Default::default()
    });
    msg!(
        "request_roll: seat {} requested {} dice for round {} (VRF pending)",
        idx,
        dice_count,
        round
    );
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.signer.to_account_info(), &ix)?;
    Ok(())
}

#[vrf]
#[derive(Accounts, Session)]
pub struct RequestRoll<'info> {
    /// Whoever signs and pays for the VRF request: the player's real wallet OR an
    /// ephemeral session key authorized for `authority`.
    #[account(mut)]
    pub signer: Signer<'info>,

    /// The seat owner (real wallet) whose hand is rolled. Not a signer.
    /// CHECK: identity only; authorization is enforced by `session_auth_or`.
    pub authority: UncheckedAccount<'info>,

    /// Optional session token proving `signer` may act for `authority`.
    #[session(signer = signer, authority = authority.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,

    #[account(mut)]
    pub game: Account<'info, Game>,

    /// The seat owner's hand; the oracle callback writes dice into it.
    #[account(
        mut,
        seeds = [HAND_SEED, game.key().as_ref(), authority.key().as_ref()],
        bump = player_hand.bump,
        has_one = game @ LiarDiceError::Unauthorized,
        constraint = player_hand.player == authority.key() @ LiarDiceError::Unauthorized,
    )]
    pub player_hand: Account<'info, PlayerHand>,

    /// CHECK: VRF oracle queue. Ephemeral queue because hands are delegated to the ER.
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
}
