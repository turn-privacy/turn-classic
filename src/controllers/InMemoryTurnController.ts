import { SignedMessage } from "npm:@lucid-evolution/lucid";
import { MIN_PARTICIPANTS } from "../config/constants.ts";
import { createTransaction } from "../createTransaction.ts";
import { lucid } from "../services/lucid.ts";
import { Ceremony, CeremonyRecord, Participant } from "../types/index.ts";
import { ITurnController } from "./ITurnController.ts";


export class InMemoryTurnController implements ITurnController {
  // queue of participants waiting to be put into a ceremony
  private queue: Participant[] = [];
  // list of ceremonies
  private ceremonies: Ceremony[] = [];
  private ceremonyHistory: CeremonyRecord[] = [];

  handleSignup(signedMessage: SignedMessage, payload: string): Promise<null | string> {
    return Promise.resolve(null);
  }

  // try to create a ceremony
  async tryCreateCeremony() {
    // if there are enough participants in the queue, create a ceremony
    if (this.queue.length < MIN_PARTICIPANTS) {
      return "0";
    }

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
  cancelCeremony(id: string) : Promise<void> {
    // move all participants back to the queue
    const ceremony = this.ceremonies.find((c) => c.id === id);
    if (!ceremony) return Promise.resolve();
    this.queue.push(...ceremony.participants);
    this.ceremonies = this.ceremonies.filter((c) => c.id !== id);
    return Promise.resolve();
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

    this.ceremonies = this.ceremonies.filter((c) => c.id !== id);

    return 1;
  }

  addWitness(id: string, witness: string) : Promise<void> {
    // add a witness to the ceremony
    const ceremony = this.ceremonies.find((c) => c.id === id);
    if (!ceremony) return Promise.resolve();
    
    // todo: ensure witness belongs to a participant in the ceremony who has not already provided a witness
    // todo: ensure the witness is a valid signature on the transaction
    
    ceremony.witnesses.push(witness);
    return Promise.resolve();
  }

  getCeremonies() : Promise<Ceremony[]> {
    return Promise.resolve(this.ceremonies);
  }

  getQueue() : Promise<Participant[]> {
    return Promise.resolve(this.queue);
  }

  getCeremonyHistory() : Promise<CeremonyRecord[]> {
    return Promise.resolve(this.ceremonyHistory);
  }
}


