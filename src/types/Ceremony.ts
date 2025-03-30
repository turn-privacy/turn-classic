import { Participant } from "./index.ts";
import { Either, left, right } from "../Either.ts";
import { lucid } from "../services/lucid.ts";
import { createTransaction } from "../createTransaction.ts";

export type Ceremony = {
  id: string;
  participants: Participant[];
  transaction: string;
  witnesses: string[];
  transactionHash: string;
};

export const ceremony = async (participants: Participant[]): Promise<Either<string, Ceremony>> => {
  try {
    const transaction = await createTransaction(participants);
    const transactionHash = lucid.fromTx(transaction).toHash();
    const witness = await lucid.fromTx(transaction).partialSign.withWallet();

    return right({
      id: crypto.randomUUID() as string,
      participants,
      transaction: transaction,
      witnesses: [witness],
      transactionHash: transactionHash,
    });
  } catch {
    return left("Failed to create transaction");
  }
};
