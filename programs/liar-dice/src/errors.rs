use anchor_lang::prelude::*;

#[error_code]
pub enum LiarDiceError {
    #[msg("Not your turn")]
    NotYourTurn,
    #[msg("Game not in the required state")]
    BadGameState,
    #[msg("Bid face must be 1..=6")]
    InvalidFace,
    #[msg("Bid quantity must be >= 1")]
    InvalidQuantity,
    #[msg("Bid exceeds total dice in play")]
    BidTooLarge,
    #[msg("Bid must be strictly higher")]
    BidNotHigher,
    #[msg("No current bid to challenge")]
    NothingToChallenge,
    #[msg("Dice not rolled yet")]
    NotRolled,
    #[msg("Table is full")]
    TableFull,
    #[msg("Need at least 2 players")]
    NotEnoughPlayers,
    #[msg("Player already eliminated")]
    Eliminated,
    #[msg("Player already joined this game")]
    AlreadyJoined,
    #[msg("Incorrect payment amount")]
    BadPayment,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("A required player hand was not provided")]
    MissingHand,
    #[msg("Duplicate hand provided")]
    DuplicateHand,
    #[msg("Game does not have a single winner yet")]
    NoWinner,
    #[msg("No settled round to process")]
    NotSettled,
    #[msg("Dice already rolled for this round")]
    AlreadyRolled,
    #[msg("Timeout grace must be > 0")]
    InvalidTimeout,
    #[msg("The action deadline has not passed yet")]
    DeadlineNotReached,
    #[msg("Target player is not the one holding up the game")]
    NotStalling,
}
