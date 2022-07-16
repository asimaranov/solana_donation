use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};

declare_id!("2qqDQ8RadpzattcT4mAcxuzrLjrvsmz3NXDqf72pmyYR");

#[account]
pub struct DonationService {
    pub owner: Pubkey,
    pub fundraisings_num: u64,
    pub bump: u8
}

#[account]
pub struct Fundraising {
    pub owner: Pubkey,
    pub id: u64,
    pub total_sum: u64,
    pub bump: u8
}

#[account]
pub struct DonaterInfo {
    pub total_sum: u64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer=owner, space=8 + 32+8+1, seeds=[b"state"], bump)]
    pub donation_service: Account<'info, DonationService>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>
}

#[derive(Accounts)]
pub struct CreateFundraising<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub donation_service: Account<'info, DonationService>,
    #[account(init, payer=user, space = 8 + 32+8+8+1, seeds=[b"fundraising", donation_service.fundraisings_num.to_le_bytes().as_ref()], bump)]
    pub fundraising: Account<'info, Fundraising>,
    
    pub system_program: Program<'info, System>
}

#[derive(Accounts)]
#[instruction(amount: u64, fundraising_id: u64)]
pub struct Donate<'info> {
    #[account(mut)]
    pub donater: Signer<'info>,
    #[account(init_if_needed, payer=donater, space = 8 + 8+1, seeds = [b"donater-info", fundraising_id.to_le_bytes().as_ref(), donater.key().as_ref()], bump)]
    pub donater_info: Account<'info, DonaterInfo>,
    #[account(mut, seeds=[b"state"], bump)]
    pub donation_service: Account<'info, DonationService>,
    #[account(mut, seeds=[b"fundraising", fundraising_id.to_le_bytes().as_ref()], bump)]
    pub fundraising: Account<'info, Fundraising>,
    #[account(mut)]
    pub chrt_mint: Account<'info, Mint>,
    #[account(mut, token::mint=chrt_mint)]
    pub referrer_chrt_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[program]
pub mod solana_donation {
    use anchor_lang::solana_program::{system_instruction, program::invoke};
    use anchor_spl::token::{Mint, MintTo, self};

    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let donation_service_account = &mut ctx.accounts.donation_service;
        donation_service_account.owner = ctx.accounts.owner.key();
        donation_service_account.bump = *ctx.bumps.get("donation_service").unwrap();
        Ok(())
    }

    pub fn create_fundraising(ctx: Context<CreateFundraising>) -> Result<()> {
        let donation_service_account = &mut ctx.accounts.donation_service;
        let new_fundraising_id = donation_service_account.fundraisings_num;
        donation_service_account.fundraisings_num += 1;

        let fundraising_account = &mut ctx.accounts.fundraising;
        fundraising_account.bump = *ctx.bumps.get("fundraising").unwrap();
        fundraising_account.id = new_fundraising_id;
        fundraising_account.owner = ctx.accounts.user.key();
        Ok(())
    }

    pub fn donate(ctx: Context<Donate>, amount: u64, fundraising_id: u64) -> Result<()> {

        let fundraising_account = &mut ctx.accounts.fundraising;
        let donation_account = &mut ctx.accounts.donation_service;

        let donater_account = &mut ctx.accounts.donater;

        let transfer_instruction = system_instruction::transfer(&donater_account.key(), &fundraising_account.key(), amount);

        invoke(&transfer_instruction, &[
            donater_account.to_account_info(),
            fundraising_account.to_account_info()
        ])?;
        fundraising_account.total_sum += amount;

        let state_bump = donation_account.bump.to_le_bytes();

        let inner = vec![
            b"state".as_ref(),
            state_bump.as_ref()

        ];
        let outer = vec![inner.as_slice()];

        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), 
        MintTo{
            to: ctx.accounts.referrer_chrt_account.to_account_info(),
            mint: ctx.accounts.chrt_mint.to_account_info(),
            authority: ctx.accounts.donation_service.to_account_info(),
        }, outer.as_slice());
        token::mint_to(cpi_ctx, amount * 101)?;
        

        Ok(())
    }

}

