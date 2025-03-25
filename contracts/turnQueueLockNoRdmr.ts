/*

testing the classiclock.ak validator

Should allow spend if

and {
    user has signed the transaction
    or {
      admin has signed the transaction
      enough time has passed
    }
}

--------

This version does not require a sepecific redeemer to tell it what conditions to check for. 

--------

To run:

    deno run --allow-read --allow-env --allow-ffi turnQueueLockNoRdmr.ts

*/

import { applyParamsToScript, Constr, Data, Emulator, Lucid, paymentCredentialOf, SpendingValidator, stakeCredentialOf, validatorToAddress } from "npm:@lucid-evolution/lucid";
import blueprint from "./plutus.json" with { type: "json" };
import { invertFailure, makeUser, ONE_HOUR } from "./common.ts";

const admin = await makeUser();
const user = await makeUser();
const target = await makeUser(); // not allocated fund in the beginning
const referenceScriptHolder = await makeUser();

const emulator = new Emulator(
  [
    {
      address: admin.address,
      assets: {
        lovelace: 1_500_000_000n,
      },
    },
    {
      address: user.address,
      assets: {
        lovelace: 1_500_000_000n,
      },
    },
  ],
);

const lucid = await Lucid(emulator, "Preview");
lucid.selectWallet.fromSeed(admin.seed);

const adminPaymentCredential = paymentCredentialOf(admin.address).hash;
const userPaymentCredential = paymentCredentialOf(user.address).hash;
const userStakeCredential = stakeCredentialOf(user.address);

const validatorCode = blueprint.validators.find((v) => v.title === "turn_queue_lock_no_rdmr.turn_queue_lock_no_rdmr.spend")?.compiledCode;
if (!validatorCode) {
  throw new Error("Validator code not found");
}

const validator: SpendingValidator = {
  type: "PlutusV3",
  script: applyParamsToScript(
    validatorCode,
    [adminPaymentCredential],
  ),
};

const validatorAddress = validatorToAddress("Preview", validator, userStakeCredential);
console.log(`Validator address: ${validatorAddress}`);

{ // deploy the reference script
  const tx = await lucid.newTx()
    .pay.ToAddressWithData(referenceScriptHolder.address, { kind: "inline", value: Data.to(new Constr(0, [])) }, { lovelace: 1_000_000n }, validator)
    .complete();

  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  console.log("txHash: ", txHash);

  console.log(`Emulator time: ${emulator.now()}`);
  emulator.awaitBlock(1);
  console.log(`Emulator time: ${emulator.now()}`);
}

const referenceScriptUtxos = await lucid.utxosAt(referenceScriptHolder.address);
if (referenceScriptUtxos.length !== 1) {
  throw new Error("Reference script utxos not found");
}
console.log(`Reference script utxos: ${referenceScriptUtxos.length}`);


const unlockTime = emulator.now() + ONE_HOUR;

const unlockConditions = {
  owner: userPaymentCredential,
  unlock_time: unlockTime,
};

{ // lock funds at the validator address
  const datum = Data.to(new Constr(0, [unlockConditions.owner, BigInt(unlockConditions.unlock_time)]));
  console.log("datum: ", datum);

  const tx = await lucid.newTx()
    .pay.ToContract(validatorAddress, { kind: "inline", value: datum }, { lovelace: 1_000_000n })
    .pay.ToContract(validatorAddress, { kind: "inline", value: datum }, { lovelace: 1_000_000n })
    .complete();

  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  console.log("txHash: ", txHash);

  console.log(`Emulator time: ${emulator.now()}`);
  emulator.awaitBlock(1);
  console.log(`Emulator time: ${emulator.now()}`);
}

const redeemer = Data.to(new Constr(0, []));

{ // spend funds from the validator address WITH admin permission
  const lockedUtxos = await lucid.utxosAt(validatorAddress);
  console.log(`locked utxos: ${lockedUtxos.length}`);

  const tx = await lucid.newTx()
    .collectFrom([lockedUtxos[0]], redeemer)
    .readFrom(referenceScriptUtxos)
    .pay.ToAddress(target.address, { lovelace: 1_000_000n })
    .addSigner(admin.address)
    .addSigner(user.address)
    .complete();

  const rawUnsigned = tx.toCBOR();
  const adminWitness = await lucid.fromTx(rawUnsigned).partialSign.withWallet();

  lucid.selectWallet.fromSeed(user.seed);
  const userWitness = await lucid.fromTx(rawUnsigned).partialSign.withWallet();

  const assembled = await lucid.fromTx(rawUnsigned).assemble([adminWitness, userWitness]).complete();
  const txHash = await assembled.submit();
  console.log("txHash: ", txHash);

  console.log(`Emulator time: ${emulator.now()}`);
  emulator.awaitBlock(1);
  console.log(`Emulator time: ${emulator.now()}`);
}

const lockedUtxos = await lucid.utxosAt(validatorAddress);
console.log(`locked utxos: ${lockedUtxos.length}`);


const tryWithoutValidFrom = async () => {
  const ttl = emulator.now() + ONE_HOUR;

  const tx = await lucid.newTx()
    .collectFrom(lockedUtxos, redeemer)
    .readFrom(referenceScriptUtxos)
    .pay.ToAddress(target.address, { lovelace: 1_000_000n })
    .addSigner(user.address)
    .validTo(ttl)
    .complete();

  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  console.log("txHash: ", txHash);
};

await invertFailure(tryWithoutValidFrom);

const tryWithoutAdmin = async () => { // try to spend WITHOUT admin permission
  const ttl = emulator.now() + ONE_HOUR;

  const tx = await lucid.newTx()
    .collectFrom(lockedUtxos, redeemer)
    .readFrom(referenceScriptUtxos)
    .pay.ToAddress(target.address, { lovelace: 1_000_000n })
    .addSigner(user.address)
    .validFrom(unlockTime + 1000)
    .validTo(ttl)
    .complete();

  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  console.log("txHash: ", txHash);
};

await invertFailure(tryWithoutAdmin);

console.log(`Emulator time: ${emulator.now()}`);
emulator.awaitBlock(200);
console.log(`Emulator time: ${emulator.now()}`);
await tryWithoutAdmin();
