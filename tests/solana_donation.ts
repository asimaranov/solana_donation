import * as anchor from "@project-serum/anchor";
import { Program, web3 } from "@project-serum/anchor";
import { assert } from "chai";
import { SolanaDonation } from "../target/types/solana_donation";

describe("solana_donation", () => {

  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.SolanaDonation as Program<SolanaDonation>;

  let donationAccount: web3.Keypair;
  const owner = (program.provider as anchor.AnchorProvider).wallet;
  let fundraisingAccount: web3.Keypair;
  let fundraisingUserAccount: web3.Keypair;
  const provider = anchor.getProvider()

  beforeEach(async () => {
    donationAccount = web3.Keypair.generate();
    fundraisingAccount = web3.Keypair.generate();
    fundraisingUserAccount = web3.Keypair.generate();
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(fundraisingUserAccount.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL));
  });

  it("Test initialization", async () => {
    await program.methods.initialize().accounts({
      donationService: donationAccount.publicKey,
      owner: owner.publicKey
    }).signers([donationAccount]).rpc();

    let donationState = await program.account.donationService.fetch(donationAccount.publicKey);
    assert(donationState.lastFundraisingId.eq(new anchor.BN(0)))
    assert(donationState.owner.equals(owner.publicKey))
  });

  it("Test funraising creating", async () => {
    await program.methods.initialize().accounts({
      donationService: donationAccount.publicKey,
      owner: owner.publicKey
    }).signers([donationAccount]).rpc();

    let donationState = await program.account.donationService.fetch(donationAccount.publicKey);

    const [fundraisingPda, ] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("fundraising"), donationState.lastFundraisingId.toBuffer('le', 8)], program.programId);

    await program.methods.createFundraising().accounts({
      user: fundraisingUserAccount.publicKey,
      donationService: donationAccount.publicKey,
      fundraising: fundraisingPda
    }).signers([fundraisingUserAccount]).rpc();

    let fundraisingState = await program.account.fundraising.fetch(fundraisingPda);
    assert(fundraisingState.totalSum.eq(new anchor.BN(0)));
    assert(fundraisingState.id.eq(new anchor.BN(0)));
    assert(fundraisingState.owner.equals(fundraisingUserAccount.publicKey));

    let donationState1 = await program.account.donationService.fetch(donationAccount.publicKey);
    assert(donationState1.lastFundraisingId.eq(new anchor.BN(1)));


    const [fundraisingPda2, ] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("fundraising"), donationState1.lastFundraisingId.toBuffer('le', 8)], program.programId);

    await program.methods.createFundraising().accounts({
      user: fundraisingUserAccount.publicKey,
      donationService: donationAccount.publicKey,
      fundraising: fundraisingPda2
    }).signers([fundraisingUserAccount]).rpc();

    let fundraisingState2 = await program.account.fundraising.fetch(fundraisingPda);
    assert(fundraisingState2.totalSum.eq(new anchor.BN(0)));
    assert(fundraisingState2.id.eq(new anchor.BN(0)));
    assert(fundraisingState2.owner.equals(fundraisingUserAccount.publicKey));

    let donationState2 = await program.account.donationService.fetch(donationAccount.publicKey);
    assert(donationState2.lastFundraisingId.eq(new anchor.BN(2)));

  });


});
