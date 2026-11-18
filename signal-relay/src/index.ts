// Super's friend-to-friend signaling relay: `GET /v1/room/<roomId>` upgrades to a WebSocket and
// joins that room's SignalRoom Durable Object (see room.ts). Everything else 404s — this Worker
// has no other surface, on purpose: it carries connection setup only, nothing a friend sends or
// shares ever touches it.

import { SignalRoom } from "./room.ts";

export { SignalRoom };

export interface Env {
  SIGNAL_ROOM: DurableObjectNamespace<SignalRoom>;
}

const ROOM_PATH = /^\/v1\/room\/([A-Za-z0-9_-]{8,128})$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    const match = ROOM_PATH.exec(pathname);
    if (!match) return new Response("not found", { status: 404 });
    const roomId = match[1]!;
    const stub = env.SIGNAL_ROOM.get(env.SIGNAL_ROOM.idFromName(roomId));
    return stub.fetch(req);
  },
};
