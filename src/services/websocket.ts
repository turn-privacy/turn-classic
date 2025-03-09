import { WebSocketClient, WebSocketServer } from "https://deno.land/x/websocket@v0.1.4/mod.ts";
import { HEARTBEAT_TIME } from "../config/constants.ts";
import { ClientMap, Participant } from "../types/index.ts";
import { removeParticipant, getQueue } from "../db/queue.ts";
import { addToBlacklist } from "../db/blacklist.ts";
import { getActiveCeremonyParticipants, moveParticipantsBackToQueue } from "../db/ceremony.ts";
import { clearTxDetails, getTxDetails } from "../db/transactions.ts";

export const wss = new WebSocketServer(8081);
export const clientToAddress = new Map<WebSocketClient, string>();

export function broadcast(payload: unknown) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    client.send(msg);
  }
}

export const processDroppedClient = async (ws: WebSocketClient) => {
  const addressToRemove = clientToAddress.get(ws);
  if (addressToRemove === undefined) {
    return console.log("Could not find client in map."); // not a problem so long as client has not signed up
  }

  // First check if the client is part of an active ceremony
  const activeCeremony = await getActiveCeremonyParticipants();
  const txDetails = await getTxDetails();
  
  const isInActiveCeremony = activeCeremony.some(p => p.address === addressToRemove);
  const isExpectedSigner = txDetails.expectedSigners.includes(addressToRemove);

  if (isInActiveCeremony || isExpectedSigner) {
    console.log(`Client ${addressToRemove} disconnected during active ceremony`);
    
    // Find the participant in the active ceremony
    const participant = activeCeremony.find(p => p.address === addressToRemove);
    if (participant) {
      // Add them to blacklist
      await addToBlacklist(participant, "Disconnected During Ceremony");
    }

    // Move all participants back to queue (except the disconnected one)
    await moveParticipantsBackToQueue();
    
    // Clear the current transaction
    await clearTxDetails();

    // Broadcast ceremony failure to all clients
    broadcast({
      type: "ceremonyFailed",
      data: {
        reason: "Participant Disconnected",
        msg: `Participant ${addressToRemove} disconnected during the ceremony. They have been blacklisted and the ceremony has been cancelled.`,
      },
    });

    clientToAddress.delete(ws);
    return;
  }

  // If not in active ceremony, just remove from queue
  const removed = await removeParticipant(addressToRemove);
  if (!removed) {
    return console.log("Could not find client in queue.");
  }

  clientToAddress.delete(ws);
  
  // Broadcast updated queue to all clients
  const updatedQueue = await getQueue();
  broadcast({
    type: "show_participant_queue",
    data: updatedQueue.map((p) => p.address),
  });
};

export function setupHeartbeat(ws: WebSocketClient) {
  console.log(`Client connected.`);

  const status = {
    alive: true,
  };

  const heartbeat = setInterval(() => {
    if (status.alive === false) {
      console.log("Client is dead. Terminating connection.");
      try {
        clearInterval(heartbeat);
        processDroppedClient(ws).catch(console.error);
        ws.close(0, "Client failed to respond to heartbeat.");
      } catch {
        console.log("Failed to close connection.");
      }
      return;
    }

    status.alive = false;
    try {
      ws.send(JSON.stringify({ type: "Marco!" }));
    } catch {
      console.log("Failed to send heartbeat.");
    }
  }, HEARTBEAT_TIME);

  return { status, heartbeat };
} 