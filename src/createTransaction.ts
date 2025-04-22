import { Participant } from "./types/index.ts";
import { lucid } from "./services/lucid.ts";
import { operator } from "./services/lucid.ts";
import { selectUserUtxos } from "./services/lucid.ts";
import { calculateUserChange } from "./services/lucid.ts";
import { OPERATOR_FEE, UNIFORM_OUTPUT_VALUE } from "./config/constants.ts";
import { TxBuilder } from "npm:@lucid-evolution/lucid";

// const hour = 60 * 60 * 1000;
const tenMinutes = 10 * 60 * 1000; // 10 minutes

/*
I feel like this shouldn't work!

The participants are sending all the funds on their utxos either to the recipient, back to themselves, or to the operator.

The operator isn't providing any input to the transaction.

Who is providing the network fee?

*/

export const createTransaction = async (participants: Participant[]) : Promise<string> => {
  //const operatorUtxos = await lucid.utxosAt(operator.address);
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
        //.collectFrom(operatorUtxos)
        .addSigner(operator.address)
        .pay.ToAddress(operator.address, {
          lovelace: OPERATOR_FEE * BigInt(participants.length),
        })
        .validTo(Date.now() + tenMinutes)
    ),
  );
  const completeTx = await tx.complete();

  {
    const txFee = completeTx.toTransaction().body().fee();
    console.log(`%cTransaction fee: ${txFee}`, "color: hotpink");
    const profit = (OPERATOR_FEE * BigInt(participants.length)) - txFee;
    console.log(`%cOperator profit: ${profit/1_000_000n}₳ (${profit} µ₳)`, "color: hotpink");
  }

  return completeTx.toCBOR();
};