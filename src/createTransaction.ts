import { Participant } from "./types/index.ts";
import { lucid } from "./services/lucid.ts";
import { operator } from "./services/lucid.ts";
import { selectUserUtxos } from "./services/lucid.ts";
import { calculateUserChange } from "./services/lucid.ts";
import { OPERATOR_FEE, UNIFORM_OUTPUT_VALUE } from "./config/constants.ts";

const two_hours = 2 * 60 * 60 * 1000;

export const createTransaction = async (participants: Participant[]) => {
  const operatorUtxos = await lucid.utxosAt(operator.address);
  const tx = await participants.reduce<Promise<any>>(
    async (accTx: Promise<any>, user: any): Promise<any> => {
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
        .validTo(Date.now() + two_hours),
    ),
  );
  const completeTx = await tx.complete();
  return completeTx.toCBOR();
};