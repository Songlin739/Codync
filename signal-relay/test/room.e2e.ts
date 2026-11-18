// Connects two plain WebSocket clients to the same room against a running `wrangler dev` and
// checks that a message from one arrives, verbatim, at the other — and only at the other, not
// back at the sender. Run against a dev server: `wrangler dev --port 8799 &` then
// `node --experimental-strip-types --no-warnings test/room.e2e.ts`.
import assert from "node:assert/strict";
import { WebSocket } from "ws";

const base = process.env.RELAY_URL ?? "ws://localhost:8799";
const room = `e2e-${Date.now()}`;

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base}/v1/room/${room}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for a message")), timeoutMs);
    ws.once("message", (data: Buffer) => {
      clearTimeout(timer);
      resolve(data.toString());
    });
  });
}

const a = await connect();
const b = await connect();

a.send(JSON.stringify({ type: "offer", sdp: "a-made-this-up" }));
const atB = await nextMessage(b);
assert.equal(atB, JSON.stringify({ type: "offer", sdp: "a-made-this-up" }));

// The sender never gets its own message echoed back.
let echoed = false;
a.once("message", () => (echoed = true));
await new Promise((r) => setTimeout(r, 300));
assert.equal(echoed, false);

b.send(JSON.stringify({ type: "answer", sdp: "b-made-this-up" }));
const atA = await nextMessage(a);
assert.equal(atA, JSON.stringify({ type: "answer", sdp: "b-made-this-up" }));

a.close();
b.close();
console.log("signal-relay room e2e: ok");
