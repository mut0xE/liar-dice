use anchor_lang::prelude::*;
use ephemeral_vrf_sdk::anchor::vrf_callback;
use ephemeral_vrf_sdk::rnd::random_u8_with_range;
use solana_keccak_hasher as keccak;

use crate::state::*;

/// Step 2 of the VRF roll: the oracle delivers 32 random bytes and we write one die (1..=6) per slot.
/// Only the VRF program may call this (enforced below), so the dice can't be forged.
pub fn consume_roll(ctx: Context<ConsumeRoll>, randomness: [u8; 32]) -> Result<()> {
    let hand = &mut ctx.accounts.player_hand;

    for i in 0..hand.dice_count as usize {
        // Each die needs its own seed, so hash the VRF output with the die index.
        let seed = keccak::hashv(&[randomness.as_ref(), &[i as u8]]).to_bytes();
        hand.dice[i] = random_u8_with_range(&seed, 1, 6);
    }
    // Dice are live and unrevealed; bidding can proceed.
    hand.rolled = true;
    hand.revealed = false;

    Ok(())
}

/// `#[vrf_callback]` injects `vrf_program_identity: Signer` so only the VRF oracle can call this.
#[vrf_callback]
#[derive(Accounts)]
pub struct ConsumeRoll<'info> {
    /// The hand whose dice are being written (passed via the request's callback metas).
    #[account(mut)]
    pub player_hand: Account<'info, PlayerHand>,
}
