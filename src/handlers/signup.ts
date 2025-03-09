import { WebSocketClient } from "https://deno.land/x/websocket@v0.1.4/mod.ts";
import { AddressDetails, getAddressDetails, toText, verifyData } from "npm:@lucid-evolution/lucid";
import { OPERATOR_FEE, UNIFORM_OUTPUT_VALUE } from "../config/constants.ts";
import { addParticipant, getQueue } from "../db/queue.ts";
import { getBalance } from "../services/lucid.ts";
import { broadcast, clientToAddress } from "../services/websocket.ts";
import { isBlacklisted, getBlacklistEntry } from "../db/blacklist.ts";

export const handleSignup = async (ws: WebSocketClient, rest: any) => {
  const { address, signedMessage, payload } = rest;

  // Check if address is blacklisted
  if (await isBlacklisted(address)) {
    const entry = await getBlacklistEntry(address);
    ws.send(JSON.stringify({
      type: "failed_signup",
      data: `Address is blacklisted. Reason: ${entry?.reason}, Date: ${new Date(entry?.date || 0).toISOString()}`,
    }));
    return;
  }

  // verify sign-up request
  // check signature
  const addressDetails: AddressDetails = getAddressDetails(address);
  const hasSigned: boolean = verifyData(
    addressDetails.address.hex,
    addressDetails.paymentCredential!.hash,
    payload,
    signedMessage,
  );
  if (hasSigned === false) {
    ws.send(JSON.stringify({
      type: "failed_signup",
      data: "could not verify signature",
    }));
    return;
  }

  // payload makes sense
  const decodedPayload = JSON.parse(toText(payload));
  const recipientAddressDetails: AddressDetails = getAddressDetails(decodedPayload.recipient); // errors if invalid address

  if (addressDetails.paymentCredential === undefined || recipientAddressDetails.paymentCredential === undefined) {
    ws.send(JSON.stringify({
      type: "failed_signup",
      data: "could not verify payment credentials",
    }));
    return;
  }

  if (addressDetails.paymentCredential === recipientAddressDetails.paymentCredential) {
    ws.send(JSON.stringify({
      type: "failed_signup",
      data: "You may not send to an address with a matching payment credential as this would compromise privacy",
    }));
    return;
  }

  // if there are stake credentials, they should be different
  if ((addressDetails.stakeCredential !== undefined && recipientAddressDetails.stakeCredential !== undefined) && (addressDetails.stakeCredential === recipientAddressDetails.stakeCredential)) {
    ws.send(JSON.stringify({
      type: "failed_signup",
      data: "You may not send to an address with a matching stake credential as this would compromise privacy",
    }));
    return;
  }

  // check balance
  if (UNIFORM_OUTPUT_VALUE + OPERATOR_FEE > await getBalance(address)) {
    ws.send(JSON.stringify({
      type: "failed_signup",
      data: "you don't have enough ada",
    }));
    return;
  }

  try {
    // Add user to the queue and get updated queue in one atomic operation
    await addParticipant({ address, signedMessage, recipient: decodedPayload.recipient });
    const updatedQueue = await getQueue();
    
    // Debug logging
    console.log("Queue contents:", JSON.stringify(updatedQueue, null, 2));
    
    // Map client to address for future reference
    clientToAddress.set(ws, address);

    console.log("Participant signed up:", address);
    console.log("Queue size:", updatedQueue.length);

    // Send acknowledgment to the client
    ws.send(JSON.stringify({
      type: "signup_ack",
      data: "Thank you for signing up!",
    }));

    // Broadcast updated queue to all clients
    broadcast({
      type: "show_participant_queue",
      data: updatedQueue.map((p) => p.address),
    });
  } catch (error) {
    console.error("Error during signup:", error);
    ws.send(JSON.stringify({
      type: "failed_signup",
      data: error instanceof Error ? error.message : "An error occurred during signup",
    }));
  }
}; 