use anchor_lang::prelude::*;

declare_id!("2qqDQ8RadpzattcT4mAcxuzrLjrvsmz3NXDqf72pmyYR");


#[account]
pub struct DonationService {
    pub owner: Pubkey,
    pub last_fundraising_id: u64
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
    #[account(init, payer=owner, space=8 + 32+8)]
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
    #[account(init, payer=user, space = 8 + 32+8+8+1, seeds=[b"fundraising", donation_service.last_fundraising_id.to_le_bytes().as_ref()], bump)]
    pub fundraising: Account<'info, Fundraising>,
    
    pub system_program: Program<'info, System>
}

#[derive(Accounts)]
#[instruction(fundraising_id: u64)]
pub struct Donate<'info> {
    #[account(mut)]
    pub donater: Signer<'info>,
    #[account(init_if_needed, payer=donater, space = 8 + 8+1, seeds = [b"donater-info", fundraising_id.to_le_bytes().as_ref(), donater.key().as_ref()], bump)]
    pub donater_info: Account<'info, DonaterInfo>,
    #[account(mut)]
    pub donation_service: Account<'info, DonationService>,
    #[account(mut, seeds=[b"fundraising", fundraising_id.to_le_bytes().as_ref()], bump)]
    pub fundraising: Account<'info, Fundraising>,
    pub system_program: Program<'info, System>

}

#[program]
pub mod solana_donation {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let donation_service_account = &mut ctx.accounts.donation_service;
        donation_service_account.owner = ctx.accounts.owner.key();
        Ok(())
    }

    pub fn create_fundraising(ctx: Context<CreateFundraising>) -> Result<()> {
        // let donation_service_account = &mut ctx.accounts.donation_service;
        // let new_fundraising_id = donation_service_account.last_fundraising_id;
        // donation_service_account.last_fundraising_id += 1;

        // let fundraising_account = &mut ctx.accounts.fundraising;
        // fundraising_account.bump = *ctx.bumps.get("fundraising").unwrap();
        // fundraising_account.id = new_fundraising_id;
        // fundraising_account.owner = ctx.accounts.user.key();
        Ok(())
    }

    pub fn donate(ctx: Context<Donate>, amount: u64) -> Result<()> {
        let donation_service_account = &mut ctx.accounts.donation_service;
        let fundraising_account = &mut ctx.accounts.fundraising;
        fundraising_account.total_sum += amount;

        Ok(())
    }

}

