use anchor_lang::prelude::*;

/// Max players at a table.
pub const MAX_PLAYERS: usize = 6;
/// Starting dice per player.
pub const STARTING_DICE: u8 = 5;

// PDA seed prefixes.
pub const GAME_SEED: &[u8] = b"game";
pub const HAND_SEED: &[u8] = b"hand";
pub const VAULT_SEED: &[u8] = b"vault";
pub const TREASURY_SEED: &[u8] = b"treasury";

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum GameStatus {
    Waiting,
    Active,
    Ended,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct Bid {
    pub quantity: u16,
    pub face: u8,   // 1..=6
    pub bidder: u8, // index into players
}

/// Snapshot of a revealed hand, written into the shared `Game` after a challenge
/// so every player at the table can audit the outcome (PlayerHand is owner-only
/// readable). Cleared at the start of the next round.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct Reveal {
    pub player_idx: u8,
    pub dice: [u8; 5],
    pub dice_count: u8,
}

#[account]
pub struct Game {
    pub host: Pubkey,
    pub game_id: u64,
    pub status: GameStatus,
    pub players: Vec<Pubkey>,   // max MAX_PLAYERS
    pub dice_counts: Vec<u8>,   // public dice remaining per player
    pub is_active: Vec<bool>,   // false = eliminated
    pub current_turn: u8,       // index into players
    pub round: u16,
    pub current_bid: Option<Bid>, // None = first bid of round
    pub last_loser: u8,           // bids first next round
    pub last_reveal: Vec<Reveal>, // revealed dice after a challenge; cleared next round
    pub stake_lamports: u64,      // prize stake per player -> vault (winner takes it)
    pub entry_fee_lamports: u64,  // protocol fee per player -> treasury
    pub pot_lamports: u64,        // sum of stakes = the prize
    pub bump: u8,
}

impl Game {
    // 8 disc + host(32) + game_id(8) + status(1)
    //   + players Vec<Pubkey>(4 + 32*6)
    //   + dice_counts Vec<u8>(4 + 6)
    //   + is_active Vec<bool>(4 + 6)
    //   + current_turn(1) + round(2)
    //   + current_bid Option<Bid>(1 + 4)
    //   + last_loser(1)
    //   + last_reveal Vec<Reveal>(4 + 6*(1+5+1))
    //   + stake(8) + entry_fee(8) + pot(8) + bump(1)
    pub const SPACE: usize = 8
        + 32
        + 8
        + 1
        + (4 + 32 * MAX_PLAYERS)
        + (4 + MAX_PLAYERS)
        + (4 + MAX_PLAYERS)
        + 1
        + 2
        + (1 + 4)
        + 1
        + (4 + MAX_PLAYERS * (1 + 5 + 1))
        + 8
        + 8
        + 8
        + 1;

    /// Total dice currently in play across all players.
    pub fn total_dice(&self) -> u32 {
        self.dice_counts.iter().map(|&d| d as u32).sum()
    }

    /// Number of players still holding dice.
    pub fn active_count(&self) -> usize {
        self.is_active.iter().filter(|&&a| a).count()
    }
}

#[account]
pub struct PlayerHand {
    pub game: Pubkey,
    pub player: Pubkey,
    pub dice: [u8; 5], // valid entries 0..dice_count
    pub dice_count: u8,
    pub rolled: bool, // set true by VRF callback; gate bids on this
    pub revealed: bool,
    pub bump: u8,
}

impl PlayerHand {
    // 8 disc + game(32) + player(32) + dice(5) + dice_count(1)
    //   + rolled(1) + revealed(1) + bump(1)
    pub const SPACE: usize = 8 + 32 + 32 + 5 + 1 + 1 + 1 + 1;
}
