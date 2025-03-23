import { Participant } from "./types/index.ts";
import { lucid } from "./services/lucid.ts";
import { operator } from "./services/lucid.ts";
import { selectUserUtxos } from "./services/lucid.ts";
import { calculateUserChange } from "./services/lucid.ts";
import { OPERATOR_FEE, UNIFORM_OUTPUT_VALUE } from "./config/constants.ts";
import { TxBuilder } from "npm:@lucid-evolution/lucid";

const hour = 60 * 60 * 1000;


export const createTransaction = async (participants: Participant[]) : Promise<string> => {
  const operatorUtxos = await lucid.utxosAt(operator.address);
  const tx = await participants.reduce<Promise<TxBuilder>>(
    async (accTx: Promise<TxBuilder>, user: Participant): Promise<TxBuilder> => {
      const utxos = await selectUserUtxos(user.address);
      const userChange = calculateUserChange(utxos);
      return (await accTx)
        .collectFrom(utxos)
        .pay.ToAddress(user.recipient, { lovelace: UNIFORM_OUTPUT_VALUE })
        .pay.ToAddress(user.address, userChange)
        .addSigner(user.address);
    },
    Promise.resolve(
      lucid
        .newTx()
        .collectFrom(operatorUtxos)
        .pay.ToAddress(operator.address, {
          lovelace: OPERATOR_FEE * BigInt(participants.length),
        })
        .validTo(Date.now() + hour)
    ),
  );
  const completeTx = await tx.complete();
  return completeTx.toCBOR();
};