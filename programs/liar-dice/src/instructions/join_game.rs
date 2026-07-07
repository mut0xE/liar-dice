use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::errors::LiarDiceError;
use crate::state::*;

/// Join a `Waiting` game: pay the entry fee into the pot and create the player's private `PlayerHand` PDA.
pub fn join_game(ctx: Context<JoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Game must be open, not full, and you must not already be in it.
    require!(game.status == GameStatus::Waiting, LiarDiceError::BadGameState);
    require!(game.players.len() < MAX_PLAYERS, LiarDiceError::TableFull);
    require!(
        game.player_index(&ctx.accounts.player.key()).is_none(),
        LiarDiceError::AlreadyJoined
    );

    // Pay the entry fee into the vault, growing the prize pot.
    if game.entry_fee_lamports > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.player.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            game.entry_fee_lamports,
        )?;
        game.pot_lamports = game
            .pot_lamports
            .checked_add(game.entry_fee_lamports)
            .ok_or(LiarDiceError::Overflow)?;
    }

    // Register the player in the game's parallel arrays.
    game.players.push(ctx.accounts.player.key());
    game.dice_counts.push(STARTING_DICE);
    game.is_active.push(true);

    // Initialize the player's private hand with a full set of dice, unrolled.
    ctx.accounts.player_hand.set_inner(PlayerHand {
        game: game.key(),
        player: ctx.accounts.player.key(),
        dice: [0; 5],
        dice_count: STARTING_DICE,
        rolled: false,
        revealed: false,
        rolled_round: 0,
        bump: ctx.bumps.player_hand,
    });

    // Pre-fund the hand PDA with rent for its ephemeral permission, spent later on the ER by `init_hand_permission`.
    let permission_rent = ephemeral_rollups_sdk::ephemeral_accounts::rent(
        ephemeral_rollups_sdk::access_control::structs::EphemeralPermission::size_of(1) as u32,
    );
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.player.to_account_info(),
                to: ctx.accounts.player_hand.to_account_info(),
            },
        ),
        permission_rent,
    )?;
    Ok(())
}

#[derive(Accounts)]
pub struct JoinGame<'info> {
    /// The player joining. Pays the entry fee and rent for their hand account.
    #[account(mut)]
    pub player: Signer<'info>,

    /// The game being joined.
    #[account(mut)]
    pub game: Account<'info, Game>,

    /// The game's vault PDA that holds the prize pot. Entry fees are sent here.
    #[account(mut, seeds = [VAULT_SEED, game.key().as_ref()], bump)]
    pub vault: SystemAccount<'info>,

    /// This player's private dice, a PDA unique to (game, player).
    #[account(
        init,
        payer = player,
        space = PlayerHand::SPACE,
        seeds = [HAND_SEED, game.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub player_hand: Account<'info, PlayerHand>,

    pub system_program: Program<'info, System>,
}
