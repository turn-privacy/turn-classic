import { StoredTransactionDetails, TransactionDetails } from "../types/index.ts";

const kv = await Deno.openKv();

export async function getTxDetails(): Promise<TransactionDetails> {
  const stored = await kv.get<StoredTransactionDetails>(["txDetails"]);
  if (!stored.value) {
    return {
      expectedSigners: [],
      tx: "",
      signatures: new Map(),
    };
  }
  return {
    expectedSigners: stored.value.expectedSigners,
    tx: stored.value.tx,
    signatures: new Map(stored.value.signatures),
  };
}

export async function setTxDetails(details: TransactionDetails): Promise<void> {
  const storedFormat: StoredTransactionDetails = {
    expectedSigners: details.expectedSigners,
    tx: details.tx,
    signatures: Array.from(details.signatures.entries()),
  };
  await kv.set(["txDetails"], storedFormat);
}

export async function clearTxDetails(): Promise<void> {
  await kv.set(["txDetails"], {
    expectedSigners: [],
    tx: "",
    signatures: [],
  });
}

// Initialize empty txDetails if it doesn't exist
await setTxDetails(await getTxDetails()); 