import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { Participant } from "./src/types/index.ts";
import { MIN_PARTICIPANTS, OPERATOR_FEE, UNIFORM_OUTPUT_VALUE } from "./src/config/constants.ts";
import { calculateUserChange, selectUserUtxos, lucid, operator } from "./src/services/lucid.ts";
import { getAddressDetails, verifyData } from "npm:@lucid-evolution/lucid";
import { Buffer } from "npm:buffer";

const fromHexToText = (hex: string) =>  Buffer.from(hex, 'hex').toString('utf-8');


type Ceremony = {
  id: string;
  participants: Participant[];
  transaction: string;
  witnesses: string[];
};

const createTransaction = async (participants: Participant[]) => {
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
        }) // operator fee
    ),
  );
  const completeTx = await tx.complete();
  return completeTx.toCBOR();
};

class TurnController {
  // queue of participants waiting to be put into a ceremony
  private queue: Participant[] = [];
  // list of ceremonies
  private ceremonies: Ceremony[] = [];

  // add a participant to the queue
  addParticipant(participant: Participant) {
    this.queue.push(participant);
  }

  // try to create a ceremony
  async tryCreateCeremony() {
    // if there are enough participants in the queue, create a ceremony
    if (this.queue.length < MIN_PARTICIPANTS) 
      return;

    // and remove the participants from the queue
    const ceremony : Ceremony = {
      id: crypto.randomUUID(),
      participants: [...this.queue],
      transaction: "",
      witnesses: [],
    };

    ceremony.transaction = await createTransaction(ceremony.participants);

    const operatorWitness = await lucid.fromTx(ceremony.transaction).partialSign.withWallet();
    ceremony.witnesses.push(operatorWitness);
    // remove the participants from the queue
    this.queue = this.queue.filter((p) => !ceremony.participants.includes(p));

    this.ceremonies.push(ceremony);

    return ceremony.id;
  }

  // cancel a ceremony
  cancelCeremony(id: string) {
    // move all participants back to the queue
    const ceremony = this.ceremonies.find((c) => c.id === id);
    if (!ceremony) return;
    this.queue.push(...ceremony.participants);
    // remove the ceremony from the list
    this.ceremonies = this.ceremonies.filter((c) => c.id !== id);
  }

  async processCeremony(id: string) {
    const ceremony = this.ceremonies.find((c) => c.id === id);
    if (!ceremony) return;

    if (ceremony.participants.length +1 !== ceremony.witnesses.length) 
      return;
   
    const assembled = lucid.fromTx(ceremony.transaction).assemble(ceremony.witnesses);
    const ready = await assembled.complete();
    const submitted = await ready.submit();
    console.log("Transaction submitted:", submitted);

    // if num participants = num witnesses --> continue
    // submit the transaction
    // remove the ceremony from the list
    this.ceremonies = this.ceremonies.filter((c) => c.id !== id);
  }

  addWitness(id: string, witness: string) {
    // add a witness to the ceremony
    const ceremony = this.ceremonies.find((c) => c.id === id);
    if (!ceremony) return;
    // check if the witness is valid
    // check that we don't already have a witness from this signer
    // check that the signer is actually a participant in this ceremony
    ceremony.witnesses.push(witness);
  }

  getCeremonies() {
    return this.ceremonies;
  }

  getQueue() {
    return this.queue;
  }
};

const turnController = new TurnController();

async function handleSignup(req: Request): Promise<Response> {
  console.log("handleSignup");
  const { signedMessage, payload } = await req.json();

  // get address and recipient from payload
  const { address, recipient } = JSON.parse(fromHexToText(payload));

  const addressDetails = getAddressDetails(address);

  // check the signature is valid 
  const isValidSignature = verifyData(
    addressDetails.address.hex,
    addressDetails.paymentCredential!.hash,
    payload,
    signedMessage,
  );

  if (!isValidSignature) {
    return new Response("Invalid signature", { status: 400 });
  }

  { // check a whole bunch of things

  }

  const participant : Participant = {
    address,
    recipient,
    signedMessage,
  }
  // if all checks pass, add the participant to the queue
  turnController.addParticipant(participant);
  return new Response("Participant added to queue", { status: 200 });
}

function handleListActiveCeremonies(): Response {
  return new Response(JSON.stringify(turnController.getCeremonies()), { status: 200 });
}

function handleQueue(): Response {
  return new Response(JSON.stringify(turnController.getQueue()), { status: 200 });
}

async function handleSubmitSignature(req: Request): Promise<Response> {
  const { id, witness } = await req.json();
  turnController.addWitness(id, witness);
  return new Response("Witness added to ceremony", { status: 200 });
}

async function handleGet(req: Request): Promise<Response> {
  console.log("STUB: inside handleGet");
  const { pathname } = new URL(req.url);
  switch (pathname) {
    case "/list_active_ceremonies":
      return handleListActiveCeremonies();
    case "/queue":
      return handleQueue();
    default:
      return new Response("Not Found", { status: 404 });
  }
}

async function handlePost(req: Request): Promise<Response> {
  console.log("STUB: inside handlePost");
  const { pathname } = new URL(req.url);
  switch (pathname) {
    case "/signup":
      return await handleSignup(req);
    case "/submit_signature":
      return await handleSubmitSignature(req);
    default:
      return new Response("Not Found", { status: 404 });
  }
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "http://localhost:3000",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // Add CORS headers to all responses
  const corsHeaders = {
    "Access-Control-Allow-Origin": "http://localhost:3000",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  try {
    let response: Response;
    switch (req.method) {
      case "GET":
        response = await handleGet(req);
        break;
      case "POST":
        response = await handlePost(req);
        break;
      default:
        return new Response("Method Not Allowed", { 
          status: 405,
          headers: corsHeaders
        });
    }

    // Add CORS headers to the response
    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      newHeaders.set(key, value);
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  } catch (error) {
    console.error("Error handling request:", error);
    return new Response("Internal Server Error", { 
      status: 500,
      headers: corsHeaders
    });
  }
};

console.log("Server is running on http://localhost:8000");
await serve(handler, { port: 8000 });
