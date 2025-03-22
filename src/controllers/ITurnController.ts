import { SignedMessage } from "npm:@lucid-evolution/lucid";
import { Ceremony, CeremonyRecord, Participant } from "../types/index.ts";

export interface ITurnController {
  handleSignup(signedMessage: SignedMessage, payload: string): Promise<null | string>;
  tryCreateCeremony(): Promise<string>;
  cancelCeremony(id: string): Promise<void>;
  processCeremony(id: string): Promise<number>;
  addWitness(id: string, witness: string): Promise<null | string>;
  getCeremonies(): Promise<Ceremony[]>;
  getQueue(): Promise<Participant[]>;
  getCeremonyHistory(): Promise<CeremonyRecord[]>;
  checkBadCeremonies(): Promise<void>;
  handleResetDatabase(signedMessage: SignedMessage, message: string): Promise<null | string>;
}
