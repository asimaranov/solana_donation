use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};

declare_id!("2qqDQ8RadpzattcT4mAcxuzrLjrvsmz3NXDqf72pmyYR");

#[account]
pub struct DonationService {
    pub owner: Pubkey,
    pub fundraisings_num: u64,
    pub total_fee: u64,
    pub owner_fee_percent: u64,
    pub free_chrt_threshold: u64,
    pub bump: u8
}

impl DonationService {
    pub const MAX_SIZE: usize = 32 + 8*4 + 1;
}

#[account]
pub struct Fundraising {
    pub owner: Pubkey,
    pub id: u64,
    pub total_sum: u64,
    pub total_chrt_sum: u64,
    pub is_finished: bool,
    pub bump: u8
}

impl Fundraising {
    pub const MAX_SIZE: usize = 32 + 8*3 + 1*2;
}

#[account]
pub struct DonaterInfo {
    pub total_sum: u64,
    pub bump: u8,
}

impl DonaterInfo {
    pub const MAX_SIZE: usize = 8+1;
}


#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer=owner, space=8 + DonationService::MAX_SIZE, seeds=[b"state"], bump)]
    pub donation_service: Account<'info, DonationService>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>
}

#[derive(Accounts)]
pub struct CreateFundraising<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub donation_service: Account<'info, DonationService>,
    #[account(init, payer=owner, space = 8 + Fundraising::MAX_SIZE, seeds=[b"fundraising", donation_service.fundraisings_num.to_le_bytes().as_ref()], bump)]
    pub fundraising: Account<'info, Fundraising>,
    
    pub system_program: Program<'info, System>
}

#[derive(Accounts)]
#[instruction(amount: u64, fundraising_id: u64)]
pub struct Donate<'info> {
    #[account(mut)]
    pub donater: Signer<'info>,
    #[account(init_if_needed, payer=donater, space = 8 + DonaterInfo::MAX_SIZE, seeds = [b"donater-info", fundraising_id.to_le_bytes().as_ref(), donater.key().as_ref()], bump)]
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

#[derive(Accounts)]
#[instruction(amount: u64, fundraising_id: u64)]
pub struct DonateCHRT<'info> {
    #[account(mut)]
    pub donater: Signer<'info>,
    #[account(mut, seeds=[b"fundraising", fundraising_id.to_le_bytes().as_ref()], bump)]
    pub fundraising: Account<'info, Fundraising>,
    #[account(mut, seeds=[b"state"], bump)]
    pub donation_service: Account<'info, DonationService>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>
}

#[derive(Accounts)]
#[instruction(fundraising_id: u64)]
pub struct Withdraw<'info> {
    #[account(mut, seeds=[b"state"], bump)]
    pub donation_service: Account<'info, DonationService>,
    #[account(mut, seeds=[b"fundraising", fundraising_id.to_le_bytes().as_ref()], bump)]
    pub fundraising: Account<'info, Fundraising>,
    #[account(mut)]
    pub fundraising_owner: Signer<'info>,
    pub system_program: Program<'info, System>,

}

#[error_code]
pub enum DonationError {
    #[msg("Only funding owner can call this")]
    NotFundingOwner,
    #[msg("Fundraising has been finished")]
    FundraisingFinished,

}

#[program]
pub mod solana_donation {

    use anchor_lang::solana_program::{system_instruction, program::{invoke, invoke_signed}};
    use anchor_spl::token::{Mint, MintTo, self, Transfer};

    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner_fee_percent: u64, free_chrt_threshold: u64) -> Result<()> {
        let donation_service_account = &mut ctx.accounts.donation_service;
        donation_service_account.owner = ctx.accounts.owner.key();
        donation_service_account.bump = *ctx.bumps.get("donation_service").unwrap();
        donation_service_account.owner_fee_percent = owner_fee_percent;
        donation_service_account.free_chrt_threshold = free_chrt_threshold;
        Ok(())
    }

    pub fn create_fundraising(ctx: Context<CreateFundraising>) -> Result<()> {
        let donation_service_account = &mut ctx.accounts.donation_service;
        let new_fundraising_id = donation_service_account.fundraisings_num;
        donation_service_account.fundraisings_num += 1;

        let fundraising_account = &mut ctx.accounts.fundraising;
        fundraising_account.bump = *ctx.bumps.get("fundraising").unwrap();
        fundraising_account.id = new_fundraising_id;
        fundraising_account.owner = ctx.accounts.owner.key();
        Ok(())
    }

    pub fn donate(ctx: Context<Donate>, amount: u64, fundraising_id: u64) -> Result<()> {
        let fundraising_account = &mut ctx.accounts.fundraising;

        require!(!fundraising_account.is_finished, DonationError::FundraisingFinished);

        let donation_account = &mut ctx.accounts.donation_service;

        let donater_account = &mut ctx.accounts.donater;

        let fee: u64 = if fundraising_account.total_chrt_sum < donation_account.free_chrt_threshold {amount / 100 * donation_account.owner_fee_percent} else {0};
        let sum_to_donate = amount - fee;

        let donation_transfer_instruction = system_instruction::transfer(&donater_account.key(), &fundraising_account.key(), sum_to_donate);

        invoke(&donation_transfer_instruction, &[
            donater_account.to_account_info(),
            fundraising_account.to_account_info()
        ])?;
        
        if fee > 0 {
            let fee_transfer_instruction = system_instruction::transfer(&donater_account.key(), &donation_account.key(), fee);

            invoke(&fee_transfer_instruction, &[
                donater_account.to_account_info(),
                donation_account.to_account_info()
            ])?;    
        }

        fundraising_account.total_sum += sum_to_donate;
        donation_account.total_fee += fee;

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

    pub fn donate_chrt(ctx: Context<DonateCHRT>, amount: u64, fundraising_id: u64) -> Result<()>{
        let fundraising_account = &mut ctx.accounts.fundraising;
        let donater_account = &mut ctx.accounts.donater;
        let donation_account = &mut ctx.accounts.donation_service;

        let state_bump = donation_account.bump.to_le_bytes();

        let inner = vec![
            b"state".as_ref(),
            state_bump.as_ref()
        ];
        let outer = vec![inner.as_slice()];

        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), 
            Transfer{ from: donater_account.to_account_info(), to: fundraising_account.to_account_info(), authority: donation_account.to_account_info() }, 
            outer.as_slice()
        );
        token::transfer(cpi_ctx, amount)?;
        fundraising_account.total_chrt_sum += amount;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, fundraising_id: u64) -> Result<()> {
        let fundraising_account = &mut ctx.accounts.fundraising;
        let fundraising_owner_account = &mut ctx.accounts.fundraising_owner;

        fundraising_account.is_finished = true;

        require!(fundraising_account.owner == fundraising_owner_account.key(), DonationError::NotFundingOwner);

        let transfer_instruction = 
        system_instruction::transfer(&fundraising_account.key(), &fundraising_owner_account.key(), fundraising_account.total_sum);

        let fundraising_bump = fundraising_account.bump.to_le_bytes();
        let fundraising_id_packed = fundraising_id.to_le_bytes();
                
        invoke_signed(&transfer_instruction, &[fundraising_account.to_account_info(), fundraising_owner_account.to_account_info()], 
        &[&[ &b"fundraising".as_ref(), fundraising_id_packed.as_ref(), fundraising_bump.as_ref() ]])?;
        fundraising_account.total_sum = 0;
        Ok(())
    }

}

