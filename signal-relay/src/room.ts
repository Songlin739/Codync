// SignalRoom: one Durable Object per signaling room — a pairwise 1:1 connection or a group-call
// mesh of up to MAX_PEERS. It only forwards whatever bytes a peer sends to every other peer
// currently in the room (offer/answer/ICE candidates, in the client's own JSON shape); it never
// parses, stores or logs the payload. The room id is computed by the clients themselves (e.g. a
// hash of the two friends' computer ids, sorted, so both sides land in the same room without a
// separate exchange) — this Worker treats it as an opaque string.
//
// This is deliberately much simpler than `cloud/src/relay.ts` (ComputerRelay): no accounts, no
// ACL, no offline mailbox, no rate limiting yet. A room that empties out is torn down by its own
// alarm; nothing here persists across that.

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index.ts";

/** However the invite/friend flow got each side into this room, nobody beyond that handful of
 *  friends should be able to join it, so a room is capped well below "anyone who guesses the id". */
const MAX_PEERS = 4;
/** A room with nobody in it for this long closes itself; it costs nothing to recreate later. */
const IDLE_MS = 10 * 60 * 1000;

export class SignalRoom extends DurableObject<Env> {
  private readonly peers = new Set<WebSocket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Hibernatable sockets: the DO can be evicted between messages and still wake up holding
    // these, so a quiet room doesn't pin compute while two friends have a connection open but
    // idle (most of a call or a long-lived P2P session).
    for (const ws of ctx.getWebSockets()) this.peers.add(ws);
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    if (this.peers.size >= MAX_PEERS) {
      return new Response("room full", { status: 409 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    this.peers.add(server);
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    // Forwarded as-is, to every other socket in the room; the sender already knows what it sent.
    for (const other of this.peers) {
      if (other !== ws) {
        try {
          other.send(message);
        } catch {
          // A send to a socket that's actually gone fails here rather than at close() time;
          // drop it so it stops being offered as a recipient.
          this.peers.delete(other);
        }
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    this.peers.delete(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.peers.delete(ws);
  }

  async alarm(): Promise<void> {
    if (this.peers.size === 0) return; // nothing to do; the DO is free to be evicted
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
  }
}
