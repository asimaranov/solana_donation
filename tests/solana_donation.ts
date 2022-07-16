import * as anchor from "@project-serum/anchor";
import { Program, web3 } from "@project-serum/anchor";
import { BN } from "bn.js";
import { assert } from "chai";
import { SolanaDonation } from "../target/types/solana_donation";
import { approve, createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from '@solana/spl-token';

describe("solana_donation", () => {

  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.SolanaDonation as Program<SolanaDonation>;

  const owner = (program.provider as anchor.AnchorProvider).wallet;

  const fundraisingUserAccount = web3.Keypair.generate();
  const payer = web3.Keypair.generate();

  const donater = web3.Keypair.generate();
  const referral = web3.Keypair.generate();

  let chrtMint: web3.PublicKey;

  const provider = anchor.getProvider()

  it("Test initialization", async () => {

    const [statePda, ] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);

    await program.methods.initialize().accounts({
      donationService: statePda,
      owner: owner.publicKey
    }).signers([]).rpc();

    let donationState = await program.account.donationService.fetch(statePda);
    assert(donationState.fundraisingsNum.eq(new anchor.BN(0)))
    assert(donationState.owner.equals(owner.publicKey))
  });

  it("Test chrt token", async () => {
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(payer.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL));

    const [statePda, ] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);
    chrtMint = await createMint(provider.connection, payer, statePda, null, 3);
  })

  it("Test fundraising creating", async () => {
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(fundraisingUserAccount.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL));

    const [donationAccount, ] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);

    let donationState = await program.account.donationService.fetch(donationAccount);

    const [fundraisingPda, ] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("fundraising"), donationState.fundraisingsNum.toBuffer('le', 8)], program.programId);

    await program.methods.createFundraising().accounts({
      user: fundraisingUserAccount.publicKey,
      donationService: donationAccount,
      fundraising: fundraisingPda
    }).signers([fundraisingUserAccount]).rpc();

    let fundraisingState = await program.account.fundraising.fetch(fundraisingPda);
    assert(fundraisingState.totalSum.eq(new anchor.BN(0)));
    assert(fundraisingState.id.eq(new anchor.BN(0)));
    assert(fundraisingState.owner.equals(fundraisingUserAccount.publicKey));

    let donationState1 = await program.account.donationService.fetch(donationAccount);
    assert(donationState1.fundraisingsNum.eq(new anchor.BN(1)));
  });

  it("Test that fundraising id's are correct", async () => {
    const [donationAccount, ] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);

    let donationState = await program.account.donationService.fetch(donationAccount);

    const [fundraisingPda, ] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("fundraising"), donationState.fundraisingsNum.toBuffer('le', 8)], program.programId);

    await program.methods.createFundraising().accounts({
      user: fundraisingUserAccount.publicKey,
      donationService: donationAccount,
      fundraising: fundraisingPda
    }).signers([fundraisingUserAccount]).rpc();

    let fundraisingState = await program.account.fundraising.fetch(fundraisingPda);
    assert(fundraisingState.totalSum.eq(new anchor.BN(0)));
    assert(fundraisingState.id.eq(new anchor.BN(1)));
    assert(fundraisingState.owner.equals(fundraisingUserAccount.publicKey));

    let donationState2 = await program.account.donationService.fetch(donationAccount);
    assert(donationState2.fundraisingsNum.eq(new anchor.BN(2)));
  });

  it("Test donation", async () => {
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(donater.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL));

    const initialDonaterBalance = await provider.connection.getBalance(donater.publicKey);

    const [donationAccount, ] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("state")], program.programId);

    const fundraisingId = new BN(0);

    const [fundraisingPda, ] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("fundraising"), fundraisingId.toBuffer('le', 8)], program.programId);

    const [donaterInfo, ] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("donater-info"), fundraisingId.toBuffer('le', 8), donater.publicKey.toBuffer()], program.programId);

    const sumToDonate = new anchor.BN(1000);

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      chrtMint,
      referral.publicKey
    );

    await program.methods.donate(sumToDonate, fundraisingId, referral.publicKey).accounts({
      donater: donater.publicKey,
      donaterInfo: donaterInfo,
      donationService: donationAccount,
      fundraising: fundraisingPda,
      chrtMint: chrtMint,
      referrerChrtAccount: tokenAccount.address
    }).signers([donater]).rpc()

    const fundraisingState = await program.account.fundraising.fetch(fundraisingPda);
    assert(fundraisingState.totalSum.eq(sumToDonate));
    const finaleDonaterBalance = await provider.connection.getBalance(donater.publicKey);
    assert(initialDonaterBalance - finaleDonaterBalance >= sumToDonate.toNumber());
  })
});
