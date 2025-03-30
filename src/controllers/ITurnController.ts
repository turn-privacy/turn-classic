import { SignedMessage } from "npm:@lucid-evolution/lucid";
import { Participant, ProtocolParameters,} from "../types/index.ts";
import { CancelledCeremony } from "../types/CancelledCeremony.ts";
import { CeremonyRecord } from "../types/CeremonyRecord.ts";
import { Either } from "../Either.ts";
import { BlacklistEntry } from "../types/BlackListEntry.ts";
import { Ceremony } from "../types/Ceremony.ts";

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
  checkIsCancelled(id: string): Promise<null | CancelledCeremony>;
  getCancelledCeremonies(): Promise<CancelledCeremony[]>;
  removeBlacklistEntry(signedMessage: SignedMessage, payload: string): Promise<string>;
  // todo
  // allow admin to remove blacklist entry
  // allow admin to add blacklist entry
}
