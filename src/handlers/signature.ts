import { WebSocketClient } from "https://deno.land/x/websocket@v0.1.4/mod.ts";
import { clearQueue } from "../db/queue.ts";
import { clearTxDetails, getTxDetails, setTxDetails } from "../db/transactions.ts";
import { lucid } from "../services/lucid.ts";
import { broadcast, clientToAddress } from "../services/websocket.ts";
import { clearActiveCeremony } from "../db/ceremony.ts";

export const handleSignature = async (ws: WebSocketClient, rest: any) => {
  console.log("Received signature:", rest);
  const txDetails = await getTxDetails();

  if (txDetails.expectedSigners.includes(rest.data.address) === false) {
    console.log(`%c${rest.data.address} is not expected in ${txDetails.expectedSigners}`, "color: red");
    ws.send(JSON.stringify({
      type: "unexpected_signature",
      message: "You are not expected to sign",
    }));
    return;
  }

  txDetails.signatures.set(rest.data.address, rest.data.witness);
  await setTxDetails(txDetails);
  
  ws.send(JSON.stringify({
    type: "signature_ack",
    data: "Thank you for signing. Please stand by until all signatures are collected.",
  }));
};

export const checkWitnesses = async () => {
  const txDetails = await getTxDetails();
  // each participant should have signed
  for (const address of txDetails.expectedSigners) {
    if (txDetails.signatures.has(address) === false) {
      console.log("Missing signature from:", address);
      return;
    }
  }

  const operatorWitness = await lucid.fromTx(txDetails.tx).partialSign.withWallet();
  const witnesses = [operatorWitness, ...Array.from(txDetails.signatures.values())];
  const assembled = lucid.fromTx(txDetails.tx).assemble(witnesses);
  const ready = await assembled.complete();
  const submitted = await ready.submit();
  console.log("Transaction submitted:", submitted);

  broadcast({
    type: "ceremonyConcluded",
    data: {
      members: txDetails.expectedSigners,
      tx: submitted,
      msg: "Check on-chain to confirm transaction",
    },
  });

  await clearTxDetails();
  await clearQueue();
  await clearActiveCeremony();
  clientToAddress.clear();
}; 