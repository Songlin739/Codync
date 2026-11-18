# super-signal-relay

The lightweight WebRTC signaling relay for Super's friend-to-friend P2P connections (see the
"多人协作架构" section of the product design doc). It is deliberately separate from `cloud/`
(the full Codync Cloud: accounts, your own devices, the end-to-end relay) and `private-relay/`
(self-hosted single-user push relay): a friend's computer is never one of this account's own
devices, so it doesn't belong in either.

What it does, in full: a client opens a WebSocket to `/v1/room/<roomId>`, and every message it
sends is forwarded, unread, to every other socket currently in that room (capped at 4, matching
the group-call mesh limit). That's the whole surface. It never parses, stores or logs a message —
once two friends' computers finish the WebRTC handshake carried over it, every later message,
file transfer or call goes directly between them and this Worker is out of the picture.

`roomId` is computed by the clients themselves — `signalRoomId()` in
`apps/desktop/src/renderer/lib/p2p-signal.ts` sorts the two friends' computer ids and joins them,
so both sides land in the same room without an extra round trip to agree on one.

## Layout

- `src/room.ts` — `SignalRoom`, one Durable Object per room, using hibernatable WebSockets so an
  idle room (most of a long call, or two friends connected but quiet) doesn't pin compute.
- `src/index.ts` — the Worker entry point; routes `/v1/room/<roomId>` to that room's DO and 404s
  everything else.
- `test/room.e2e.ts` — connects two real `ws` clients to a running `wrangler dev` instance and
  checks that a message sent by one arrives at the other, and only the other. Run it with:
  ```
  npx wrangler dev &
  node --experimental-strip-types --no-warnings test/room.e2e.ts
  ```

## Not yet here

TURN still comes from `cloud/`'s existing Cloudflare Calls integration (default) or self-hosted
Oracle Cloud + coturn (fallback) — this package only ever carries signaling messages, never
media or TURN traffic. The `RTCPeerConnection` lifecycle itself (creating offers/answers, ICE
restart on network change, data-channel setup) lives in the desktop app, on top of
`P2PSignalClient`; this relay doesn't know anything about it.
