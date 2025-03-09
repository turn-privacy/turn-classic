import { Participant } from "../types/index.ts";

const kv = await Deno.openKv();

export async function getQueue(): Promise<Participant[]> {
  const queue = await kv.get<Participant[]>(["queue"]);
  return queue.value ?? [];
}

export async function setQueue(participants: Participant[]): Promise<void> {
  await kv.set(["queue"], participants);
}

export async function addParticipant(participant: Participant): Promise<void> {
  const participants = await getQueue();
  
  // Check for duplicate sending address
  if (participants.some(p => p.address === participant.address)) {
    throw new Error("Address already in queue");
  }

  // Check for duplicate receiving address
  if (participants.some(p => p.recipient === participant.recipient)) {
    throw new Error("Receiving address already in queue");
  }

  participants.push(participant);
  await setQueue(participants);
}

export async function removeParticipant(address: string): Promise<boolean> {
  const participants = await getQueue();
  const index = participants.findIndex(p => p.address === address);
  if (index === -1) return false;
  participants.splice(index, 1);
  await setQueue(participants);
  return true;
}

export async function clearQueue(): Promise<void> {
  await setQueue([]);
}

// Initialize empty queue if it doesn't exist
await setQueue(await getQueue()); 