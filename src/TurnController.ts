import { MIN_PARTICIPANTS } from "./config/constants.ts";
import { createTransaction } from "./createTransaction.ts";
import { lucid } from "./services/lucid.ts";
import { Ceremony, CeremonyRecord, Participant } from "./types/index.ts";

export interface ITurnController {
  addParticipant(participant: Participant): void;
  tryCreateCeremony(): Promise<string>;
  cancelCeremony(id: string): void;
  processCeremony(id: string): Promise<number>;
  addWitness(id: string, witness: string): void;
  getCeremonies(): Ceremony[];
  getQueue(): Participant[];
  getCeremonyHistory(): CeremonyRecord[];
}

export class InMemoryTurnController implements ITurnController {
  // queue of participants waiting to be put into a ceremony
  private queue: Participant[] = [];
  // list of ceremonies
  private ceremonies: Ceremony[] = [];
  private ceremonyHistory: CeremonyRecord[] = [];

  // add a participant to the queue
  addParticipant(participant: Participant) {
    this.queue.push(participant);
  }

  // try to create a ceremony
  async tryCreateCeremony() {
    // if there are enough participants in the queue, create a ceremony
    if (this.queue.length < MIN_PARTICIPANTS) {
      return "0";
    }

    // and remove the participants from the queue
    const ceremony: Ceremony = {
      id: crypto.randomUUID(),
      participants: [...this.queue],
      transaction: "",
      witnesses: [],
      transactionHash: "",
    };

    ceremony.transaction = await createTransaction(ceremony.participants);
    ceremony.transactionHash = lucid.fromTx(ceremony.transaction).toHash();

    const operatorWitness = await lucid.fromTx(ceremony.transaction).partialSign.withWallet();
    ceremony.witnesses.push(operatorWitness);
    // remove the participants from the queue
    this.queue = this.queue.filter((p) => !ceremony.participants.includes(p));

    this.ceremonies.push(ceremony);

    return ceremony.id;
  }

  // cancel a ceremony
  cancelCeremony(id: string) {
    // move all participants back to the queue
    const ceremony = this.ceremonies.find((c) => c.id === id);
    if (!ceremony) return;
    this.queue.push(...ceremony.participants);
    // remove the ceremony from the list
    this.ceremonies = this.ceremonies.filter((c) => c.id !== id);
  }

  async processCeremony(id: string) {
    const ceremony = this.ceremonies.find((c) => c.id === id);
    if (!ceremony) return 0;

    if (ceremony.participants.length + 1 !== ceremony.witnesses.length) {
      return 0;
    }

    const assembled = lucid.fromTx(ceremony.transaction).assemble(ceremony.witnesses);
    const ready = await assembled.complete();
    const submitted = await ready.submit();
    console.log("Transaction submitted:", submitted);

    this.ceremonyHistory.push({
      id,
      transactionHash: ceremony.transactionHash,
    });

    // if num participants = num witnesses --> continue
    // submit the transaction
    // remove the ceremony from the list
    this.ceremonies = this.ceremonies.filter((c) => c.id !== id);

    return 1;
  }

  addWitness(id: string, witness: string) {
    // add a witness to the ceremony
    const ceremony = this.ceremonies.find((c) => c.id === id);
    if (!ceremony) return;
    // check if the witness is valid
    // check that we don't already have a witness from this signer
    // check that the signer is actually a participant in this ceremony
    ceremony.witnesses.push(witness);
  }

  getCeremonies() {
    return this.ceremonies;
  }

  getQueue() {
    return this.queue;
  }

  getCeremonyHistory() {
    return this.ceremonyHistory;
  }
}


