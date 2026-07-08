use anchor_lang::prelude::*;

use crate::errors::LiarDiceError;
use crate::state::{Bid, Game, PlayerHand, Reveal};

/// Bids only go up: higher quantity, or same quantity + higher face.
pub fn is_higher_bid(new: &Bid, prev: &Bid) -> bool {
    new.quantity > prev.quantity
        || (new.quantity == prev.quantity && new.face > prev.face)
}

/// Count how many dice show `face` across all given hands.
/// Ones are wild EXCEPT when the bid itself is on ones.
pub fn count_face(hands: &[&PlayerHand], face: u8) -> u32 {
    let mut total = 0;
    for h in hands {
        for &die in h.dice.iter().take(h.dice_count as usize) {
            if die == face || (die == 1 && face != 1) {
                total += 1;
            }
        }
    }
    total
}

/// Same as `count_face` but over the public `Reveal` table, so no private hand is read.
pub fn count_face_reveals(reveals: &[Reveal], face: u8) -> u32 {
    let mut total = 0;
    for r in reveals {
        for &die in r.dice.iter().take(r.dice_count as usize) {
            if die == face || (die == 1 && face != 1) {
                total += 1;
            }
        }
    }
    total
}

/// Validate a proposed bid against the previous bid and the dice in play.
pub fn validate_bid(new: &Bid, prev: &Option<Bid>, total_dice: u32) -> Result<()> {
    require!((1..=6).contains(&new.face), LiarDiceError::InvalidFace);
    require!(new.quantity >= 1, LiarDiceError::InvalidQuantity);
    require!(new.quantity as u32 <= total_dice, LiarDiceError::BidTooLarge);
    if let Some(p) = prev {
        require!(is_higher_bid(new, p), LiarDiceError::BidNotHigher);
    }
    Ok(())
}

/// Next active (non-eliminated) player index, wrapping around the table.
pub fn next_active_player(g: &Game, from: u8) -> u8 {
    let n = g.players.len() as u8;
    let mut i = (from + 1) % n;
    while !g.is_active[i as usize] {
        i = (i + 1) % n;
    }
    i
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bid(quantity: u16, face: u8, bidder: u8) -> Bid {
        Bid { quantity, face, bidder }
    }

    fn hand(dice: [u8; 5], dice_count: u8) -> PlayerHand {
        PlayerHand {
            game: Pubkey::default(),
            player: Pubkey::default(),
            dice,
            dice_count,
            rolled: true,
            revealed: false,
            rolled_round: 0,
            bump: 0,
        }
    }

    #[test]
    fn higher_by_quantity() {
        assert!(is_higher_bid(&bid(3, 2, 0), &bid(2, 6, 0)));
    }

    #[test]
    fn higher_by_face_same_quantity() {
        assert!(is_higher_bid(&bid(2, 5, 0), &bid(2, 4, 0)));
    }

    #[test]
    fn not_higher_lower_face_same_quantity() {
        assert!(!is_higher_bid(&bid(2, 3, 0), &bid(2, 4, 0)));
    }

    #[test]
    fn not_higher_equal_bid() {
        assert!(!is_higher_bid(&bid(2, 4, 0), &bid(2, 4, 0)));
    }

    #[test]
    fn count_face_wild_ones_on() {
        // dice show 5,1,3,1,2 -> counting fives: two 5s? no, one 5 + two wild 1s = 3
        let h = hand([5, 1, 3, 1, 2], 5);
        assert_eq!(count_face(&[&h], 5), 3);
    }

    #[test]
    fn count_face_wild_ones_off_when_bidding_ones() {
        // counting ones: ones are NOT wild for themselves -> just the two 1s
        let h = hand([5, 1, 3, 1, 2], 5);
        assert_eq!(count_face(&[&h], 1), 2);
    }

    #[test]
    fn count_face_respects_dice_count() {
        // only first 2 dice count; last three are stale
        let h = hand([1, 4, 4, 4, 4], 2);
        assert_eq!(count_face(&[&h], 4), 2); // one 4 + one wild 1
    }

    #[test]
    fn validate_bid_rejects_bad_face() {
        assert!(validate_bid(&bid(1, 7, 0), &None, 10).is_err());
        assert!(validate_bid(&bid(1, 0, 0), &None, 10).is_err());
    }

    #[test]
    fn validate_bid_rejects_zero_quantity() {
        assert!(validate_bid(&bid(0, 3, 0), &None, 10).is_err());
    }

    #[test]
    fn validate_bid_rejects_over_total_dice() {
        assert!(validate_bid(&bid(11, 3, 0), &None, 10).is_err());
    }

    #[test]
    fn validate_bid_rejects_not_higher() {
        assert!(validate_bid(&bid(2, 3, 0), &Some(bid(2, 4, 0)), 10).is_err());
    }

    fn reveal(player_idx: u8, dice: [u8; 5], dice_count: u8) -> Reveal {
        Reveal { player_idx, dice, dice_count }
    }

    #[test]
    fn count_face_reveals_matches_hand_count() {
        // Two players: 5,1,3,1,2 and 6,6,1,4,4 -> count fours.
        // p0: one wild 1 twice = 2 ; p1: two 4s + one wild 1 = 3 -> total 5.
        let reveals = [
            reveal(0, [5, 1, 3, 1, 2], 5),
            reveal(1, [6, 6, 1, 4, 4], 5),
        ];
        assert_eq!(count_face_reveals(&reveals, 4), 5);
    }

    #[test]
    fn count_face_reveals_ones_not_wild_and_respects_count() {
        // Counting ones across a partial hand: only first 3 dice, ones not wild.
        let reveals = [reveal(0, [1, 1, 6, 1, 1], 3)];
        assert_eq!(count_face_reveals(&reveals, 1), 2);
    }

    #[test]
    fn validate_bid_accepts_first_and_raise() {
        assert!(validate_bid(&bid(1, 6, 0), &None, 10).is_ok());
        assert!(validate_bid(&bid(3, 2, 0), &Some(bid(2, 6, 0)), 10).is_ok());
    }
}
