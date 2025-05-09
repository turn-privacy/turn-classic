import { SignedMessage } from "npm:@lucid-evolution/lucid";
import { WebSocketClient } from "https://deno.land/x/websocket@v0.1.4/mod.ts";

export type Participant = {
  address: string;
  signedMessage: SignedMessage;
  recipient: string;
};

export type TransactionDetails = {
  expectedSigners: string[]; // addresses of participants
  tx: string; // raw tx
  signatures: Map<string, string>; // address -> signature
};

export type StoredTransactionDetails = {
  expectedSigners: string[];
  tx: string;
  signatures: [string, string][]; // Convert Map to array of [key, value] pairs for storage
};

export type Ceremony = {
  id: string;
  participants: Participant[];
  transaction: string;
  witnesses: string[];
  transactionHash: string;
};

export type BlacklistEntry = {
  timestamp: number;
  reason: string;
  id: string; // will later allow us to offer the user a chance to remove a blacklist entry by paying a fee (id prevents replay attacks/using one payment to remove self multiple times)
};

export type Assets = { [key: string]: bigint };

export type ClientMap = Map<WebSocketClient, string>; 

export type ProtocolParameters = {
  minParticipants: number;
  operatorFee: string;  
  uniformOutputValue: string;
};
