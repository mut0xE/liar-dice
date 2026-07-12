use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod errors;
pub mod instructions;
pub mod logic;
pub mod state;

pub use errors::*;
use instructions::*;
pub use logic::*;
pub use state::*;

declare_id!("1iAR1JYBJsjtzS6jSLbUfVbYuBfR88FpxbNPKUE6nLb");

#[ephemeral]
#[program]
pub mod liar_dice {
    use super::*;

    pub fn create_game(
        ctx: Context<CreateGame>,
        game_id: u64,
        entry_fee: u64,
        timeout_grace: i64,
    ) -> Result<()> {
        instructions::create_game::create_game(ctx, game_id, entry_fee, timeout_grace)
    }

    pub fn join_game(ctx: Context<JoinGame>) -> Result<()> {
        instructions::join_game::join_game(ctx)
    }

    pub fn start_game(ctx: Context<StartGame>) -> Result<()> {
        instructions::start_game::start_game(ctx)
    }

    /// Delegate the caller's own hand to the ER (once per player, in the join tx).
    pub fn delegate_hand(ctx: Context<DelegateHand>, game_id: u64) -> Result<()> {
        instructions::delegate::delegate_hand(ctx, game_id)
    }

    /// Delegate the shared game PDA to the ER (host-only, in the start tx).
    pub fn delegate_game(ctx: Context<DelegateGame>, game_id: u64) -> Result<()> {
        instructions::delegate::delegate_game(ctx, game_id)
    }

    /// Make the caller's hand private on the ER (once per player, right after delegate).
    pub fn init_hand_permission(ctx: Context<InitHandPermission>) -> Result<()> {
        instructions::init_hand_permission::init_hand_permission(ctx)
    }

    /// Close the caller's hand permission on the ER, reclaiming its rent. Must run
    /// before `end_game` undelegates the hand (see `close_hand_permission` docs).
    pub fn close_hand_permission(ctx: Context<CloseHandPermission>) -> Result<()> {
        instructions::close_hand_permission::close_hand_permission(ctx)
    }

    pub fn cancel_game<'info>(ctx: Context<'_, '_, '_, 'info, CancelGame<'info>>) -> Result<()> {
        instructions::cancel_game::cancel_game(ctx)
    }

    /// Reclaim a hand's rent after the game has ended + undelegated
    pub fn close_hand(ctx: Context<CloseHand>) -> Result<()> {
        instructions::close_hand::close_hand(ctx)
    }

    /// Request a provably-fair dice roll from the VRF oracle (on the ER).
    pub fn request_roll(ctx: Context<RequestRoll>, client_seed: u8) -> Result<()> {
        instructions::request_roll::request_roll(ctx, client_seed)
    }

    /// VRF callback that writes the rolled dice. Only the VRF program may call it.
    pub fn consume_roll(ctx: Context<ConsumeRoll>, randomness: [u8; 32]) -> Result<()> {
        instructions::consume_roll::consume_roll(ctx, randomness)
    }

    /// Close the shared roll window and open bidding (permissionless; active hands via remaining_accounts).
    pub fn begin_bidding<'info>(
        ctx: Context<'_, '_, 'info, 'info, BeginBidding<'info>>,
    ) -> Result<()> {
        instructions::begin_bidding::begin_bidding(ctx)
    }

    pub fn place_bid(ctx: Context<PlaceBid>, quantity: u16, face: u8) -> Result<()> {
        instructions::place_bid::place_bid(ctx, quantity, face)
    }

    pub fn challenge(ctx: Context<Challenge>) -> Result<()> {
        instructions::challenge::challenge(ctx)
    }

    /// Publish your own hand after a challenge (each active player calls once).
    pub fn reveal(ctx: Context<Reveal_>) -> Result<()> {
        instructions::reveal::reveal(ctx)
    }

    pub fn settle_round(ctx: Context<SettleRound>) -> Result<()> {
        instructions::settle_round::settle_round(ctx)
    }

    /// Permissionless liveness escape hatch: evict the player who has stalled past the deadline.
    pub fn force_timeout(ctx: Context<ForceTimeout>, target: Pubkey) -> Result<()> {
        instructions::force_timeout::force_timeout(ctx, target)
    }

    /// End the game on the ER: commit + undelegate the `Game` and pay out atomically via a post-commit Magic Action.
    pub fn end_game<'info>(ctx: Context<'_, '_, 'info, 'info, EndGame<'info>>) -> Result<()> {
        instructions::end_game::end_game(ctx)
    }

    /// Post-commit Magic Action target: pays the whole pot to the winner on base layer (not called directly).
    pub fn payout(ctx: Context<Payout>) -> Result<()> {
        instructions::end_game::payout(ctx)
    }
}
