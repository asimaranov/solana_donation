use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use borsh::{BorshSerialize, BorshDeserialize};
declare_id!("2qqDQ8RadpzattcT4mAcxuzrLjrvsmz3NXDqf72pmyYR");

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct DonaterTopInfo {
    pub total_sum: u64,
    pub chrt_wallet: Pubkey,
}

impl DonaterTopInfo {
    pub const MAX_SIZE: usize = 8 + 32;
}

#[account]
pub struct DonationService {
    pub owner: Pubkey,
    pub fundraisings_num: u64,
    pub total_fee: u64,
    pub owner_fee_percent: u64,
    pub no_fee_chrt_threshold: u64,
    pub finish_chrt_threshold: u64,
    pub reward_period_seconds: u64,
    pub reward_chrt_amount: u64, 
    pub top_donaters: [Option<DonaterTopInfo>; 1],
    pub bump: u8
}

impl DonationService {
    pub const MAX_SIZE: usize = 32 + 8*7 + DonaterTopInfo::MAX_SIZE*1 + 1;
}

#[account]
pub struct Fundraising {
    pub owner: Pubkey,
    pub id: u64,
    pub total_sum: u64,
    pub total_no_fee_chrt_sum: u64,
    pub total_finish_chrt_sum: u64,
    pub is_finished: bool,
    pub top_donaters: [Option<DonaterTopInfo>; 3],
    pub bump: u8
}

impl Fundraising {
    pub const MAX_SIZE: usize = 32 + 8*4 + 1*3 + DonaterTopInfo::MAX_SIZE * 3;
}

#[account]
pub struct DonaterInfo {
    pub total_sum: u64,
    pub chrt_wallet: Pubkey,
    pub bump: u8,
}

impl DonaterInfo {
    pub const MAX_SIZE: usize = 8+32+1;
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
    pub donater_chrt_account: Account<'info, TokenAccount>,
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

#[derive(Accounts)]
pub struct WithdrawFee<'info> {
    #[account(mut, seeds=[b"state"], bump)]
    pub donation_service: Account<'info, DonationService>,
    #[account(mut)]
    pub donation_service_owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}


#[error_code]
pub enum DonationError {
    #[msg("Only funding owner can call this")]
    NotFundingOwner,
    #[msg("Fundraising has been finished")]
    FundraisingFinished,
    #[msg("Only donation service owner can call this")]
    NotOwner,
    #[msg("Unable to donate 0 lamports")]
    ZeroDonation,
}

#[program]
pub mod solana_donation {

    use anchor_lang::{solana_program::{system_instruction, program::{invoke, invoke_signed}}, system_program};
    use anchor_spl::token::{MintTo, self, Transfer};

    use super::*;

    pub fn initialize(ctx: Context<Initialize>, reward_period_seconds: u64, owner_fee_percent: u64, reward_chrt_amount: u64, no_fee_chrt_threshold: u64, finish_chrt_threshold: u64) -> Result<()> {
        let donation_service_account = &mut ctx.accounts.donation_service;
        donation_service_account.reward_period_seconds = reward_period_seconds;
        donation_service_account.owner_fee_percent = owner_fee_percent;
        donation_service_account.reward_chrt_amount = reward_chrt_amount;
        donation_service_account.no_fee_chrt_threshold = no_fee_chrt_threshold;
        donation_service_account.finish_chrt_threshold = finish_chrt_threshold;

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
        fundraising_account.owner = ctx.accounts.owner.key();
        Ok(())
    }

    pub fn donate(ctx: Context<Donate>, amount: u64, fundraising_id: u64) -> Result<()> {

        require!(amount > 0, DonationError::ZeroDonation);

        let fundraising_account = &mut ctx.accounts.fundraising;

        require!(!fundraising_account.is_finished, DonationError::FundraisingFinished);

        let donation_account = &mut ctx.accounts.donation_service;
        let donater_account = &mut ctx.accounts.donater;
        let donater_info_account = &mut ctx.accounts.donater_info;
        let donater_chrt_account = &mut ctx.accounts.donater_chrt_account;

        let fee: u64 = if fundraising_account.total_no_fee_chrt_sum < donation_account.no_fee_chrt_threshold {amount / 100 * donation_account.owner_fee_percent} else {0};
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
        donater_info_account.total_sum += amount;
        donater_info_account.chrt_wallet = donater_chrt_account.key();

        if donater_info_account.total_sum > fundraising_account.top_donaters[2].map_or(0, |x| x.total_sum){
            let mut top_donaters = [fundraising_account.top_donaters[0], 
            fundraising_account.top_donaters[1], 
            Some(DonaterTopInfo{ total_sum: donater_info_account.total_sum, chrt_wallet: donater_info_account.chrt_wallet }), 
            fundraising_account.top_donaters[2], ];
            top_donaters.sort_by(|b, a|{
                let a_sum = a.map_or(0, |x|x.total_sum);
                let b_sum = b.map_or(0, |x|x.total_sum);
                a_sum.cmp(&b_sum)
            });
            fundraising_account.top_donaters[0] = top_donaters[0];
            fundraising_account.top_donaters[1] = top_donaters[1];
            fundraising_account.top_donaters[2] = top_donaters[2];
        }

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

    pub fn donate_chrt(ctx: Context<DonateCHRT>, amount: u64, fundraising_id: u64, no_fee: bool) -> Result<()>{
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
        if no_fee {
            fundraising_account.total_no_fee_chrt_sum += amount;
        } else {
            fundraising_account.total_finish_chrt_sum += amount;
        }
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, fundraising_id: u64) -> Result<()> {
        let fundraising_account = &mut ctx.accounts.fundraising;

        let fundraising_owner_account = &mut ctx.accounts.fundraising_owner;

        fundraising_account.is_finished = true;

        require!(fundraising_account.owner == fundraising_owner_account.key(), DonationError::NotFundingOwner);
                
        **fundraising_account.to_account_info().try_borrow_mut_lamports()? -= fundraising_account.total_sum;
        **fundraising_owner_account.to_account_info().try_borrow_mut_lamports()? += fundraising_account.total_sum;
    
        fundraising_account.total_sum = 0;
        Ok(())
    }

    pub fn wthdraw_fee(ctx: Context<WithdrawFee>) -> Result<()>{

        let donation_account = &mut ctx.accounts.donation_service;
        let service_owner_account = &mut ctx.accounts.donation_service_owner;

        require!(service_owner_account.key() == donation_account.owner, DonationError::NotOwner);

        **donation_account.to_account_info().try_borrow_mut_lamports()? -= donation_account.total_fee;
        **service_owner_account.to_account_info().try_borrow_mut_lamports()? += donation_account.total_fee;

        donation_account.total_fee = 0;
        Ok(())
    }

}

