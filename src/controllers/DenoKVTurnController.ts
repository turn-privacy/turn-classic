import { fromHex, getAddressDetails, paymentCredentialOf, SignedMessage, slotToUnixTime, verifyData } from "npm:@lucid-evolution/lucid";
import { MIN_PARTICIPANTS, OPERATOR_FEE, SIGNUP_CONTEXT, UNIFORM_OUTPUT_VALUE } from "../config/constants.ts";
import { createTransaction } from "../createTransaction.ts";
import { getBalance, lucid } from "../services/lucid.ts";
import { Ceremony, Participant, ProtocolParameters } from "../types/index.ts";
import { BlacklistEntry, blacklistEntry } from "../types/BlackListEntry.ts";
import { ceremonyRecord, CeremonyRecord } from "../types/CeremonyRecord.ts";
import { cancelledCeremony, CancelledCeremony } from "../types/CancelledCeremony.ts";
import { ITurnController } from "./ITurnController.ts";
import { Buffer } from "npm:buffer";
import * as CML from "npm:@anastasia-labs/cardano-multiplatform-lib-nodejs";
import { Either, isLeft, left, right } from "../Either.ts";
import { ceremony } from "../types/Ceremony.ts";

const fromHexToText = (hex: string) => Buffer.from(hex, "hex").toString("utf-8");

// const participantToPublicKey = (participant: Participant) : string => participant.signedMessage.key;

export class DenoKVTurnController implements ITurnController {
  private kv: Deno.Kv;

  constructor(kv: Deno.Kv) {
    this.kv = kv;
  }

  async handleResetDatabase(signedMessage: SignedMessage, message: string): Promise<null | string> {
    const { address, context, timestamp, action } = JSON.parse(fromHexToText(message));

    if (context !== "By signing this message, you confirm that you are the admin and intend to reset the database. This action cannot be undone.") {
      return "Invalid context";
    }

    if (action !== "reset_database") {
      return "Invalid action";
    }

    if (Date.now() - timestamp > 10 * 60 * 1000) {
      return "Message timestamp is too old";
    }

    const addressDetails = getAddressDetails(address);
    const adminCredential = Deno.env.get("ADMIN_CREDENTIAL");

    if (adminCredential !== addressDetails.paymentCredential!.hash) {
      console.log(`Invalid admin credential (expected ${adminCredential}, got ${addressDetails.paymentCredential!.hash})`);
      return "Invalid admin credential";
    }

    if (!adminCredential) {
      return "ADMIN_CREDENTIAL is not set";
    }

    const isValidSignature = verifyData(
      addressDetails.address.hex,
      addressDetails.paymentCredential!.hash,
      message,
      signedMessage,
    );

    if (!isValidSignature) {
      return "Invalid signature";
    }

    console.log("Authentication successful");

    // Start an atomic transaction
    const atomic = this.kv.atomic();

    // Delete all keys except ceremony history
    const iter = this.kv.list({ prefix: [] });
    for await (const entry of iter) {
      const [prefix] = entry.key;
      if (prefix !== "ceremony_history") {
        atomic.delete(entry.key);
      }
    }

    await atomic.commit();
    return null;
  }

  async handleSignup(signedMessage: SignedMessage, payload: string): Promise<null | string> {
    const { address, recipient, context, signupTimestamp } = JSON.parse(fromHexToText(payload));
    if (context !== SIGNUP_CONTEXT) {
      return "Invalid context";
    }
    if (Date.now() - signupTimestamp > 10 * 60 * 1000) {
      return "Signup timestamp is too old";
    }

    // check if they are blacklisted
    const isBlacklisted: Deno.KvEntryMaybe<BlacklistEntry> = await this.kv.get<BlacklistEntry>(["blacklist", paymentCredentialOf(address).hash]);
    if (isBlacklisted.value) {
      return "Participant is blacklisted for reason: " + isBlacklisted.value.reason;
    }

    for (const participant of await this.getQueue()) {
      if (participant.address === address) {
        return "Participant already in queue";
      }

      // if (participant.recipient === recipient)  // todo: enable in production
      //   return "Recipient already in queue";
    }

    // not already in a ceremony
    const ceremonies = await this.getCeremonies();
    for (const ceremony of ceremonies) {
      if (ceremony.participants.some((participant) => participant.address === address)) {
        return "Participant already in a ceremony";
      }
    }

    try {
      getAddressDetails(recipient);
    } catch {
      return "Invalid recipient address";
    }

    const addressDetails = getAddressDetails(address);

    const isValidSignature = verifyData(
      addressDetails.address.hex,
      addressDetails.paymentCredential!.hash,
      payload,
      signedMessage,
    );

    if (!isValidSignature) {
      return "Invalid signature";
    }

    // does the participant have enough funds?
    const balance = await getBalance(address);
    if (balance < UNIFORM_OUTPUT_VALUE + OPERATOR_FEE) {
      return "Participant does not have enough funds";
    }

    const participant: Participant = {
      address,
      recipient,
      signedMessage,
    };

    await this.kv.atomic()
      .set(["queue", Date.now(), participant.address], participant)
      .commit();

    return null;
  }

  /*

  todo:
  - ensure transaction is valid given state of the network at time of creation
  */
  async tryCreateCeremony(): Promise<Either<string, string>> {
    const participants: Participant[] = [];

    // Get participants from queue in order
    const iter = this.kv.list({ prefix: ["queue"] });
    for await (const entry of iter) {
      participants.push(entry.value as Participant);
      if (participants.length >= MIN_PARTICIPANTS) break;
    }

    if (participants.length < MIN_PARTICIPANTS) {
      return left("Not enough participants in queue to make a ceremony");
    }

    // const ceremony: Ceremony = {
    //   id: crypto.randomUUID(),
    //   participants,
    //   transaction: "",
    //   witnesses: [],
    //   transactionHash: "",
    // };
    const newCeremony : Either<string, Ceremony> = await ceremony(participants);

    if (isLeft(newCeremony)) {
      return left(newCeremony.value);
    }

    // Create transaction and add operator witness
    // try {
    //   newCeremony.transaction = await createTransaction(newCeremony.participants);
    //   newCeremony.transactionHash = lucid.fromTx(newCeremony.transaction).toHash();
    //   newCeremony.witnesses.push(await lucid.fromTx(newCeremony.transaction).partialSign.withWallet());
    // } catch {
    //   return left("Failed to create transaction");
    // }

    // Store ceremony and remove participants from queue atomically
    const atomic = this.kv.atomic();

    // Add ceremony
    atomic.set(["ceremonies", newCeremony.value.id], newCeremony.value);

    // Remove used participants from queue
    for (const participant of participants) {
      const queueIter = this.kv.list({ prefix: ["queue"] });
      for await (const entry of queueIter) {
        if ((entry.value as Participant).address === participant.address) {
          atomic.delete(entry.key);
          break;
        }
      }
    }

    await atomic.commit();
    return right(newCeremony.value.id);
  }

  async cancelCeremony(id: string, reason: string = "ceremony cancelled due to unknown reason"): Promise<void> {
    const ceremonyEntry = await this.kv.get<Ceremony>(["ceremonies", id]);
    if (!ceremonyEntry.value) return;

    const atomic = this.kv.atomic();

    // Move participants back to queue
    for (const participant of ceremonyEntry.value.participants) {
      atomic.set(["queue", Date.now(), participant.address], participant);
    }

    // Remove ceremony
    atomic.delete(["ceremonies", id]);

    // mark the ceremony as cancelled
    atomic.set(["cancelled_ceremonies", id], cancelledCeremony(reason, ceremonyEntry.value.transactionHash, id));

    await atomic.commit();
  }

  async checkIsCancelled(id: string): Promise<null | CancelledCeremony> {
    const cancelledCeremonyEntry = await this.kv.get<CancelledCeremony>(["cancelled_ceremonies", id]);
    if (cancelledCeremonyEntry.value) {
      return cancelledCeremonyEntry.value;
    }
    return null;
  }

  /*

  todo:
  - handle failure to submit transaction

  */
  async processCeremony(id: string): Promise<number> {
    const ceremonyEntry = await this.kv.get<Ceremony>(["ceremonies", id]);
    if (!ceremonyEntry.value) return 0;

    const ceremony = ceremonyEntry.value;
    if (ceremony.participants.length + 1 !== ceremony.witnesses.length) {
      return 0;
    }

    try {
      const assembled = lucid.fromTx(ceremony.transaction).assemble(ceremony.witnesses);
      const ready = await assembled.complete();
      const submitted = await ready.submit();
      console.log("Transaction submitted:", submitted);
    } catch {
      // cancel the ceremony
      await this.cancelCeremony(id, "Ceremony cancelled due to transaction failure");
    }
    // Add to history and remove from active ceremonies
    await this.kv.atomic()
      .set(["ceremony_history", ceremony.id], ceremonyRecord(ceremony))
      .delete(["ceremonies", id])
      .commit();

    return 1;
  }

  async addWitness(id: string, witness: string): Promise<null | string> {
    const ceremonyEntry = await this.kv.get<Ceremony>(["ceremonies", id]);
    if (!ceremonyEntry.value) return null;
    const ceremony: Ceremony = ceremonyEntry.value;

    { // ensure witness is correct
      const txWitness: CML.Vkeywitness | undefined = CML.TransactionWitnessSet.from_cbor_hex(witness).vkeywitnesses()?.get(0);
      if (undefined === txWitness) {
        return "Failed to decode witness";
      }

      const publicKey = txWitness.vkey();
      const witnessPaymentCredentialHash = publicKey.hash().to_hex();
      const expectedPaymentCredentialHashes = ceremony.participants.map((participant) => paymentCredentialOf(participant.address).hash);

      // witness must belong to one of the participants
      if (!expectedPaymentCredentialHashes.includes(witnessPaymentCredentialHash)) {
        return "Invalid witness";
      }

      // witness must not have already been added
      const alreadySigned: string[] = ceremony.witnesses.map((witness) => CML.TransactionWitnessSet.from_cbor_hex(witness).vkeywitnesses()?.get(0).vkey().hash().to_hex()).filter((hash) => hash !== undefined);
      if (alreadySigned.includes(witnessPaymentCredentialHash)) {
        return "Witness already added";
      }

      { // witness must ACTUALLY be a signature on THIS transaction
        const tx: CML.Transaction = CML.Transaction.from_cbor_hex(ceremony.transaction);
        const txBody: CML.TransactionBody = tx.body();
        const txBodyHash: CML.TransactionHash = CML.hash_transaction(txBody);

        const isValidSignature = publicKey.verify(fromHex(txBodyHash.to_hex()), txWitness.ed25519_signature());
        if (!isValidSignature) {
          return "Invalid witness - signature does not match transaction";
        }
        console.log(`%cWitness is valid for this transaction, is expected, and has not already been added.`, "color: green");
      }
    }

    ceremony.witnesses.push(witness);

    await this.kv.set(["ceremonies", id], ceremony);
    return null;
  }

  // todo: check all inputs are still unspent
  async checkBadCeremonies(): Promise<void> {
    // Start an atomic transaction
    const atomic = this.kv.atomic();

    // Get the last check timestamp
    const lastCheck = await this.kv.get<number | null>(["last_bad_ceremony_check_timestamp"]);

    // If we have a timestamp and it's less than 10 minutes old, return early
    if (lastCheck.value !== null && Date.now() - lastCheck.value < 10 * 60 * 1000) {
      // if (lastCheck.value !== null && Date.now() - lastCheck.value < 10 * 1000) {
      return;
    }

    // Get all ceremonies
    const ceremonies = await this.getCeremonies();

    // Set the last check timestamp in the atomic transaction
    atomic.set(["last_bad_ceremony_check_timestamp"], Date.now());

    if (ceremonies.length === 0) {
      return;
    }

    const network = lucid.config().network;
    if (undefined === network) {
      throw new Error("Network is undefined in lucid config");
    }

    // Process each ceremony
    for (const ceremony of ceremonies) {
      const tx: CML.Transaction = CML.Transaction.from_cbor_hex(ceremony.transaction);
      const txBody: CML.TransactionBody = tx.body();
      const ttlSlot = txBody.ttl();
      if (undefined === ttlSlot) {
        throw new Error("TTL slot is undefined in transaction");
      }

      const expirationTime = slotToUnixTime(network, Number(ttlSlot));
      console.log(`\nCeremony ${ceremony.id} expires at ${expirationTime}`);
      const delta = expirationTime - Date.now();
      console.log(`Time until expiration: ${delta}ms`);

      if (delta < 0) { // ceremony has expired
        console.log(`Ceremony ${ceremony.id} has expired`);
        // grab all payment credentials who have failed to sign
        const paymentCredentials = ceremony.participants.map((participant) => paymentCredentialOf(participant.address).hash);
        const thoseWhoSigned = ceremony.witnesses.map((witness) => CML.TransactionWitnessSet.from_cbor_hex(witness).vkeywitnesses()?.get(0).vkey().hash().to_hex()).filter((hash) => hash !== undefined);
        const thoseWhoFailedToSign = paymentCredentials.filter((cred) => !thoseWhoSigned.includes(cred));

        // add those who failed to sign to the blacklist
        for (const cred of thoseWhoFailedToSign) {
          atomic.set(["blacklist", cred], blacklistEntry("Failed to sign ceremony", cred));
        }

        // everyone else gets put back in the queue
        for (const participant of ceremony.participants) {
          // if they are in those who failed to sign, skip
          if (thoseWhoFailedToSign.includes(paymentCredentialOf(participant.address).hash)) {
            continue;
          }

          // otherwise, add them back to the queue and delete the ceremony
          atomic.set(["queue", Date.now(), participant.address], participant);
        }
        atomic.delete(["ceremonies", ceremony.id]);
        // atomic.set(["cancelled_ceremonies", ceremony.id], {
        //   reason: "Ceremony cancelled because it expired before all participants signed",
        //   timestamp: Date.now(),
        // });
        atomic.set(["cancelled_ceremonies", ceremony.id], cancelledCeremony("Ceremony cancelled because it expired before all participants signed", ceremony.transactionHash, ceremony.id));
      }

      // check all inputs are still unspent
    }

    // Commit all changes atomically
    await atomic.commit();
  }

  async getCeremonies(): Promise<Ceremony[]> {
    const ceremonies: Ceremony[] = [];
    const iter = this.kv.list<Ceremony>({ prefix: ["ceremonies"] });
    for await (const entry of iter) {
      ceremonies.push(entry.value);
    }
    return ceremonies;
  }

  async getQueue(): Promise<Participant[]> {
    const participants: Participant[] = [];
    const iter = this.kv.list<Participant>({ prefix: ["queue"] });
    for await (const entry of iter) {
      participants.push(entry.value);
    }
    return participants;
  }

  async getCeremonyHistory(): Promise<CeremonyRecord[]> {
    console.log("inside DenoKVTurnController::getCeremonyHistory");
    const history: CeremonyRecord[] = [];
    const iter = this.kv.list<CeremonyRecord>({ prefix: ["ceremony_history"] });
    for await (const entry of iter) {
      history.push(entry.value);
    }
    // order by expiration time if it exits, if it doesn't exit it goes to the end
    return history.sort((a, b) => (b.expirationTime || 0) - (a.expirationTime || 0));
  }

  // todo: test
  async getBlacklist(): Promise<BlacklistEntry[]> {
    const blacklist: BlacklistEntry[] = [];
    const iter = this.kv.list<BlacklistEntry>({ prefix: ["blacklist"] });
    for await (const entry of iter) {
      blacklist.push(entry.value);
    }
    return blacklist;
  }

  getProtocolParameters(): ProtocolParameters {
    return {
      minParticipants: MIN_PARTICIPANTS,
      operatorFee: OPERATOR_FEE.toString(),
      uniformOutputValue: UNIFORM_OUTPUT_VALUE.toString(),
    } as ProtocolParameters;
  }

  async getCancelledCeremonies(): Promise<CancelledCeremony[]> {
    const cancelledCeremonies: CancelledCeremony[] = [];
    const iter = this.kv.list<CancelledCeremony>({ prefix: ["cancelled_ceremonies"] });
    for await (const entry of iter) {
      cancelledCeremonies.push(entry.value);
    }
    return cancelledCeremonies;
  }

  
  
}
