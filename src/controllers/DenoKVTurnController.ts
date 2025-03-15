import { MIN_PARTICIPANTS } from "../config/constants.ts";
import { createTransaction } from "../createTransaction.ts";
import { lucid } from "../services/lucid.ts";
import { Ceremony, CeremonyRecord, Participant } from "../types/index.ts";
import { ITurnController } from "./ITurnController.ts";

export class DenoKVTurnController implements ITurnController {
  private kv: Deno.Kv;

  constructor(kv: Deno.Kv) {
    this.kv = kv;
  }

  async addParticipant(participant: Participant): Promise<void> {
    // Add to queue with timestamp for ordering
    await this.kv.atomic()
      .set(["queue", Date.now(), participant.address], participant)
      .commit();
  }

  async tryCreateCeremony(): Promise<string> {
    const participants: Participant[] = [];
    
    // Get participants from queue in order
    const iter = this.kv.list({ prefix: ["queue"] });
    for await (const entry of iter) {
      participants.push(entry.value as Participant);
      if (participants.length >= MIN_PARTICIPANTS) break;
    }

    if (participants.length < MIN_PARTICIPANTS) {
      return "0";
    }

    const ceremony: Ceremony = {
      id: crypto.randomUUID(),
      participants,
      transaction: "",
      witnesses: [],
      transactionHash: "",
    };

    // Create transaction and add operator witness
    ceremony.transaction = await createTransaction(ceremony.participants);
    ceremony.transactionHash = lucid.fromTx(ceremony.transaction).toHash();
    const operatorWitness = await lucid.fromTx(ceremony.transaction).partialSign.withWallet();
    ceremony.witnesses.push(operatorWitness);

    // Store ceremony and remove participants from queue atomically
    const atomic = this.kv.atomic();
    
    // Add ceremony
    atomic.set(["ceremonies", ceremony.id], ceremony);
    
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
    return ceremony.id;
  }

  async cancelCeremony(id: string): Promise<void> {
    const ceremonyEntry = await this.kv.get<Ceremony>(["ceremonies", id]);
    if (!ceremonyEntry.value) return;

    const atomic = this.kv.atomic();
    
    // Move participants back to queue
    for (const participant of ceremonyEntry.value.participants) {
      atomic.set(["queue", Date.now(), participant.address], participant);
    }
    
    // Remove ceremony
    atomic.delete(["ceremonies", id]);
    await atomic.commit();
  }

  async processCeremony(id: string): Promise<number> {
    const ceremonyEntry = await this.kv.get<Ceremony>(["ceremonies", id]);
    if (!ceremonyEntry.value) return 0;

    const ceremony = ceremonyEntry.value;
    if (ceremony.participants.length + 1 !== ceremony.witnesses.length) {
      return 0;
    }

    const assembled = lucid.fromTx(ceremony.transaction).assemble(ceremony.witnesses);
    const ready = await assembled.complete();
    const submitted = await ready.submit();
    console.log("Transaction submitted:", submitted);

    // Add to history and remove from active ceremonies
    await this.kv.atomic()
      .set(["ceremony_history", ceremony.id], {
        id: ceremony.id,
        transactionHash: ceremony.transactionHash,
      })
      .delete(["ceremonies", id])
      .commit();

    return 1;
  }

  async addWitness(id: string, witness: string): Promise<void> {
    const ceremonyEntry = await this.kv.get<Ceremony>(["ceremonies", id]);
    if (!ceremonyEntry.value) return;

    const ceremony = ceremonyEntry.value;
    ceremony.witnesses.push(witness);
    
    await this.kv.set(["ceremonies", id], ceremony);
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
    const history: CeremonyRecord[] = [];
    const iter = this.kv.list<CeremonyRecord>({ prefix: ["ceremony_history"] });
    for await (const entry of iter) {
      history.push(entry.value);
    }
    return history;
  }
} 