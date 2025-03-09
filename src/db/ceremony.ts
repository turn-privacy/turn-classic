import { Participant } from "../types/index.ts";
import { getQueue, setQueue } from "./queue.ts";

const kv = await Deno.openKv();

export async function getActiveCeremonyParticipants(): Promise<Participant[]> {
  const ceremony = await kv.get<Participant[]>(["activeCeremony"]);
  return ceremony.value ?? [];
}

export async function setActiveCeremonyParticipants(participants: Participant[]): Promise<void> {
  await kv.set(["activeCeremony"], participants);
}

export async function moveParticipantsToActiveCeremony(): Promise<Participant[]> {
  const queueParticipants = await getQueue();
  await setActiveCeremonyParticipants(queueParticipants);
  await setQueue([]); // Clear the queue
  return queueParticipants;
}

export async function moveParticipantsBackToQueue(): Promise<void> {
  const ceremonyParticipants = await getActiveCeremonyParticipants();
  const currentQueue = await getQueue();
  
  // Add ceremony participants back to queue
  await setQueue([...currentQueue, ...ceremonyParticipants]);
  // Clear the active ceremony
  await setActiveCeremonyParticipants([]);
}

export async function clearActiveCeremony(): Promise<void> {
  await setActiveCeremonyParticipants([]);
}

// Initialize empty active ceremony if it doesn't exist
await setActiveCeremonyParticipants(await getActiveCeremonyParticipants()); 