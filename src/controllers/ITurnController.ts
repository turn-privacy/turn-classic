import { SignedMessage } from "npm:@lucid-evolution/lucid";
import { Ceremony, CeremonyRecord, Participant, BlacklistEntry, ProtocolParameters } from "../types/index.ts";
import { Either } from "../Either.ts";

export interface ITurnController {
  handleSignup(signedMessage: SignedMessage, payload: string): Promise<null | string>;
  tryCreateCeremony(): Promise<Either<string, string>>;
  cancelCeremony(id: string): Promise<void>;
  processCeremony(id: string): Promise<number>;
  addWitness(id: string, witness: string): Promise<null | string>;
  getCeremonies(): Promise<Ceremony[]>;
  getQueue(): Promise<Participant[]>;
  getCeremonyHistory(): Promise<CeremonyRecord[]>;
  checkBadCeremonies(): Promise<void>;
  handleResetDatabase(signedMessage: SignedMessage, message: string): Promise<null | string>;
  getBlacklist(): Promise<BlacklistEntry[]>;
  getProtocolParameters(): ProtocolParameters;
}
