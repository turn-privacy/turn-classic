export const FAUCET_AMOUNT = 50n * 1_000_000n;

const uniformOutputValue = Number(Deno.env.get("UNIFORM_OUTPUT_VALUE"));
if (isNaN(uniformOutputValue)) {
  throw new Error("UNIFORM_OUTPUT_VALUE is not a number");
}

export const UNIFORM_OUTPUT_VALUE = BigInt(uniformOutputValue) * 1_000_000n;
export const OPERATOR_FEE = 1n * 1_000_000n;
// export const MIN_PARTICIPANTS : number = 2;
const minParticipants = Number(Deno.env.get("MIN_PARTICIPANTS"));
if (isNaN(minParticipants)) {
  throw new Error("MIN_PARTICIPANTS is not a number");
}
export const MIN_PARTICIPANTS = minParticipants;
export const HEARTBEAT_TIME = 5 * 1000; // in milliseconds 
export const SIGNUP_CONTEXT = "By signing this message, you express your intention to participate in a Turn Mixing Ceremony. A transaction will be created, and you will be asked to sign it. Failure to do so will result in your wallet being blacklisted from the Turn service. By signing this message, you also confirm that you have backed up the private key of the receiving address.";
