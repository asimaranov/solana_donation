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

  beforeEach(async () => {
    donationAccount = web3.Keypair.generate();
    fundraisingAccount = web3.Keypair.generate();
    fundraisingUserAccount = web3.Keypair.generate();

  });

  it("Test initialization", async () => {
    await program.methods.initialize().accounts({
      donationService: donationAccount.publicKey,
      owner: owner.publicKey
    }).signers([donationAccount]).rpc();

    let donationState = await program.account.donationService.fetch(donationAccount.publicKey);
    assert(donationState.lastFundraisingId.eq(new anchor.BN(0)))
    assert(donationState.owner == owner.publicKey)
  });

  it("Test funraising creating", async () => {

    await program.methods.initialize().accounts({
      donationService: donationAccount.publicKey,
      owner: owner.publicKey
    }).signers([donationAccount]).rpc();

    let donationState = await program.account.donationService.fetch(donationAccount.publicKey);

    const [fundraisingPda, _] = await web3.PublicKey.findProgramAddress([anchor.utils.bytes.utf8.encode("fundraising"), donationState.lastFundraisingId.toBuffer('le')], program.programId);

    await program.methods.createFundraising().accounts({
      user: fundraisingUserAccount.publicKey,
      donationService: donationAccount.publicKey,
      fundraising: fundraisingPda
    }).signers([fundraisingUserAccount]).rpc();  // throws Transaction simulation failed: Error processing Instruction 0: Cross-program invocation with unauthorized signer or writable account
  });
});
