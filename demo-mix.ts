import { Assets, Blockfrost, Emulator, generateSeedPhrase, Lucid, TxBuilder, TxSignBuilder, UTxO } from "npm:@lucid-evolution/lucid";

const DEMO_ADDRESSES = 3;
const METADATA_LABEL = 674; // Standard metadata label
const minute = 60 * 1000;
const year = 31_556_952_000;

const blockfrostApiKey = Deno.env.get("BLOCKFROST_API_KEY");
if (!blockfrostApiKey) {
  console.error("Error: BLOCKFROST_API_KEY environment variable is not set");
  console.error("Please configure the BLOCKFROST_API_KEY in your .env file");
  Deno.exit(1);
}
console.log("Blockfrost API key:", blockfrostApiKey);

const lucid = await Lucid(
  new Blockfrost(
    "https://cardano-preview.blockfrost.io/api/v0",
    blockfrostApiKey,
  ),
  "Preview",
);
const operatorSeed = Deno.env.get("OPERATOR_MNEMONIC");
if (!operatorSeed) {
  console.error("Error: OPERATOR_MNEMONIC environment variable is not set");
  console.error("Please configure the OPERATOR_MNEMONIC in your .env file");
  Deno.exit(1);
}

lucid.selectWallet.fromSeed(operatorSeed);

async function init_get_wallet_address(): Promise<[string, string]> {
  const emulator = new Emulator([]);
  const offlineLucid = await Lucid(emulator, "Preview");
  const seedPhrase = generateSeedPhrase();
  offlineLucid.selectWallet.fromSeed(seedPhrase);
  const address = await offlineLucid.wallet().address();
  return [address, seedPhrase];
}

type User = {
  name: string;
  address: string;
  seed: string;
  recipientAddress: string;
  recipientSeed: string;
};

const makeUser = async (name: string): Promise<User> => {
  const [address, seed] = await init_get_wallet_address();
  const [recipientAddress, recipientSeed] = await init_get_wallet_address();
  return { name, address, seed, recipientAddress, recipientSeed };
};

const operator: User = {
  name: "operator",
  seed: operatorSeed,
  address: await lucid.wallet().address(),
  recipientAddress: "",
  recipientSeed: "",
};
const balanceOf = async (address: string) => await lucid.utxosAt(address).then((utxos) => utxos.reduce((acc, utxo) => acc + utxo.assets.lovelace, 0n));

// {
//   // send one ada from the operator to the operator address
//   const tx : TxSignBuilder = await lucid.newTx()
//     .pay.ToAddress(operator.address, { lovelace: 1_000_000n })
//     .attachMetadata(METADATA_LABEL, { msg: "testing to see why .validTo doesn't work" })
//     .addSigner(operator.address)
//     .validTo(Date.now() + (15 * minute))
//     .complete();
//   const signedTx = await tx.sign.withWallet().complete();
//   const submitted = await signedTx.submit();
//   console.log(`Transaction ID: https://preview.cexplorer.io/tx/${submitted}`);
//   Deno.exit(0);
// }

console.log("Operator address:", operator.address);
console.log("Operator balance:", await balanceOf(operator.address));

const participants = await Promise.all(Array.from({ length: DEMO_ADDRESSES }, async (_, i) => await makeUser(`user-${i}`)));
const outputSize = 5_000_000n; // how much ada does each user mix
const operatorFee = 1_000_000n;

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

{ // send funds from operator to users from operator in a single tx
  const operatorUtxos = await lucid.utxosAt(operator.address);
  // const tx = await participants.reduce<Promise<TxBuilder>>(
  //   async (accTx: Promise<TxBuilder>, user: User): Promise<TxBuilder> => {
  //     return (await accTx)
  //       .pay.ToAddress(user.address, { lovelace: outputSize * 2n });
  //   },
  //   Promise.resolve(
  //     lucid
  //       .newTx()
  //       .collectFrom(operatorUtxos)
  //       .attachMetadata(METADATA_LABEL, { msg: "Fund accounts for demo" }),
  //   ),
  // );


  const tx = participants.reduce<TxBuilder>(
     (accTx: TxBuilder, user: User): TxBuilder => {
      return (accTx)
        .pay.ToAddress(user.address, { lovelace: outputSize * 2n });
    },
      lucid
        .newTx()
        .collectFrom(operatorUtxos)
        .attachMetadata(METADATA_LABEL, { msg: "Fund accounts for demo" }),
  );
  console.log("Built tx to fund participants");

  const completeTx = await tx
    .validTo(Date.now() + (15 * minute))
    // .validTo(Date.now() + (3 * year))
    .complete();
  const signedTx = await completeTx.sign.withWallet().complete();
  const txHash = await signedTx.submit();
  console.log(`Transaction ID: https://preview.cexplorer.io/tx/${txHash}`);
  // wait for user to press enter to continue
  prompt("Press enter to continue");
  console.log("Moving on..."); // only needs to be signed by operator
}

// show balances
participants.forEach(async (user) => console.log(`${user.name} balance:`, await balanceOf(user.address)));

let mixHash: string;
{
  const operatorUtxos = await lucid.utxosAt(operator.address);
  // mix funds
  const tx = await participants.reduce<Promise<TxBuilder>>(
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
        .collectFrom(operatorUtxos)
        .pay.ToAddress(operator.address, { lovelace: operatorFee * BigInt(participants.length) }) // operator fee
        .attachMetadata(METADATA_LABEL, { msg: "Demo mix" })
        .addSigner(operator.address),
    ),
  );
  const completeTx = await tx
    // .validTo(Date.now() + (15 * minute))
    .complete();

  const rawUnsigned = completeTx.toCBOR();
  lucid.selectWallet.fromSeed(operator.seed);
  const operatorWitness = await lucid.fromTx(rawUnsigned).partialSign.withWallet();

  const witnesses = [operatorWitness];

  for (const participant of participants) {
    lucid.selectWallet.fromSeed(participant.seed);
    witnesses.push(await lucid.fromTx(rawUnsigned).partialSign.withWallet());
  }

  lucid.selectWallet.fromSeed(operator.seed);
  const assembled = completeTx.assemble(witnesses);
  const ready = await assembled.complete();

  const submitted = await ready.submit();
  mixHash = submitted;

  // show tx hash
  console.log(`Transaction ID: https://preview.cexplorer.io/tx/${submitted}`);

  prompt("Press enter to continue");
  console.log("Moving on...");
}

// show balances
participants.forEach(async (user) => console.log(`${user.name} balance:`, await balanceOf(user.address)));
participants.forEach(async (user) => console.log(`${user.name} recipient balance:`, await balanceOf(user.recipientAddress)));

{ // send all funds back to operator in a single tx
  const operatorUtxos = await lucid.utxosAt(operator.address);

  const participantsAndRecipients = [...participants, ...participants.map((user: User) => ({ address: user.recipientAddress, seed: user.recipientSeed }))];

  const tx = await participantsAndRecipients.reduce<Promise<TxBuilder>>(
    async (accTx: Promise<TxBuilder>, user: { address: string; seed: string }): Promise<TxBuilder> => {
      const utxos = await lucid.utxosAt(user.address);
      const balance = await balanceOf(user.address);

      return (await accTx)
        .collectFrom(utxos)
        .pay.ToAddress(operator.address, { lovelace: balance })
        .addSigner(user.address);
    },
    Promise.resolve(
      lucid
        .newTx()
        .collectFrom(operatorUtxos)
        .addSigner(operator.address)
        .attachMetadata(METADATA_LABEL, { msg: "send everything back to the operator to save tADA" }),
    ),
  );
  const completeTx = await tx.complete();

  const rawUnsigned = completeTx.toCBOR();
  lucid.selectWallet.fromSeed(operator.seed);
  const operatorWitness = await lucid.fromTx(rawUnsigned).partialSign.withWallet();

  const witnesses = [operatorWitness];

  for (const account of participantsAndRecipients) {
    lucid.selectWallet.fromSeed(account.seed);
    witnesses.push(await lucid.fromTx(rawUnsigned).partialSign.withWallet());
  }

  const assembled = completeTx.assemble(witnesses);
  const ready = await assembled.complete();

  const submitted = await ready.submit();
  console.log(`Transaction ID: https://preview.cexplorer.io/tx/${submitted}`);
}

console.log(`The link you want to share is https://preview.cardanoscan.io/transaction/${mixHash}`);
