import * as anchor from "@project-serum/anchor";
import { Program, web3 } from "@project-serum/anchor";
import { BN } from "bn.js";
import { assert } from "chai";
import { SolanaDonation } from "../target/types/solana_donation";
import { approve, createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from '@solana/spl-token';

describe("solana_donation", () => {

  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.SolanaDonation as Program<SolanaDonation>;

  const owner = (program.provider as anchor.AnchorProvider).wallet;

  const fundraisingOwnerAccount = web3.Keypair.generate();
  const payer = web3.Keypair.generate();

  const donater = web3.Keypair.generate();
  const referrer = web3.Keypair.generate();

  let chrtMint: web3.PublicKey;

  const provider = anchor.getProvider()

  const rewardPeriodSeconds = new BN(1);

  const ownerFeePercent = new BN(1);
  const rewardChrtAmount = new BN(1);
  const noFeeChrtThreshold = new BN(1);
  const cancelChrtThreshold = new BN(1);

  it("Test initialization", async () => {

    const [statePda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);

    await program.methods.initialize(rewardPeriodSeconds, ownerFeePercent, rewardChrtAmount, noFeeChrtThreshold, cancelChrtThreshold).accounts({
      donationService: statePda,
      owner: owner.publicKey
    }).signers([]).rpc();

    let donationState = await program.account.donationService.fetch(statePda);
    assert(donationState.fundraisingsNum.eq(new anchor.BN(0)))
    assert(donationState.owner.equals(owner.publicKey))
  });

  it("Test chrt token", async () => {
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(payer.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL));

    const [statePda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);
    chrtMint = await createMint(provider.connection, payer, statePda, null, 3);
  })

  it("Test fundraising creating", async () => {
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(fundraisingOwnerAccount.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL));

    const [donationAccount,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);
    let donationState = await program.account.donationService.fetch(donationAccount);
    const [fundraisingPda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("fundraising"), donationState.fundraisingsNum.toBuffer('le', 8)], program.programId);


    await program.methods.createFundraising().accounts({
      owner: fundraisingOwnerAccount.publicKey,
      donationService: donationAccount,
      fundraising: fundraisingPda,
    }).signers([fundraisingOwnerAccount]).rpc();

    let fundraisingState = await program.account.fundraising.fetch(fundraisingPda);
    assert(fundraisingState.totalSum.eq(new anchor.BN(0)));
    assert(fundraisingState.id.eq(new anchor.BN(0)));
    assert(fundraisingState.owner.equals(fundraisingOwnerAccount.publicKey));

    let donationState1 = await program.account.donationService.fetch(donationAccount);
    assert(donationState1.fundraisingsNum.eq(new anchor.BN(1)));
  });

  it("Test that fundraising id's are correct", async () => {
    const [donationAccount,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);

    let donationState = await program.account.donationService.fetch(donationAccount);

    const [fundraisingPda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("fundraising"), donationState.fundraisingsNum.toBuffer('le', 8)], program.programId);

    await program.methods.createFundraising().accounts({
      owner: fundraisingOwnerAccount.publicKey,
      donationService: donationAccount,
      fundraising: fundraisingPda,
    }).signers([fundraisingOwnerAccount]).rpc();

    let fundraisingState = await program.account.fundraising.fetch(fundraisingPda);
    assert(fundraisingState.totalSum.eq(new anchor.BN(0)));
    assert(fundraisingState.id.eq(new anchor.BN(1)));
    assert(fundraisingState.owner.equals(fundraisingOwnerAccount.publicKey));

    let donationState2 = await program.account.donationService.fetch(donationAccount);
    assert(donationState2.fundraisingsNum.eq(new anchor.BN(2)));
  });

  it("Test donation", async () => {
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(donater.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL));

    const initialDonaterBalance = await provider.connection.getBalance(donater.publicKey);

    let [donationAccount,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);

    const fundraisingId = new BN(0);

    const [fundraisingPda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("fundraising"), fundraisingId.toBuffer('le', 8)], program.programId);

    const [donaterInfo,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("donater-info"), fundraisingId.toBuffer('le', 8), donater.publicKey.toBuffer()], program.programId);

    const sumToDonate = new anchor.BN(1000);

    let referrerTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      chrtMint,
      referrer.publicKey
    );

    await program.methods.donate(sumToDonate, fundraisingId).accounts({
      donater: donater.publicKey,
      donaterInfo: donaterInfo,
      donationService: donationAccount,
      fundraising: fundraisingPda,
      chrtMint: chrtMint,
      referrerChrtAccount: referrerTokenAccount.address,
    }).signers([donater]).rpc()

    const fundraisingState = await program.account.fundraising.fetch(fundraisingPda);

    assert(fundraisingState.totalSum.eq(sumToDonate.mul(new BN(100).sub(ownerFeePercent)).div(new BN(100))));
    const finaleDonaterBalance = await provider.connection.getBalance(donater.publicKey);
    assert(initialDonaterBalance - finaleDonaterBalance >= sumToDonate.toNumber());

    referrerTokenAccount = await getAccount(
      provider.connection,
      referrerTokenAccount.address
    );

    assert(sumToDonate.mul(new BN(101)).eq(new BN(referrerTokenAccount.amount.toString())));

    [donationAccount,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);
    const donationService = await program.account.donationService.fetch(donationAccount);
    assert(donationService.totalFee.eq(sumToDonate.mul(ownerFeePercent).div(new BN(100))))
  });

  it("Test withrawing", async () => {
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(donater.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL));

    const [donationAccount,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);

    const fundraisingId = new BN(0);

    const [fundraisingPda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("fundraising"), fundraisingId.toBuffer('le', 8)], program.programId);

    await program.methods.withdraw(fundraisingId).accounts({
      donationService: donationAccount,
      fundraising: fundraisingPda,
      fundraisingOwner: fundraisingOwnerAccount.publicKey,
    }).signers([fundraisingOwnerAccount]).rpc()

  });

  it("Test fee withdrawing", async () => {
    const [donationAccount,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);
    const donationService = await program.account.donationService.fetch(donationAccount);
    assert(donationService.totalFee.gtn(0));

    await program.methods.withdrawFee().accounts({
      donationService: donationAccount,
      donationServiceOwner: owner.publicKey,
    }).rpc()
  });

  it("Test top donation tracking", async () => {
    const fundraisingId = new BN(0);
    const [donationPda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);
    const donationService = await program.account.donationService.fetch(donationPda);
    const [fundraisingPda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("fundraising"), fundraisingId.toBuffer('le', 8)], program.programId);
    const fundraisingState = await program.account.fundraising.fetch(fundraisingPda);
    assert(fundraisingState.topDonaters[0].totalSum.eq(new BN(1000)));
    assert(donationService.topDonaters[0].totalSum.eq(new BN(1000)));
  });

  it("Test chrt donating to disable fee", async () => {
    const fundraisingId = new BN(1);

    const [fundraisingPda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("fundraising"), fundraisingId.toBuffer('le', 8)], program.programId);

    const [statePda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);
    const chrtToDonateAmount = noFeeChrtThreshold.add(new BN(1));

    const fundraisingTokenAccount = await getOrCreateAssociatedTokenAccount(provider.connection, payer, chrtMint, fundraisingPda, true);
    const referrerTokenAccount = await getOrCreateAssociatedTokenAccount(provider.connection, payer, chrtMint, referrer.publicKey);

    await program.methods.donateChrt(chrtToDonateAmount, fundraisingId, true).accounts({
      donater: referrer.publicKey,
      fundraising: fundraisingPda,
      donationService: statePda,
      donaterTokenAccount: referrerTokenAccount.address,
      fundraisingTokenAccount: fundraisingTokenAccount.address
    }).signers([referrer]).rpc();

    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(donater.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL));

    let [donationAccount,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);

    const [donaterInfo,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("donater-info"), fundraisingId.toBuffer('le', 8), donater.publicKey.toBuffer()], program.programId);

    const sumToDonate = new anchor.BN(1000);

    await program.methods.donate(sumToDonate, fundraisingId).accounts({
      donater: donater.publicKey,
      donaterInfo: donaterInfo,
      donationService: donationAccount,
      fundraising: fundraisingPda,
      chrtMint: chrtMint,
      referrerChrtAccount: referrerTokenAccount.address
    }).signers([donater]).rpc()

    const fundraisingState = await program.account.fundraising.fetch(fundraisingPda);
    assert(fundraisingState.totalSum.eq(sumToDonate));

    const donationState = await program.account.donationService.fetch(donationAccount);
    assert(donationState.totalDroppedFee.eq(sumToDonate.mul(ownerFeePercent).div(new BN(100))));

  });

  it("Test chrt donating to cancel fundraising", async () => {
    const fundraisingId = new BN(0);

    const [fundraisingPda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("fundraising"), fundraisingId.toBuffer('le', 8)], program.programId);

    const [statePda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);
    const chrtToDonateAmount = new BN(1_000);

    const fundraisingTokenAccount = await getOrCreateAssociatedTokenAccount(provider.connection, payer, chrtMint, fundraisingPda, true);
    const referrerTokenAccount = await getOrCreateAssociatedTokenAccount(provider.connection, payer, chrtMint, referrer.publicKey);

    await program.methods.donateChrt(chrtToDonateAmount, fundraisingId, false).accounts({
      donater: referrer.publicKey,
      fundraising: fundraisingPda,
      donationService: statePda,
      donaterTokenAccount: referrerTokenAccount.address,
      fundraisingTokenAccount: fundraisingTokenAccount.address
    }).signers([referrer]).rpc();

  });

  it("Test fundraising top users correctness", async () => {

    const fundraisingId = new BN(2);
    const [fundraisingPda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("fundraising"), fundraisingId.toBuffer('le', 8)], program.programId);
    const [donationPda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);

    await program.methods.createFundraising().accounts({
      owner: owner.publicKey,
      donationService: donationPda,
      fundraising: fundraisingPda
    }).rpc();

    const user1 = web3.Keypair.generate();
    const user2 = web3.Keypair.generate();
    const user3 = web3.Keypair.generate();
    const user4 = web3.Keypair.generate();

    const [user1DonaterInfoPda,] = await web3.PublicKey.findProgramAddress(
      [anchor.utils.bytes.utf8.encode("donater-info"),
      fundraisingId.toBuffer('le', 8),
      user1.publicKey.toBuffer()], program.programId);

    const [user2DonaterInfoPda,] = await web3.PublicKey.findProgramAddress(
      [anchor.utils.bytes.utf8.encode("donater-info"),
      fundraisingId.toBuffer('le', 8),
      user2.publicKey.toBuffer()], program.programId);


    const [user3DonaterInfoPda,] = await web3.PublicKey.findProgramAddress(
      [anchor.utils.bytes.utf8.encode("donater-info"),
      fundraisingId.toBuffer('le', 8),
      user3.publicKey.toBuffer()], program.programId);
    
    const [user4DonaterInfoPda,] = await web3.PublicKey.findProgramAddress(
      [anchor.utils.bytes.utf8.encode("donater-info"),
      fundraisingId.toBuffer('le', 8),
      user4.publicKey.toBuffer()], program.programId);
  
    const user1Donation = 10_000;
    const user2Donation = 50_000;
    const user3Donation = 20_000;
    const user4Donation = 100_000;

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user1.publicKey, user1Donation * anchor.web3.LAMPORTS_PER_SOL)
    );

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user2.publicKey, user2Donation * anchor.web3.LAMPORTS_PER_SOL)
    );

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user3.publicKey, user3Donation * anchor.web3.LAMPORTS_PER_SOL)
    );

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user4.publicKey, user4Donation * anchor.web3.LAMPORTS_PER_SOL)
    );

    const referrerChrtAccount = await getOrCreateAssociatedTokenAccount(provider.connection, payer, chrtMint, referrer.publicKey);

    await program.methods.donate(new BN(user1Donation), fundraisingId).accounts({
          donater: user1.publicKey, 
          donaterInfo: user1DonaterInfoPda,
          donationService: donationPda,
          fundraising: fundraisingPda,
          chrtMint: chrtMint,
          referrerChrtAccount: referrerChrtAccount.address
    
        }).signers([user1]).rpc();

    
      await program.methods.donate(new BN(user2Donation), fundraisingId).accounts({
        donater: user2.publicKey, 
        donaterInfo: user2DonaterInfoPda,
        donationService: donationPda,
        fundraising: fundraisingPda,
        chrtMint: chrtMint,
        referrerChrtAccount: referrerChrtAccount.address
  
      }).signers([user2]).rpc();

      await program.methods.donate(new BN(user3Donation), fundraisingId).accounts({
        donater: user3.publicKey, 
        donaterInfo: user3DonaterInfoPda,
        donationService: donationPda,
        fundraising: fundraisingPda,
        chrtMint: chrtMint,
        referrerChrtAccount: referrerChrtAccount.address
  
      }).signers([user3]).rpc();

      await program.methods.donate(new BN(user4Donation), fundraisingId).accounts({
        donater: user4.publicKey, 
        donaterInfo: user4DonaterInfoPda,
        donationService: donationPda,
        fundraising: fundraisingPda,
        chrtMint: chrtMint,
        referrerChrtAccount: referrerChrtAccount.address
  
      }).signers([user4]).rpc();
    
    const fundraisingState = await program.account.fundraising.fetch(fundraisingPda);

    assert(fundraisingState.topDonaters[0].totalSum.eq(new BN(user4Donation)));
    assert(fundraisingState.topDonaters[1].totalSum.eq(new BN(user2Donation)));
    assert(fundraisingState.topDonaters[2].totalSum.eq(new BN(user3Donation)));

    const donationServiceState = await program.account.donationService.fetch(donationPda);
    assert(donationServiceState.topDonaters[0].totalSum.eq(new BN(user4Donation)));
    assert(donationServiceState.topDonaters[1].totalSum.eq(new BN(user2Donation)));
    assert(donationServiceState.topDonaters[2].totalSum.eq(new BN(user3Donation)));

  });
});
