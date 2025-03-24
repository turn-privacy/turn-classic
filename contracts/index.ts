/*

testing the classiclock.ak validator

Should allow spend if

or {
    and {
        enough time has passed
        user has signed the transaction
    },
    and {
        admin has signed the transaction
        user has signed the transaction
    }
}

-----

and {
    user has signed the transaction
    or {
        enough time has passed
        admin has signed the transaction
    }
}


--------

To run:

    deno run --allow-read --allow-env --allow-ffi index.ts

*/

import { applyParamsToScript, Constr, Data, Emulator, generateSeedPhrase, Lucid, paymentCredentialOf, SpendingValidator, stakeCredentialOf, validatorToAddress } from "npm:@lucid-evolution/lucid";
import blueprint from "./plutus.json" with { type: "json" };

async function init_get_wallet_address(): Promise<[string, string]> {
  const emulator = new Emulator([]);
  const offlineLucid = await Lucid(emulator, "Preview");
  const seedPhrase = generateSeedPhrase();
  offlineLucid.selectWallet.fromSeed(seedPhrase);
  const address = await offlineLucid.wallet().address();
  return [address, seedPhrase];
}

type User = {
  address: string;
  seed: string;
};

const makeUser = async (): Promise<User> => {
  const [address, seed] = await init_get_wallet_address();
  return { address, seed };
};

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

const validatorCode = blueprint.validators.find((v) => v.title === "classiclock.classiclock.spend")?.compiledCode;
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

const ONE_HOUR = 3_600_000;

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

const Action = {
  CoinJoin: Data.to(new Constr(0, [])),
  Reclaim: Data.to(new Constr(1, [])),
};

{ // spend funds from the validator address WITH admin permission
  const lockedUtxos = await lucid.utxosAt(validatorAddress);
  console.log(`locked utxos: ${lockedUtxos.length}`);

  const tx = await lucid.newTx()
    .collectFrom([lockedUtxos[0]], Action.CoinJoin)
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

// if function passed thows... don't throw, if it doesn't throw, throw
const invertFailure = async (fn: () => Promise<void>) => {
  try {
    await fn();
  } catch {
    console.log("%cFunction threw which is expected and good", "color: yellow");
    return;
  }
  throw new Error("Function should have thrown");
};

const tryWithoutValidFrom = async () => {
  const ttl = emulator.now() + ONE_HOUR;

  const tx = await lucid.newTx()
    .collectFrom(lockedUtxos, Action.Reclaim)
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
    .collectFrom(lockedUtxos, Action.Reclaim)
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
