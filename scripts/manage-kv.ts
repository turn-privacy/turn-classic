import { Participant } from "../src/types/index.ts";

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

// Parse command line arguments
const command = Deno.args[0];

switch (command) {
  case "clear":
    await clearKv();
    break;
  case "show":
    await showKv();
    break;
  default:
    console.log(`
Usage: deno run --unstable-kv scripts/manage-kv.ts <command>

Commands:
  clear   Clear all entries from the KV store
  show    Show all entries in the KV store
`);
    break;
}

// Close the KV store
kv.close(); 