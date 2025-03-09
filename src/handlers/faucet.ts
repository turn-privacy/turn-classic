import { WebSocketClient } from "https://deno.land/x/websocket@v0.1.4/mod.ts";
import { FAUCET_AMOUNT } from "../config/constants.ts";
import { lucid } from "../services/lucid.ts";

export const handleFaucet = async (ws: WebSocketClient, rest: any) => {
  const { address } = rest;
  console.log("Faucet requested for:", address);

  const tx = await lucid
    .newTx()
    .pay.ToAddress(address, { lovelace: FAUCET_AMOUNT })
    .complete();

  const signedTx = await tx.sign.withWallet().complete();
  const txHash = await signedTx.submit();
  console.log("Faucet sent:", txHash);

  ws.send(JSON.stringify({
    type: "faucet_sent",
    data: txHash,
  }));
}; 