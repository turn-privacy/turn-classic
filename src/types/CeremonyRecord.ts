import { slotToUnixTime } from "npm:@lucid-evolution/lucid";
import { lucid } from "../services/lucid.ts";
import { Ceremony } from "./index.ts";
import * as CML from "npm:@anastasia-labs/cardano-multiplatform-lib-nodejs";

export type CeremonyRecord = {
  id: string;
  transactionHash: string;
  expirationTime: number; // the last moment when the ceremony's tx could be accepted by the chain
};

export const ceremonyRecord = (ceremony: Ceremony): CeremonyRecord => {
  const tx: CML.Transaction = CML.Transaction.from_cbor_hex(ceremony.transaction);
  const txBody: CML.TransactionBody = tx.body();
  const ttlSlot = txBody.ttl();
  if (undefined === ttlSlot) {
    throw new Error("TTL slot is undefined in transaction");
  }

  const network = lucid.config().network;
  if (undefined === network) {
    throw new Error("Network is undefined in lucid config");
  }

  const expirationTime = slotToUnixTime(network, Number(ttlSlot));

  return {
    id: ceremony.id,
    transactionHash: ceremony.transactionHash,
    expirationTime,
  };
};
