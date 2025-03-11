import { WebSocketClient } from "https://deno.land/x/websocket@v0.1.4/mod.ts";
import { BlacklistEntry } from "../db/blacklist.ts";

export const showBlacklist = async (ws: WebSocketClient, _rest: any) => {
  const kv = await Deno.openKv();
  const entries = kv.list<BlacklistEntry>({ prefix: ["blacklist"] });
  const blacklist = [];
  
  for await (const entry of entries) {
    blacklist.push({
      address: entry.key[1],
      reason: entry.value.reason,
      date: entry.value.date,
      participant: entry.value.participant
    });
  }

  kv.close();
  ws.send(JSON.stringify({
    type: "blacklist_contents",
    data: blacklist
  }));
}; 