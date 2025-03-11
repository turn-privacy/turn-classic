import { Blockfrost, Lucid, TxSignBuilder, unixTimeToSlot } from "npm:@lucid-evolution/lucid";

const minute = 60 * 1000;

const blockfrostApiKey = Deno.env.get("BLOCKFROST_API_KEY");

if (!blockfrostApiKey) {
  throw new Error("BLOCKFROST_API_KEY is not set");
}

const operatorSeed = Deno.env.get("OPERATOR_MNEMONIC");
if (!operatorSeed) {
  throw new Error("OPERATOR_MNEMONIC is not set");
}

const lucid = await Lucid(
  new Blockfrost(
    "https://cardano-preview.blockfrost.io/api/v0",
    blockfrostApiKey,
  ),
  "Preview",
);

lucid.selectWallet.fromSeed(operatorSeed);
const operatorAddress = await lucid.wallet().address();

const now = Date.now();
const now_as_slot = unixTimeToSlot("Preprod", now);
console.log(`Now: ${now}`)
console.log(`Now as slot: ${now_as_slot}`)

const response = await fetch("https://cardano-preview.blockfrost.io/api/v0/blocks/latest", {
  headers: { "project_id": blockfrostApiKey }
});

const {time, slot} = await response.json();
console.log(`Time of latest block: ${time}`);
console.log(`Slot of latest block: ${slot}`);

const tx: TxSignBuilder = await lucid.newTx()
  .pay.ToAddress(operatorAddress, { lovelace: 1_000_000n })
  .pay.ToAddress(operatorAddress, { lovelace: 1_000_000n })
  .pay.ToAddress(operatorAddress, { lovelace: 1_000_000n })
  .pay.ToAddress(operatorAddress, { lovelace: 1_000_000n })
  .pay.ToAddress(operatorAddress, { lovelace: 1_000_000n })
  .attachMetadata(674, { msg: "Minimal time test" })
  .addSigner(operatorAddress)
  .validTo(now + (15 * minute))
  .complete();
const signedTx = await tx.sign.withWallet().complete();
const submitted = await signedTx.submit();
console.log(`Transaction ID: https://preview.cexplorer.io/tx/${submitted}`);


