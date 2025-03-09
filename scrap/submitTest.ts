import { Blockfrost, Lucid, SLOT_CONFIG_NETWORK } from "npm:@lucid-evolution/lucid";

/*
    Author          William Doyle
    Date            March 3rd 2025
    File            submitTest.ts
    Description     Minimal experiment to submit a transaction to local yaci instance
*/

const MNEMONIC = "test test test test test test test test test test test test test test test test test test test test test test test sauce";
const FACET_AMOUNT = 5_000_000n; // 5 ADA

const shelleyParams: any = await fetch("http://localhost:10000/local-cluster/api/admin/devnet/genesis/shelley").then(
    (res) => res.json()
);

const zeroTime = new Date(shelleyParams.systemStart).getTime();
const slotLength = shelleyParams.slotLength * 1000; // in milliseconds

// for a default devkit cluster, we can now configure time parameters
SLOT_CONFIG_NETWORK["Custom"] = { zeroTime, slotLength, zeroSlot: 0 };

const lucid = await Lucid(
    new Blockfrost("http://localhost:8080/api/v1"),
    "Custom",
);
console.log("lucid constructed")
lucid.selectWallet.fromSeed(MNEMONIC);

const sender = await lucid.wallet().address();
console.log("Sender address:", sender);

const getBalance = async (address: string, unit: string = 'lovelace') => (await lucid.utxosAt(address)).reduce((acc, utxo) => acc + (utxo.assets[unit] ?? 0n), 0n);

console.log("Sender balance:", await getBalance(sender));

const recipient = `addr_test1qpklkvtxfuxrk56qsm2w9hwh6e0ld48fcysn05qhqkuvmfnrk6pteu6639vs49kpetgk6r0w22vtfu6a4v4y2a0j3xmqz4ewq0`;

console.log("Recipient address:", recipient);
console.log("Recipient balance:", await getBalance(recipient));

const tx = await lucid
    .newTx()
    .pay.ToAddress(recipient, { lovelace: FACET_AMOUNT })
    .complete();

console.log("built tx")

const signedTx = await tx.sign.withWallet().complete();
console.log("signed tx")
console.log(signedTx)

const txHash = await signedTx.submit();
console.log("Tx sent:", txHash);

console.log("Sender balance:", await getBalance(sender));
console.log("Recipient balance:", await getBalance(recipient));