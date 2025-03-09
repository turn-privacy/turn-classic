import { WebSocketClient } from "https://deno.land/x/websocket@v0.1.4/mod.ts";
import { MIN_PARTICIPANTS, UNIFORM_OUTPUT_VALUE, OPERATOR_FEE } from "./config/constants.ts";
import { getQueue } from "./db/queue.ts";
import { getTxDetails, setTxDetails } from "./db/transactions.ts";
import { handleFaucet } from "./handlers/faucet.ts";
import { handleSignature, checkWitnesses } from "./handlers/signature.ts";
import { handleSignup } from "./handlers/signup.ts";
import { lucid, operator, selectUserUtxos, calculateUserChange } from "./services/lucid.ts";
import { broadcast, setupHeartbeat, wss } from "./services/websocket.ts";
import { moveParticipantsToActiveCeremony, moveParticipantsBackToQueue } from "./db/ceremony.ts";

console.log("Operator address:", operator.address);
console.log("Operator balance:", await lucid.utxosAt(operator.address).then(utxos => utxos.reduce((acc, utxo) => acc + utxo.assets.lovelace, 0n)));

const checkQueue = async () => {
  const participants = await getQueue();

  if (participants.length < MIN_PARTICIPANTS) {
    return console.log("Not enough participants for a ceremony.");
  }

  console.log("%cEnough participants for a ceremony.", "color: pink");

  try {
    // Move participants to active ceremony before processing
    const ceremonyParticipants = await moveParticipantsToActiveCeremony();
    
    const operatorUtxos = await lucid.utxosAt(operator.address);
    const minute = 60 * 1000;

    const tx = await ceremonyParticipants.reduce<Promise<any>>(
      async (accTx: Promise<any>, user: any): Promise<any> => {
        const utxos = await selectUserUtxos(user.address);
        const userChange = calculateUserChange(utxos);
        return (await accTx)
          .collectFrom(utxos)
          .pay.ToAddress(user.recipient, { lovelace: UNIFORM_OUTPUT_VALUE })
          .pay.ToAddress(user.address, userChange)
          .addSigner(user.address);
      },
      Promise.resolve(
        lucid
          .newTx()
          .collectFrom(operatorUtxos)
          .pay.ToAddress(operator.address, {
            lovelace: OPERATOR_FEE * BigInt(ceremonyParticipants.length),
          }) // operator fee
          .validTo(Date.now() + (15 * minute)),
      ),
    );
    const completeTx = await tx.complete();

    console.log(`%cTransaction constructed ${completeTx.toHash()}`, "color: purple");
    const rawUnsigned = completeTx.toCBOR();

    const txDetails = await getTxDetails();
    txDetails.expectedSigners = ceremonyParticipants.map((p) => p.address);
    txDetails.tx = rawUnsigned;
    txDetails.signatures.clear();
    await setTxDetails(txDetails);

    broadcast({
      type: "transactionReady",
      data: {
        tx: rawUnsigned,
        msg: "Please sign and return",
      },
    });
  } catch (error) {
    console.error("Failed to process ceremony:", error);
    // Move participants back to queue if anything fails
    await moveParticipantsBackToQueue();
  }
};

wss.on("connection", (ws: WebSocketClient) => {
  const { status, heartbeat } = setupHeartbeat(ws);

  ws.on("message", async (rawMsg: string) => {
    status.alive = true;
    const { type, ...rest } = JSON.parse(rawMsg);

    switch (type) {
      case "Polo!": // mark as alive
        break;
      case "faucet":
        await handleFaucet(ws, rest);
        break;
      case "signup":
        await handleSignup(ws, rest);
        await checkQueue();
        break;
      case "submit_signature":
        await handleSignature(ws, rest);
        await checkWitnesses();
        break;
      default:
        console.log("No handler for message type:", type);
        break;
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected.");
    clearInterval(heartbeat);
  });
}); 