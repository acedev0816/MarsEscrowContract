import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import NodeWallet from '@project-serum/anchor/dist/cjs/nodewallet';
import { AnchorEscrow } from '../target/types/anchor_escrow';
import { PublicKey, SystemProgram, Transaction, Connection, Commitment } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, Token } from "@solana/spl-token";
import { assert } from "chai";

describe('mars-escrow', () => {
  const commitment: Commitment = 'processed';
  const connection = new Connection('https://api.devnet.solana.com', { commitment, wsEndpoint: 'wss://api.devnet.solana.com/' });
  const options = anchor.Provider.defaultOptions();
  const wallet = NodeWallet.local();
  // let provider = new anchor.Provider(connection, wallet, options);
  const provider = anchor.Provider.env();
  console.log("Test Start" /*, provider.connection._rpcEndPoint*/);
  anchor.setProvider(provider);

  const idl = JSON.parse(
    require("fs").readFileSync("./target/idl/anchor_escrow.json", "utf8")
  );
  const programId = new anchor.web3.PublicKey("4MgS65CAEk8NN8EWt41SZU9cFpZ5xbaG5QeS5HL9b8kB");
  const program = new anchor.Program(idl, programId);

  let escrow_account_pda = null;
  let escrow_account_bump = null;

  let vault_account_pda = null;
  let vault_account_bump = null;

  let user_escrow_account_pda = null;

  let stakers = [];
  let staker_count = 2;

  let payer = new anchor.web3.Keypair();

  for (let i = 0; i < staker_count; i++) {
    stakers[i] = new anchor.web3.Keypair();
  }


  let stake_amount = 100000000 //0.1 sol

  it("Funding stakers", async () => {
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(payer.publicKey, 2000000000),
      "processed"
    );
    for (let i = 0; i < staker_count; i++) {

      let trx = new anchor.web3.Transaction();
      trx.add(anchor.web3.SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: stakers[i].publicKey,
        lamports: 900000000
      }));
      let sig = await anchor.web3.sendAndConfirmTransaction(
        provider.connection,
        trx,
        [payer]
      )
    }
  });

  it("Init Escrow", async () => {
    //escrow account
    const [_escrow_account_pda, _escrow_account_bump] = await PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("escrow"))],
      program.programId
    );
    escrow_account_pda = _escrow_account_pda;
    escrow_account_bump = _escrow_account_bump;

    console.log("escrow account pda,bump", escrow_account_pda.toString(), _escrow_account_bump.toString())

    //valut account
    const [_vault_account_pda, _vault_account_bump] = await PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("vault"))],
      program.programId
    );
    vault_account_pda = _vault_account_pda;
    console.log("vault account pda,bump", vault_account_pda.toString(), _vault_account_bump.toString())
    vault_account_bump = _vault_account_bump;


    await program.rpc.init(vault_account_bump, {
      accounts: {
        escrowAccount: escrow_account_pda,
        vaultAccount: vault_account_pda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      }
    });

    let _escrowAccount = await program.account.escrowAccount.fetch(
      escrow_account_pda
    );
    assert.ok(_escrowAccount.index.toNumber() == 0);


  });

  it("stake should fail with insufficient funds", async () => {
    // get current index
    let _escrowAccount = await program.account.escrowAccount.fetch(
      escrow_account_pda
    );
    let stake_index = _escrowAccount.index.toNumber();

    //get user escrow account pda
    const [_user_escrow_account_pda, _user_escrow_account_bump] = await PublicKey.findProgramAddress(
      [stakers[0].publicKey.toBuffer(), Buffer.from(anchor.utils.bytes.utf8.encode(
        new anchor.BN(stake_index).toString()
      ))],
      program.programId
    );
    user_escrow_account_pda = _user_escrow_account_pda;
    console.log("user escrow account pda, dump", _user_escrow_account_pda, _user_escrow_account_bump);

    // stake
    try {
      await program.rpc.stake(
        new anchor.BN(stake_amount * 100000),
        {
          accounts: {
            staker: stakers[0].publicKey,
            vaultAccount: vault_account_pda,
            escrowAccount: escrow_account_pda,
            userEscrowAccount: _user_escrow_account_pda,
            systemProgram: anchor.web3.SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          },
          signers: [stakers[0]]
        }
      );
    } catch (error) {
      assert(error.code == 2003); //a raw constraint was violated
    }
  });

  it("stake (2 users with his own wallet) success with enough funds", async () => {
    let first_index = -1;

    for (let i = 0; i < staker_count; i++) {

      let _escrowAccount = await program.account.escrowAccount.fetch(
        escrow_account_pda
      );
      let stake_index = _escrowAccount.index.toNumber();
      if (first_index < 0)
        first_index = stake_index;

      //get user escrow account pda
      const [_user_escrow_account_pda, _user_escrow_account_bump] = await PublicKey.findProgramAddress(
        [stakers[i].publicKey.toBuffer(), Buffer.from(anchor.utils.bytes.utf8.encode(
          new anchor.BN(stake_index).toString()
        ))],
        program.programId
      );
      user_escrow_account_pda = _user_escrow_account_pda;
      console.log("user escrow account pda, dump", _user_escrow_account_pda.toString(), _user_escrow_account_bump);

      // stake
      await program.rpc.stake(
        new anchor.BN(stake_amount),
        {
          accounts: {
            staker: stakers[i].publicKey,
            vaultAccount: vault_account_pda,
            escrowAccount: escrow_account_pda,
            userEscrowAccount: _user_escrow_account_pda,
            systemProgram: anchor.web3.SystemProgram.programId,
          },
          signers: [stakers[i]]
        }
      );
    }
    let _escrowAccount = await program.account.escrowAccount.fetch(
      escrow_account_pda
    );
    // Check staker index change
    assert.ok(first_index + staker_count == _escrowAccount.index.toNumber());
  });

  it("cancel first stake fails with wrong signer", async () => {
    // get user escrow account
    let stake_index = 0;
    const [_user_escrow_account_pda, _user_escrow_account_bump] = await PublicKey.findProgramAddress(
      [stakers[stake_index].publicKey.toBuffer(), Buffer.from(anchor.utils.bytes.utf8.encode(
        new anchor.BN(stake_index).toString()
      ))],
      program.programId
    );

    let balance_before = await provider.connection.getBalance(stakers[0].publicKey);
    try {
      await program.rpc.cancel(
        new anchor.BN(stake_index),
        {
          accounts: {
            staker: stakers[stake_index].publicKey,
            vaultAccount: vault_account_pda,
            userEscrowAccount: _user_escrow_account_pda,
            systemProgram: anchor.web3.SystemProgram.programId,
          },
          signers: [stakers[1]]
        }
      );
    } catch (error) { 
      assert.ok(error.code = 2001); // A has_one constraint was violated
    }

  });

  it("cancel first stake success with correct signer", async () => {
    // get user escrow account
    let stake_index = 0;
    const [_user_escrow_account_pda, _user_escrow_account_bump] = await PublicKey.findProgramAddress(
      [stakers[0].publicKey.toBuffer(), Buffer.from(anchor.utils.bytes.utf8.encode(
        new anchor.BN(stake_index).toString()
      ))],
      program.programId
    );

    let balance_before = await provider.connection.getBalance(stakers[0].publicKey);
    await program.rpc.cancel(
      new anchor.BN(stake_index),
      {
        accounts: {
          staker: stakers[stake_index].publicKey,
          vaultAccount: vault_account_pda,
          userEscrowAccount: _user_escrow_account_pda,
          systemProgram: anchor.web3.SystemProgram.programId,
        },
        signers: [stakers[stake_index]]
      }
    );
    let balance_after = await provider.connection.getBalance(stakers[stake_index].publicKey);
    console.log("stake_amount", stake_amount, "balance change", balance_after - balance_before);
    assert.ok (balance_after - balance_before >= stake_amount)

  });

  it("release should fail with wrong signer", async () => {
    let receiver = new anchor.web3.Keypair();
    console.log("receiver: ", receiver.publicKey.toString());
    let stake_index = 0;
    const [_user_escrow_account_pda, _user_escrow_account_bump] = await PublicKey.findProgramAddress(
      [stakers[0].publicKey.toBuffer(), Buffer.from(anchor.utils.bytes.utf8.encode(
        new anchor.BN(stake_index).toString()
      ))],
      program.programId
    );
    // release
    try {
      await program.rpc.release(
        new anchor.BN(stake_amount),
        {
          accounts: {
            staker: stakers[stake_index].publicKey,
            receiver: receiver.publicKey,
            escrowAccount: escrow_account_pda,
            vaultAccount: vault_account_pda,
            userEscrowAccount: _user_escrow_account_pda,
            systemProgram: anchor.web3.SystemProgram.programId,
          },
          signers: [stakers[1]]
        }
      );
    } catch (error) {
      assert.ok(error.code = 2001); // A has_one constraint was violated
    }

  });

  it("release half success with correct signer", async () => {
    // get current index
    let stake_index = 1;
    const [_user_escrow_account_pda, _user_escrow_account_bump] = await PublicKey.findProgramAddress(
      [stakers[stake_index].publicKey.toBuffer(), Buffer.from(anchor.utils.bytes.utf8.encode(
        new anchor.BN(stake_index).toString()
      ))],
      program.programId
    );
    const release_amount = stake_amount/2;
    //check user escrow account
    let _uea = await program.account.userEscrowAccount.fetch(
      _user_escrow_account_pda
    );
    console.log("uea amount", _uea.amount.toNumber());
    // console.log("valut balance", await provider.connection.getBalance(vault_account_pda));
    //end: check
    let receiver = new anchor.web3.Keypair();
    console.log("receiver: ", receiver.publicKey.toString());
    // console.log("program.account", program.account);
    // stake
    await program.rpc.release(
      new anchor.BN(release_amount), // release amount
      {
        accounts: {
          staker: stakers[stake_index].publicKey,
          receiver: receiver.publicKey,
          escrowAccount: escrow_account_pda,
          vaultAccount: vault_account_pda,
          userEscrowAccount: _user_escrow_account_pda,
          systemProgram: anchor.web3.SystemProgram.programId,
        },
        signers: [stakers[stake_index]]
      }
    );
    let receiver_balance = await provider.connection.getBalance(receiver.publicKey);
    console.log("receiver balance", receiver_balance, "release amount", release_amount);
    assert.ok(receiver_balance >= release_amount);
      // get updated amount
    let user_escrow_account = await program.account.userEscrowAccount.fetch(_user_escrow_account_pda);
    console.log("updated amount", user_escrow_account.amount.toNumber());
  });

  it("Add 0.1 SOL to existing stake account", async () => {
    let stake_index = 1;
    const [_user_escrow_account_pda, _user_escrow_account_bump] = await PublicKey.findProgramAddress(
      [stakers[stake_index].publicKey.toBuffer(), Buffer.from(anchor.utils.bytes.utf8.encode(
        new anchor.BN(stake_index).toString()
      ))],
      program.programId
    );
    const new_amount = stake_amount/2 + stake_amount;
    //check user escrow account
    let uea_account = await program.account.userEscrowAccount.fetch(
      _user_escrow_account_pda
    );
    console.log("uea amount brefore call", uea_account.amount.toNumber());
    // smodify
    await program.rpc.modify(
      new anchor.BN(new_amount), // new amount
      {
        accounts: {
          staker: stakers[stake_index].publicKey,
          vaultAccount: vault_account_pda,
          userEscrowAccount: _user_escrow_account_pda,
          systemProgram: anchor.web3.SystemProgram.programId,
        },
        signers: [stakers[stake_index]]
      }
    );
    let uea_account_new = await program.account.userEscrowAccount.fetch(_user_escrow_account_pda);
    console.log("uea amount after call", uea_account_new.amount.toNumber());
    assert.ok(uea_account_new.amount.toNumber() == new_amount);
  });

  it("Reduce 0.1 SOL to existing stake account", async () => {
    let stake_index = 1;
    const [_user_escrow_account_pda, _user_escrow_account_bump] = await PublicKey.findProgramAddress(
      [stakers[stake_index].publicKey.toBuffer(), Buffer.from(anchor.utils.bytes.utf8.encode(
        new anchor.BN(stake_index).toString()
      ))],
      program.programId
    );
    const new_amount = stake_amount/2;
    //check user escrow account
    let uea_account = await program.account.userEscrowAccount.fetch(
      _user_escrow_account_pda
    );
    console.log("uea amount brefore call", uea_account.amount.toNumber());
    let staker_balance = await provider.connection.getBalance(stakers[stake_index].publicKey);

    // smodify
    await program.rpc.modify(
      new anchor.BN(new_amount), // new amount
      {
        accounts: {
          staker: stakers[stake_index].publicKey,
          vaultAccount: vault_account_pda,
          userEscrowAccount: _user_escrow_account_pda,
          systemProgram: anchor.web3.SystemProgram.programId,
        },
        signers: [stakers[stake_index]]
      }
    );
    let uea_account_new = await program.account.userEscrowAccount.fetch(_user_escrow_account_pda);
    console.log("uea amount after call", uea_account_new.amount.toNumber());
    assert.ok(uea_account_new.amount.toNumber() == new_amount);
    // check staker balance
    let staker_balance_new = await provider.connection.getBalance(stakers[stake_index].publicKey);
    console.log("staker balance change", staker_balance_new - staker_balance);
  });

});
