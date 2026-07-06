use anchor_lang::prelude::*;

pub mod errors;
pub mod logic;
pub mod state;

pub use errors::*;
pub use logic::*;
pub use state::*;

declare_id!("F1uoshrHSQh3pEYmT2gQ5p2UBauH75ryvJ3dECtcR8gA");

#[program]
pub mod liar_dice {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("liar_dice program: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
