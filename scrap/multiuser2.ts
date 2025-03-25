import { Assets, Emulator, fromHex, fromText, generateSeedPhrase, Lucid, mintingPolicyToId, paymentCredentialOf, scriptFromNative, toText, TxBuilder, UTxO } from "npm:@lucid-evolution/lucid";
import * as CML from "npm:@anastasia-labs/cardano-multiplatform-lib-nodejs";
// import * as CSL from "npm:@emurgo/cardano-serialization-lib-nodejs";
import { Buffer } from "node:buffer";

/*
    Simple simulation of a multi-user mixing ceremony.
    This version extends the previous version by using JavaScript's `.reduce` function to create the transaction.
*/

async function init_get_wallet_address(): Promise<[string, string]> {
  const emulator = new Emulator([]);
  const offlineLucid = await Lucid(emulator, "Preview");
  const seedPhrase = generateSeedPhrase();
  offlineLucid.selectWallet.fromSeed(seedPhrase);
  const address = await offlineLucid.wallet().address();
  return [address, seedPhrase];
}

const createAsset = (nameEnglish: string): string => { // calculate the UNIT of an asset with a specific name
  const mintingPolicy = scriptFromNative(
    {
      type: "all",
      scripts: [],
    },
  );

  const policyId = mintingPolicyToId(mintingPolicy);
  const name = fromText(nameEnglish);
  const unit = policyId + name;
  return unit;
};

type User = {
  name: string;
  address: string;
  seed: string;
  recipientAddress: string;
};

const makeUser = async (name: string): Promise<User> => {
  const [address, seed] = await init_get_wallet_address();
  const [recipientAddress] = await init_get_wallet_address();
  return { name, address, seed, recipientAddress };
};

const operator = await makeUser("operator");
const alice = await makeUser("alice");
const bob = await makeUser("bob");
const charlie = await makeUser("charlie");

const sillycoin = createAsset("sillycoin");
const dogcoin = createAsset("dogcoin");

const people = [operator, alice, bob, charlie];

const emulator = new Emulator(
  people.map((obj: User) => ({
    address: obj.address,
    assets: {
      lovelace: 1_500_000_000n,
      [createAsset(obj.name)]: 1n,
      [sillycoin]: 1n,
      [dogcoin]: 100n,
    },
  })),
);

const lucid = await Lucid(emulator, "Preview");
lucid.selectWallet.fromSeed(operator.seed);

const outputSize = 5_000_000n; // how much ada does each user mix
const operatorFee = 5_000_000n;

const minute = 60 * 1000;

const selectUserUtxos = async (userAddress: string) => {
  const utxos = await lucid.utxosAt(userAddress);
  const aproxMinOutput = 1_000_000n; // don't want to run into issues with minUTXO
  const minimumInputValue = outputSize + aproxMinOutput + operatorFee;

  const sumUtxos = (utxos: UTxO[]) => utxos.reduce((acc, utxo) => acc + utxo.assets.lovelace, 0n);
  const selectedUtxos: UTxO[] = [];

  for (const utxo of utxos) {
    selectedUtxos.push(utxo);
    if (sumUtxos(selectedUtxos) > minimumInputValue) {
      return selectedUtxos;
    }
  }

  throw new Error(`Insufficient funds at ${userAddress}`);
};

// const operatorUtxos = await lucid.utxosAt(operator.address);

const mergeAssets = (a: Assets, b: Assets): Assets => {
  const assets = { ...a };
  for (const [key, value] of Object.entries(b)) {
    assets[key] = (assets[key] ?? 0n) + value;
  }

  for (const key of Object.keys(assets)) { // remove zeros
    if (assets[key] === 0n) {
      delete assets[key];
    }
  }

  return assets;
};

const negateAssets = (assets: Assets): Assets => {
  const negated: Assets = {};
  for (const [key, value] of Object.entries(assets)) {
    negated[key] = -1n * value;
  }
  return negated;
};

const calculateUserChange = (utxos: UTxO[]): Assets => { // what needs to be returned to the user as change?
  const b0: Assets = utxos.reduce((acc, utxo) => mergeAssets(acc, utxo.assets), {} as Assets); // balance (all assets owned) before tx
  const b1 = mergeAssets(mergeAssets(b0, negateAssets({ lovelace: operatorFee })), negateAssets({ lovelace: outputSize })); // balance after tx
  return b1;
};

type StateTestRecord = {
  operator: Assets;
  alice: Assets;
  bob: Assets;
  charlie: Assets;
  aliceReceive: Assets;
  bobReceive: Assets;
  charlieReceive: Assets;
};

const makeStateTestRecord = async (): Promise<StateTestRecord> => {
  const allAssetsOf = async (address: string): Promise<Assets> => {
    const utxos = await lucid.utxosAt(address);
    return utxos.reduce((acc, utxo) => mergeAssets(acc, utxo.assets), {} as Assets);
  };
  return {
    operator: await allAssetsOf(operator.address),
    alice: await allAssetsOf(alice.address),
    bob: await allAssetsOf(bob.address),
    charlie: await allAssetsOf(charlie.address),
    aliceReceive: await allAssetsOf(alice.recipientAddress),
    bobReceive: await allAssetsOf(bob.recipientAddress),
    charlieReceive: await allAssetsOf(charlie.recipientAddress),
  };
};

const displayStateTestRecord = (record: StateTestRecord) => { // print table where rows are users and columns are assets
  const users = Object.keys(record);
  const allAssets: Assets = Object.values(record).reduce((acc, assets) => mergeAssets(acc, assets), {} as Assets);
  const assets = Object.keys(allAssets);
  const assetToEnglish = (asset: string) => asset === "lovelace" ? asset : toText(asset.slice(56));
  console.log("\n");
  console.log("User".padEnd(16, "."), ...(assets.map(assetToEnglish)).map((asset) => asset.padEnd(16, ".")));
  users.forEach((user) => console.log(user.padEnd(16, " "), ...(assets.map((asset) => record[user as keyof StateTestRecord][asset] ?? 0n)).map((value) => value.toString().padEnd(16, " "))));
  console.log("\n");
};

const stateBefore = await makeStateTestRecord();
displayStateTestRecord(stateBefore);

const tx = await [alice, bob, charlie].reduce<Promise<TxBuilder>>(
  async (accTx: Promise<TxBuilder>, user: User): Promise<TxBuilder> => {
    const utxos = await selectUserUtxos(user.address);
    const userChange = calculateUserChange(utxos);
    return (await accTx)
      .collectFrom(utxos)
      .pay.ToAddress(user.recipientAddress, { lovelace: outputSize })
      .pay.ToAddress(user.address, userChange)
      .addSigner(user.address);
  },
  Promise.resolve(
    lucid
      .newTx()
      // .collectFrom(operatorUtxos)
      .addSigner(operator.address)
      .pay.ToAddress(operator.address, { lovelace: operatorFee * 3n }) // operator fee
      .validTo(emulator.now() + (15 * minute))
  ),
);
const completeTx = await tx.complete();

{ // ttl info
  const tx: CML.Transaction = CML.Transaction.from_cbor_hex(completeTx.toCBOR());
  const txBody: CML.TransactionBody = tx.body();
  console.log(txBody.ttl());
}

console.log("Transaction ID:", completeTx.toHash());

const rawUnsigned = completeTx.toCBOR();
const operatorWitness = await lucid.fromTx(rawUnsigned).partialSign.withWallet();

lucid.selectWallet.fromSeed(alice.seed);
const aliceWitness = await lucid.fromTx(rawUnsigned).partialSign.withWallet();

{ // output between these curly braces will be green
  // use CML to decode the witness
  console.log(`%cAlice's witness ${aliceWitness}`, "color: green");
  const paymentCredential = paymentCredentialOf(alice.address);
  console.log(`%cAlice's payment credential ${paymentCredential.hash}`, "color: green");
  // const decoded = CML.Vkeywitness.from_cbor_hex(aliceWitness);
  // const decoded = CML.TransactionWitnessSet.from_cbor_hex(aliceWitness).vkeywitnesses()?.get(0).vkey().to_bech32();
  // const decoded = CML.TransactionWitnessSet.from_cbor_hex(aliceWitness).vkeywitnesses()?.get(0).vkey().to_raw_bytes();
  const decoded = CML.TransactionWitnessSet.from_cbor_hex(aliceWitness).vkeywitnesses()?.get(0).vkey().hash().to_hex();
  // const decoded = CML.Vkeywitness.from_json(aliceWitness);
  console.log(`%cDecoded value: ${decoded}`, "color: green");
  // show alice address
  console.log(`%cAlice's address ${alice.address}`, "color: green");

  { // ensure witness is actually a signature on the transaction
    console.log(`Expected Transaction Hash: ${completeTx.toHash()}`);
    console.log(`%cRaw unsigned ${rawUnsigned}`, "color: pink");
    const tx: CML.Transaction = CML.Transaction.from_cbor_hex(rawUnsigned);
    // console.log(tx)
    const txBody: CML.TransactionBody = tx.body();
    // console.log(txBodyHash);
    const txBodyHash : CML.TransactionHash = CML.hash_transaction(txBody);
    console.log(`%cTransaction body hash ${txBodyHash.to_hex()}`, "color: pink");

    /////////////
    const witness = CML.TransactionWitnessSet.from_cbor_hex(aliceWitness).vkeywitnesses()?.get(0);
    if (!witness) {
      throw new Error("No witness found");
    }
    
    const publicKey = witness.vkey()
    console.log(publicKey)

    const isValidSignature : boolean = publicKey.verify(fromHex(txBodyHash.to_hex()), witness.ed25519_signature())
    console.log(`%cIs valid signature ${isValidSignature}`, "color: pink");
    // console.log(`%cTransaction body ${txBody}`, "color: pink");
  }
}

lucid.selectWallet.fromSeed(bob.seed);
const bobWitness = await lucid.fromTx(rawUnsigned).partialSign.withWallet();

lucid.selectWallet.fromSeed(charlie.seed);
const charlieWitness = await lucid.fromTx(rawUnsigned).partialSign.withWallet();

const displayWitnesses = () => {
  console.log("\n");
  console.log("Operator Witness".padEnd(32, "."), operatorWitness);
  console.log("Alice Witness".padEnd(32, "."), aliceWitness);
  console.log("Bob Witness".padEnd(32, "."), bobWitness);
  console.log("Charlie Witness".padEnd(32, "."), charlieWitness);
  console.log("\n");
};

// displayWitnesses();

const assembled = completeTx.assemble([operatorWitness, aliceWitness, bobWitness, charlieWitness]);
const ready = await assembled.complete();

const submitted = await ready.submit();
emulator.awaitBlock(10);

console.log("Submitted ", submitted);
console.log("Block height: ", emulator.blockHeight);

const stateAfter = await makeStateTestRecord();
displayStateTestRecord(stateAfter);

const lovelaceCheck = (user: keyof StateTestRecord) => () => {
  const expected = stateBefore[user].lovelace;
  const actual: bigint = stateAfter[user].lovelace + stateAfter[`${user}Receive` as keyof StateTestRecord].lovelace + operatorFee;
  const delta = expected - actual;
  if (delta === 0n) {
    return console.log(`%c${user}'s lovelace balance is correct`, "color: green");
  }
  console.log(`%c${user}'s lovelace balance is incorrect (expected: ${expected}, actual: ${actual}, delta: ${delta})`, "color: red");
};

const otherAssetCheck = (assetName: string) => (user: keyof StateTestRecord) => () =>
  stateAfter[user][assetName] === stateBefore[user][assetName] ? console.log(`%c${user}'s ${assetName} balance is correct (${stateBefore[user][assetName]})`, "color: green") : console.log(`%c${user}'s ${assetName} balance is incorrect`, "color: red");
const dogcoinCheck = otherAssetCheck(dogcoin);
const sillycoinCheck = otherAssetCheck(sillycoin);
const alicecoinCheck = otherAssetCheck(createAsset("alice"));
const bobcoinCheck = otherAssetCheck(createAsset("bob"));
const charliecoinCheck = otherAssetCheck(createAsset("charlie"));

const ValidityChecks = {
  lovelaceChecks: {
    alice: lovelaceCheck("alice"),
    bob: lovelaceCheck("bob"),
    charlie: lovelaceCheck("charlie"),
    operator: () => { //  B_0 = B_1 + F_n - (F_o \cdot P)
      const expected = stateBefore.operator.lovelace;
      const actual = stateAfter.operator.lovelace + completeTx.toTransaction().body().fee() - (operatorFee * 3n);
      const delta = expected - actual;
      if (delta === 0n) {
        return console.log(`%cOperator's lovelace balance is correct`, "color: green");
      }
      console.log(`%cOperator's lovelace balance is incorrect (expected: ${expected}, actual: ${actual}, delta: ${delta})`, "color: red");
    },
    aliceReceiveAddr: () => stateAfter.aliceReceive.lovelace === outputSize ? console.log(`%cAlice's receive address balance is correct`, "color: green") : console.log(`%cAlice's receive address balance is incorrect`, "color: red"),
    bobReceiveAddr: () => stateAfter.bobReceive.lovelace === outputSize ? console.log(`%cBob's receive address balance is correct`, "color: green") : console.log(`%cBob's receive address balance is incorrect`, "color: red"),
    charlieReceiveAddr: () => stateAfter.charlieReceive.lovelace === outputSize ? console.log(`%cCharlie's receive address balance is correct`, "color: green") : console.log(`%cCharlie's receive address balance is incorrect`, "color: red"),
  },
  dogcoinChecks: {
    alice: dogcoinCheck("alice"),
    bob: dogcoinCheck("bob"),
    charlie: dogcoinCheck("charlie"),
    operator: dogcoinCheck("operator"),
  },
  sillycoinChecks: {
    alice: sillycoinCheck("alice"),
    bob: sillycoinCheck("bob"),
    charlie: sillycoinCheck("charlie"),
    operator: sillycoinCheck("operator"),
  },
  alicecoinChecks: {
    alice: alicecoinCheck("alice"),
    bob: alicecoinCheck("bob"),
    charlie: alicecoinCheck("charlie"),
    operator: alicecoinCheck("operator"),
  },
  bobcoinChecks: {
    alice: bobcoinCheck("alice"),
    bob: bobcoinCheck("bob"),
    charlie: bobcoinCheck("charlie"),
    operator: bobcoinCheck("operator"),
  },
  charliecoinChecks: {
    alice: charliecoinCheck("alice"),
    bob: charliecoinCheck("bob"),
    charlie: charliecoinCheck("charlie"),
    operator: charliecoinCheck("operator"),
  },
};

ValidityChecks.lovelaceChecks.alice();
ValidityChecks.lovelaceChecks.bob();
ValidityChecks.lovelaceChecks.charlie();
ValidityChecks.lovelaceChecks.operator();
ValidityChecks.lovelaceChecks.aliceReceiveAddr();
ValidityChecks.lovelaceChecks.bobReceiveAddr();
ValidityChecks.lovelaceChecks.charlieReceiveAddr();

ValidityChecks.dogcoinChecks.alice();
ValidityChecks.dogcoinChecks.bob();
ValidityChecks.dogcoinChecks.charlie();
ValidityChecks.dogcoinChecks.operator();

ValidityChecks.sillycoinChecks.alice();
ValidityChecks.sillycoinChecks.bob();
ValidityChecks.sillycoinChecks.charlie();
ValidityChecks.sillycoinChecks.operator();

ValidityChecks.alicecoinChecks.alice();
ValidityChecks.alicecoinChecks.bob();
ValidityChecks.alicecoinChecks.charlie();
ValidityChecks.alicecoinChecks.operator();

ValidityChecks.bobcoinChecks.alice();
ValidityChecks.bobcoinChecks.bob();
ValidityChecks.bobcoinChecks.charlie();
ValidityChecks.bobcoinChecks.operator();

ValidityChecks.charliecoinChecks.alice();
ValidityChecks.charliecoinChecks.bob();
ValidityChecks.charliecoinChecks.charlie();
ValidityChecks.charliecoinChecks.operator();
