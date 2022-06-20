use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_lang::system_program::{transfer};

declare_id!("4MgS65CAEk8NN8EWt41SZU9cFpZ5xbaG5QeS5HL9b8kB");

#[program]
pub mod anchor_escrow {
    use super::*;

    pub fn init(
        ctx: Context<Init>,
        _escrow_account_bump:u8
    ) -> Result<()> 
    {
        msg!("Acer 6/5");
        ctx.accounts.escrow_account.index = 0;
        Ok(())
    }

    pub fn stake(
        ctx: Context<Stake>,
        amount: u64,
    ) -> Result<()> {
        ctx.accounts.user_escrow_account.staker = *ctx.accounts.staker.to_account_info().key;
        ctx.accounts.user_escrow_account.amount = amount;
        ctx.accounts.user_escrow_account.index = ctx.accounts.escrow_account.index;
        
        // transfer SOL to vault
        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.staker.to_account_info(),
                to: ctx.accounts.vault_account.to_account_info()
            }
        );
        transfer(cpi_ctx, amount)?;
        
        // update stake_index
        ctx.accounts.escrow_account.index = ctx.accounts.escrow_account.index + 1;
        Ok(())
    }

    pub fn cancel(
        ctx: Context<Cancel>,
        _stake_index: u64,
    ) -> Result<()> {
        
        // refund SOL
        let amount:u64 = ctx.accounts.user_escrow_account.amount;

        let from: AccountInfo = ctx.accounts.vault_account.to_account_info();
        let to: AccountInfo = ctx.accounts.staker.to_account_info();
        **from.try_borrow_mut_lamports()? -= amount;
        **to.try_borrow_mut_lamports()? += amount;
        
        // 
        Ok(())
    }

    pub fn release(
        ctx: Context<Release>,
    ) -> Result<()> {
        let amount:u64 = ctx.accounts.user_escrow_account.amount;
        let from: AccountInfo = ctx.accounts.vault_account.to_account_info();
        let to: AccountInfo = ctx.accounts.receiver.to_account_info();
        **from.try_borrow_mut_lamports()? -= amount;
        **to.try_borrow_mut_lamports()? += amount;
        
        
        // update stake_index
        Ok(())
    }
    
}
#[derive(Accounts)]
#[instruction(escrow_account_bump: u8)]
pub struct Init<'info>
{
    #[account(
        init,
        seeds = [b"escrow".as_ref()],
        bump,
        payer = payer,
        space = 8 + EscrowAccount::LEN
    )]
    pub escrow_account: Box<Account<'info, EscrowAccount>> ,
    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(
        init,
        seeds = [b"vault".as_ref()],
        bump,
        payer = payer,
        space = 8 + VaultAccount::LEN
    )]
    pub vault_account: Account<'info, VaultAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>
}



#[derive(Accounts)]
#[instruction(amount:u64)]
pub struct Stake<'info> {
    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(
        mut, 
        signer,
        constraint = staker.lamports() > amount
    )]
    pub staker: AccountInfo<'info>,
    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(mut)]
    pub vault_account: AccountInfo<'info>,
    #[account(mut)]
    pub escrow_account: Account<'info, EscrowAccount>,
    #[account(
        init,
        seeds = [staker.key().as_ref(), escrow_account.index.to_string().as_ref()],
        bump,
        payer = staker,
        space = 8 + UserEscrowAccount::LEN
    )]
    pub user_escrow_account: Account<'info, UserEscrowAccount> ,
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Release<'info> {
    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(signer, mut)]
    pub staker: AccountInfo<'info>,

    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(mut)]
    pub receiver: AccountInfo<'info>,
    
    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(mut)]
    pub escrow_account: AccountInfo<'info>,
    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(mut)]
    pub vault_account: AccountInfo<'info>,
    #[account(
        mut,
        has_one=staker
    )]
    pub user_escrow_account: Account<'info, UserEscrowAccount>,
    pub system_program: Program<'info, System>
}
#[derive(Accounts)]
#[instruction(stake_index:u64)]
pub struct Cancel<'info>
{
    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(signer, mut)]
    pub staker: AccountInfo<'info>,

    #[account(mut)]
    pub vault_account: Account<'info, VaultAccount>,

    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(
        mut,
        has_one = staker,
        constraint = user_escrow_account.index == stake_index
    )]
    pub user_escrow_account: Account<'info, UserEscrowAccount>
}

// Escrow Account
#[account]
pub struct EscrowAccount {
    pub index: u64
}
impl EscrowAccount {
    pub const LEN: usize = 8;
}

// Vault Account
#[account]
pub struct VaultAccount {
    pub data: u64
}
impl VaultAccount {
    pub const LEN: usize = 8;
}

// User Escrow Account
#[account]
pub struct UserEscrowAccount {
    pub index: u64,
    pub amount: u64,
    pub staker: Pubkey,
    pub stake_time: u64
}
impl UserEscrowAccount{
    pub const LEN: usize = 8 + 8 + 32 +8;
}