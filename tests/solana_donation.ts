import * as anchor from "@project-serum/anchor";
import { Program, web3 } from "@project-serum/anchor";
import { BN } from "bn.js";
import { assert } from "chai";
import { SolanaDonation } from "../target/types/solana_donation";
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from '@solana/spl-token';

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
  const rewardChrtAmount = new BN(2);
  const noFeeChrtThreshold = new BN(1);
  const cancelChrtThreshold = new BN(1);
  const sumToDonate = new anchor.BN(1000);

  const user1 = web3.Keypair.generate();
  const user2 = web3.Keypair.generate();
  const user3 = web3.Keypair.generate();
  const user4 = web3.Keypair.generate();

  const user1Donation = 10_000;
  const user2Donation = 50_000;
  const user3Donation = 20_000;
  const user4Donation = 100_000;

  const fundraisingId1 = new BN(0);
  const fundraisingId2 = new BN(1);
  const fundraisingId3 = new BN(2);
  const fundraisingId4 = new BN(3);
  const fundraisingId5 = new BN(4);

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

  it("Test fundraising creation", async () => {
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(fundraisingOwnerAccount.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL));

    const [donationAccount,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);
    
    for (let i = 0; i < 5; i++) {
      let donationState = await program.account.donationService.fetch(donationAccount);

      const [fundraisingPda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("fundraising"), donationState.fundraisingsNum.toBuffer('le', 8)], program.programId);
      
      await program.methods.createFundraising().accounts({
        owner: fundraisingOwnerAccount.publicKey,
        donationService: donationAccount,
        fundraising: fundraisingPda,
      }).signers([fundraisingOwnerAccount]).rpc();

      let fundraisingState = await program.account.fundraising.fetch(fundraisingPda);

      assert(fundraisingState.totalSum.eq(new anchor.BN(0)));
      assert(fundraisingState.id.eq(new anchor.BN(i)));
      assert(fundraisingState.owner.equals(fundraisingOwnerAccount.publicKey));

      let donationState1 = await program.account.donationService.fetch(donationAccount);
      assert(donationState1.fundraisingsNum.eq(new anchor.BN(i+1)));
    }
  });

  it("Test that user can't create a fundraising with incorrect id", async () => {
    const fundraisingId = new BN(1337);

    const [donationAccount,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);    
    const [fundraisingPda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("fundraising"), fundraisingId.toBuffer('le', 8)], program.programId);
    try {
      await program.methods.createFundraising().accounts({
        owner: fundraisingOwnerAccount.publicKey,
        donationService: donationAccount,
        fundraising: fundraisingPda,
      }).signers([fundraisingOwnerAccount]).rpc();
      assert("Transaction should fail");
    } catch (e) { }
  });

  it("Test donation", async () => {
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(donater.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL));

    const initialDonaterBalance = await provider.connection.getBalance(donater.publicKey);
    let [donationAccount,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);
    const fundraisingId = new BN(0);
    const [fundraisingPda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("fundraising"), fundraisingId.toBuffer('le', 8)], program.programId);
    const [donaterInfo,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("donater-info"), fundraisingId.toBuffer('le', 8), donater.publicKey.toBuffer()], program.programId);

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
    const fundraisingId = fundraisingId5;

    const [statePda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);
    const [fundraisingPda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("fundraising"), fundraisingId.toBuffer('le', 8)], program.programId);
    
    const fundraisingTokenAccount = await getOrCreateAssociatedTokenAccount(provider.connection, payer, chrtMint, fundraisingPda, true);
    const referrerTokenAccount = await getOrCreateAssociatedTokenAccount(provider.connection, payer, chrtMint, referrer.publicKey);

    await program.methods.donateChrt(cancelChrtThreshold.add(new BN(1)), fundraisingId, false).accounts({
      donater: referrer.publicKey,
      fundraising: fundraisingPda,
      donationService: statePda,
      donaterTokenAccount: referrerTokenAccount.address,
      fundraisingTokenAccount: fundraisingTokenAccount.address
    }).signers([referrer]).rpc();

    await program.methods.cancelFundraising(fundraisingId).accounts({
      user: payer.publicKey,
      donationService: statePda,
      fundraising: fundraisingPda
    }).signers([payer]).rpc();
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
    console.log(1);

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

    for (let [user, userDonation] of new Map<web3.Keypair, number>([
      [user1, user1Donation], [user2, user2Donation], [user3, user3Donation], [user4, user4Donation]
    ])) {
      console.log(4);

      const [userDonaterInfoPda,] = await web3.PublicKey.findProgramAddress(
        [anchor.utils.bytes.utf8.encode("donater-info"),
        fundraisingId.toBuffer('le', 8),
        user.publicKey.toBuffer()], program.programId);
        console.log(5);

      await program.methods.donate(new BN(userDonation), fundraisingId).accounts({
        donater: user.publicKey,
        donaterInfo: userDonaterInfoPda,
        donationService: donationPda,
        fundraising: fundraisingPda,
        chrtMint: chrtMint,
        referrerChrtAccount: referrerChrtAccount.address
      }).signers([user]).rpc();
    }

    const fundraisingState = await program.account.fundraising.fetch(fundraisingPda);

    assert(fundraisingState.topDonaters[0].totalSum.eq(new BN(user4Donation)));
    assert(fundraisingState.topDonaters[1].totalSum.eq(new BN(user2Donation)));
    assert(fundraisingState.topDonaters[2].totalSum.eq(new BN(user3Donation)));

    const donationServiceState = await program.account.donationService.fetch(donationPda);
    assert(donationServiceState.topDonaters[0].totalSum.eq(new BN(user4Donation)));
    assert(donationServiceState.topDonaters[1].totalSum.eq(new BN(user2Donation)));
    assert(donationServiceState.topDonaters[2].totalSum.eq(new BN(user3Donation)));
  });

  it("Test top donaters rewarding", async () => {
    const [donationServicePda,] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);
    const donationServiceState = await program.account.donationService.fetch(donationServicePda);

    const top1Wallet = await getOrCreateAssociatedTokenAccount(provider.connection, payer, chrtMint, donationServiceState.topDonaters[0].donater);
    const top2Wallet = await getOrCreateAssociatedTokenAccount(provider.connection, payer, chrtMint, donationServiceState.topDonaters[1].donater);
    const top3Wallet = await getOrCreateAssociatedTokenAccount(provider.connection, payer, chrtMint, donationServiceState.topDonaters[2].donater);

    const initialTop1ChrtAmount = top1Wallet.amount;
    const initialTop2ChrtAmount = top2Wallet.amount;
    const initialTop3ChrtAmount = top3Wallet.amount;

    await program.methods.rewardTopDonaters().accounts({
      donationService: donationServicePda,
      chrtMint: chrtMint,
      top1Wallet: top1Wallet.address,
      top2Wallet: top2Wallet.address,
      top3Wallet: top3Wallet.address,
    }).rpc();

    const updatedTop1Wallet = await getAccount(provider.connection, top1Wallet.address);
    const updatedTop2Wallet = await getAccount(provider.connection, top2Wallet.address);
    const updatedTop3Wallet = await getAccount(provider.connection, top3Wallet.address);

    assert(updatedTop1Wallet.amount == initialTop1ChrtAmount + BigInt(rewardChrtAmount.toString("hex")));
    assert(updatedTop2Wallet.amount == initialTop2ChrtAmount + BigInt(rewardChrtAmount.toString("hex")));
    assert(updatedTop3Wallet.amount == initialTop3ChrtAmount + BigInt(rewardChrtAmount.toString("hex")));
  });
});
