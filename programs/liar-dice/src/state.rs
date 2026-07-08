use anchor_lang::prelude::*;

pub const MAX_PLAYERS: usize = 6;
pub const STARTING_DICE: u8 = 5;
/// Consecutive rolling phases a player may miss before they're eliminated.
/// One miss just sits you out that round (skip); the K-th in a row forfeits you.
pub const MISS_LIMIT: u8 = 2;

pub const GAME_SEED: &[u8] = b"game";
pub const HAND_SEED: &[u8] = b"hand";
pub const VAULT_SEED: &[u8] = b"vault";

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum GameStatus {
    Waiting,
    Active,
    Ended,
}

/// Where an Active round is in its lifecycle:
///   Rolling   — everyone rolls simultaneously (one shared roll window).
///   Bidding   — turn-based bidding/challenging over the players who rolled.
///   Revealing — a challenge is open; participants reveal, then `settle_round` scores it.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum RoundPhase {
    Rolling,
    Bidding,
    Revealing,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct Bid {
    pub quantity: u16,
    pub face: u8,
    pub bidder: u8,
}

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
    pub players: Vec<Pubkey>,
    pub dice_counts: Vec<u8>,
    pub is_active: Vec<bool>,
    pub current_turn: u8,
    pub round: u16,
    pub current_bid: Option<Bid>,
    pub last_loser: u8,
    /// Seat index of the player who called "Liar!" on the current bid.
    pub challenger: u8,
    /// Each active player's dice for the challenged round, filled by their own `reveal` call.
    pub last_reveal: Vec<Reveal>,
    /// The buy-in each player pays once on join.
    pub entry_fee_lamports: u64,
    /// The prize pot: running total of all entry fees held in the vault.
    pub pot_lamports: u64,
    /// Where the current round is: Rolling -> Bidding -> Revealing (see `RoundPhase`).
    pub phase: RoundPhase,
    /// Who actually rolled for THIS round (set by `begin_bidding`); only these seats
    /// bid/reveal/get counted. A skipped (non-rolling) player stays `is_active` but sits out.
    pub participating: Vec<bool>,
    /// Consecutive rolling phases each seat has missed; reset on a good roll, eliminated at `MISS_LIMIT`.
    pub missed_rolls: Vec<u8>,
    /// Seconds a player is given to make the pending move before anyone may `force_timeout` them.
    /// Set once at `create_game`; a real table might use 60-120s.
    pub timeout_grace: i64,
    /// Unix timestamp by which the currently-owed action must happen, else `force_timeout` can fire.
    /// 0 means nothing is pending (game not started, or ended).
    pub action_deadline: i64,
    pub bump: u8,
}

impl Game {
    pub const SPACE: usize = 8
        + 32          // host
        + 8           // game_id
        + 1           // status
        + (4 + 32 * MAX_PLAYERS) // players
        + (4 + MAX_PLAYERS)      // dice_counts
        + (4 + MAX_PLAYERS)      // is_active
        + 1           // current_turn
        + 2           // round
        + (1 + 4)     // current_bid
        + 1           // last_loser
        + 1           // challenger
        + (4 + MAX_PLAYERS * (1 + 5 + 1)) // last_reveal
        + 8           // entry_fee_lamports
        + 8           // pot_lamports
        + 1           // phase
        + (4 + MAX_PLAYERS)      // participating
        + (4 + MAX_PLAYERS)      // missed_rolls
        + 8           // timeout_grace
        + 8           // action_deadline
        + 1; // bump

    /// Arm the deadline for the next owed action, `timeout_grace` seconds out from `now`.
    pub fn arm_deadline(&mut self, now: i64) {
        self.action_deadline = now.saturating_add(self.timeout_grace);
    }

    pub fn total_dice(&self) -> u32 {
        self.dice_counts.iter().map(|&d| d as u32).sum()
    }

    pub fn active_count(&self) -> usize {
        self.is_active.iter().filter(|&&a| a).count()
    }

    /// How many seats rolled and are in play for the current round.
    pub fn participating_count(&self) -> usize {
        self.participating.iter().filter(|&&p| p).count()
    }

    pub fn player_index(&self, key: &Pubkey) -> Option<u8> {
        self.players.iter().position(|p| p == key).map(|i| i as u8)
    }

    pub fn winner_index(&self) -> Option<u8> {
        let mut found = None;
        for (i, &active) in self.is_active.iter().enumerate() {
            if active {
                if found.is_some() {
                    return None;
                }
                found = Some(i as u8);
            }
        }
        found
    }
}

#[account]
pub struct PlayerHand {
    pub game: Pubkey,
    pub player: Pubkey,
    pub dice: [u8; 5],
    pub dice_count: u8,
    pub rolled: bool,
    pub revealed: bool,
    /// The `Game.round` these dice were rolled for, so `request_roll` allows only one roll per round.
    pub rolled_round: u16,
    pub bump: u8,
}

impl PlayerHand {
    pub const SPACE: usize = 8 + 32 + 32 + 5 + 1 + 1 + 1 + 2 + 1;
}

