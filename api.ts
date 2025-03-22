import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { Ceremony, Participant } from "./src/types/index.ts";
import { DenoKVTurnController } from "./src/controllers/DenoKVTurnController.ts";

const ENVIRONMENT = Deno.env.get("ENVIRONMENT") || "development";
const FRONTEND_DOMAIN = Deno.env.get("FRONTEND_DOMAIN");

const TEST_VALUE = Deno.env.get("TEST_VALUE") || "No test value set for TEST_VALUE";

// if (!FRONTEND_DOMAIN) {
//   throw new Error("FRONTEND_DOMAIN is not set");
// }

const CLIENT_ORIGIN = ENVIRONMENT === "production"
  ? FRONTEND_DOMAIN // Replace with your actual frontend domain
  : "http://localhost:3000";

if (!CLIENT_ORIGIN) {
  throw new Error("CLIENT_ORIGIN is not set");
}

const PORT = parseInt(Deno.env.get("SELF_PORT") || "8000");

// Initialize KV store and controller
const kv = await Deno.openKv();
const turnController = new DenoKVTurnController(kv);

async function handleCeremonyStatus(searchParams: URLSearchParams): Promise<Response> {
  const ceremonyId = searchParams.get("id");
  if (!ceremonyId) {
    return new Response("Missing ceremony id", { status: 400 });
  }
  // Check if ceremony is in active ceremonies
  const activeCeremony = (await turnController.getCeremonies()).find((c) => c.id === ceremonyId);
  if (activeCeremony) {
    return new Response("pending", { status: 200 });
  }

  // Check if ceremony is in history
  const historyCeremony = (await turnController.getCeremonyHistory()).find((c) => c.id === ceremonyId);
  if (historyCeremony) {
    return new Response("on-chain", { status: 200 });
  }

  // Ceremony not found in either place
  return new Response("could not find", { status: 404 });
}

async function handleSignup(req: Request): Promise<Response> {
  console.log("handleSignup");
  const { signedMessage, payload } = await req.json();

  const failureReason = await turnController.handleSignup(signedMessage, payload);
  if (failureReason) {
    return new Response(failureReason, { status: 400 });
  }

  const ceremonyId = await turnController.tryCreateCeremony();
  return new Response(`Participant added to queue ${ceremonyId !== "0" ? `and created ceremony ${ceremonyId}` : ""}`, { status: 200 });
}

async function handleListActiveCeremonies(): Promise<Response> {
  const ceremonies = await turnController.getCeremonies();
  const ceremoniesWithoutRecipients = ceremonies.map((ceremony: Ceremony) => ({ ...ceremony, participants: ceremony.participants.map((participant: Participant) => ({ ...participant, recipient: "" })) }));
  return new Response(JSON.stringify(ceremoniesWithoutRecipients), { status: 200 });
}

async function handleCeremonyHistory(): Promise<Response> {
  const history = await turnController.getCeremonyHistory();
  return new Response(JSON.stringify(history), { status: 200 });
}

async function handleQueue(): Promise<Response> {
  const queue = await turnController.getQueue();
  const queueWithoutRecipients = queue.map((participant: Participant) => ({ ...participant, recipient: "" }));
  return new Response(JSON.stringify(queueWithoutRecipients), { status: 200 });
}

async function handleSubmitSignature(req: Request): Promise<Response> {
  const { id, witness } = await req.json();
  const failureReason = await turnController.addWitness(id, witness);
  if (failureReason) {
    return new Response(failureReason, { status: 400 });
  }

  const processed = await turnController.processCeremony(id);

  return new Response(`Witness added to ceremony ${processed !== 0 ? `and processed transaction submitted` : ""}`, { status: 200 });
}

async function handleResetDatabase(req: Request): Promise<Response> {
  const { signedMessage, message } = await req.json();
  const failureReason = await turnController.handleResetDatabase(signedMessage, message);
  if (failureReason) {
    return new Response(failureReason, { status: 400 });
  }
  console.log("database reset successfully");
  return new Response("Database reset successfully", { status: 200 });
}

async function handleGet(req: Request): Promise<Response> {
  const { pathname, searchParams } = new URL(req.url);
  switch (pathname) {
    case "/test":
      return new Response(TEST_VALUE, { status: 200 });
    case "/list_active_ceremonies":
      return await handleListActiveCeremonies();
    case "/ceremony_history":
      return await handleCeremonyHistory();
    case "/queue":
      return await handleQueue();
    case "/ceremony_status":
      return await handleCeremonyStatus(searchParams);
    default:
      return new Response("Not Found", { status: 404 });
  }
}

async function handlePost(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  switch (pathname) {
    case "/signup":
      return await handleSignup(req);
    case "/submit_signature":
      return await handleSubmitSignature(req);
    case "/admin/reset":
      console.log("inside /admin/reset");
      return await handleResetDatabase(req);
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
        "Access-Control-Allow-Origin": CLIENT_ORIGIN,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // Add CORS headers to all responses
  const corsHeaders = {
    "Access-Control-Allow-Origin": CLIENT_ORIGIN,
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
          headers: corsHeaders,
        });
    }

    // Add CORS headers to the response
    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      newHeaders.set(key, value);
    });

    try {
      await turnController.checkBadCeremonies();
    }
    catch (error) {
      console.error("Error checking for bad ceremonies:", error);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  } catch (error) {
    console.error("Error handling request:", error);
    return new Response("Internal Server Error", {
      status: 500,
      headers: corsHeaders,
    });
  }
};

console.log(`Server is running on port ${PORT}`);
await serve(handler, { port: PORT });
