import { Participant } from "../src/types/index.ts";
import { BlacklistEntry } from "../src/db/blacklist.ts";

const kv = await Deno.openKv();

async function clearKv() {
  const entries = kv.list({ prefix: [] });
  for await (const entry of entries) {
    await kv.delete(entry.key);
  }
  console.log("KV store cleared successfully!");
}

async function showKv() {
  console.log("\nCurrent KV Store contents:");
  console.log("-------------------------");
  const entries = kv.list({ prefix: [] });
  let hasEntries = false;
  
  for await (const entry of entries) {
    hasEntries = true;
    console.log(`\nKey: ${entry.key.join(":")}`);
    console.log("Value:", entry.value);
  }

  if (!hasEntries) {
    console.log("KV store is empty");
  }
}

async function showBlacklist() {
  console.log("\nBlacklist contents:");
  console.log("------------------");
  const entries = kv.list<BlacklistEntry>({ prefix: ["blacklist"] });
  let hasEntries = false;

  for await (const entry of entries) {
    hasEntries = true;
    const blacklistEntry = entry.value;
    console.log("\nBlacklisted Address:", entry.key[1]);
    console.log("Reason:", blacklistEntry.reason);
    console.log("Date:", new Date(blacklistEntry.date).toLocaleString());
    console.log("Participant Details:");
    console.log("  Address:", blacklistEntry.participant.address);
    console.log("  Recipient:", blacklistEntry.participant.recipient);
  }

  if (!hasEntries) {
    console.log("No addresses are currently blacklisted");
  }
}

// Parse command line arguments
const command = Deno.args[0];

switch (command) {
  case "clear":
    await clearKv();
    break;
  case "show":
    await showKv();
    break;
  case "blacklist":
    await showBlacklist();
    break;
  default:
    console.log(`
Usage: deno run --unstable-kv scripts/manage-kv.ts <command>

Commands:
  clear      Clear all entries from the KV store
  show       Show all entries in the KV store
  blacklist  Show all blacklisted addresses and their details
`);
    break;
}

// Close the KV store
kv.close(); 