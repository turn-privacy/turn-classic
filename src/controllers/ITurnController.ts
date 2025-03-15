import { Ceremony, CeremonyRecord, Participant } from "../types/index.ts";

export interface ITurnController {
  addParticipant(participant: Participant): Promise<void>;
  tryCreateCeremony(): Promise<string>;
  cancelCeremony(id: string): Promise<void>;
  processCeremony(id: string): Promise<number>;
  addWitness(id: string, witness: string): Promise<void>;
  getCeremonies(): Promise<Ceremony[]>;
  getQueue(): Promise<Participant[]>;
  getCeremonyHistory(): Promise<CeremonyRecord[]>;
}
