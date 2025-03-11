import { Participant } from "../types/index.ts";

const kv = await Deno.openKv();

export type BlacklistReason = "Failed To Sign" | "Spent Input" | "Disconnected During Ceremony";

export type BlacklistEntry = {
  participant: Participant;
  reason: BlacklistReason;
  date: number;
};

export async function addToBlacklist(participant: Participant, reason: BlacklistReason): Promise<void> {
  if (!participant?.address) {
    throw new Error("Invalid participant address");
  }
  const entry: BlacklistEntry = {
    participant,
    reason,
    date: Date.now(),
  };
  await kv.set(["blacklist", participant.address], entry);
}

export async function removeFromBlacklist(address: string): Promise<void> {
  if (!address) {
    throw new Error("Invalid address");
  }
  await kv.delete(["blacklist", address]);
}

export async function isBlacklisted(address: string): Promise<boolean> {
  if (!address) {
    return false;
  }
  const entry = await kv.get(["blacklist", address]);
  return entry.value !== null;
}

export async function getBlacklistEntry(address: string): Promise<BlacklistEntry | null> {
  if (!address) {
    return null;
  }
  const entry = await kv.get<BlacklistEntry>(["blacklist", address]);
  return entry.value;
}

// Initialize blacklist if it doesn't exist
await kv.get(["blacklist"]); 