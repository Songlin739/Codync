/** Friend-to-friend WebRTC signaling: a thin client for the `signal-relay` Worker (see
 *  `signal-relay/` at the repo root). The relay only forwards messages between the peers in one
 *  room; it never inspects them. Once a room's computers' WebRTC connection is up, ordinary
 *  messages/files never pass through it again — but a *call*'s ringing (`ring`/`ring-accept`/
 *  `ring-decline`/`ring-leave`, see `mesh-call.ts` for the session state these drive) is itself
 *  part of setting up, since you ring someone before any direct connection to them exists, and a
 *  group call's room can hold more than two people where the SDP/ICE exchange never could. The
 *  relay fans a message out to every other socket in the room without tagging who sent it, so
 *  every ring message below names its own sender (`from`) — the relay can't be trusted to. */

/** Both sides derive the same room id from their own and their friend's computer id, so no
 *  separate exchange is needed before connecting — whichever side calls this with the same two
 *  ids gets the same string back, in either order. Not a secret: knowing it only lets you ask the
 *  relay to join that room, and the relay still caps a room at a handful of sockets. */
export function signalRoomId(computerIdA: string, computerIdB: string): string {
  const [a, b] = [computerIdA, computerIdB].sort()
  return `${a}.${b}`
}

/** Turns a relay base address (`https://…` or `wss://…`, trailing slashes trimmed like other
 *  saved addresses in this app — see `relayAddressToSave`) into the room's websocket URL. */
export function signalRelayUrl(base: string, roomId: string): string {
  const trimmed = base.trim().replace(/\/+$/, '')
  const wsBase = trimmed.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
  return `${wsBase}/v1/room/${roomId}`
}

/** The signaling messages this client exchanges — never anything else. Each decodes to exactly
 *  one of these shapes; a message that doesn't match is dropped rather than passed on, so a
 *  confused or hostile relay can't hand the caller something it didn't ask for. */
export type SignalMessage =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit }
  // `from` is always self-reported: whoever is ringing, accepting, declining, or leaving names
  // themselves. Inviting someone ELSE (an existing call adding a new friend) is a different
  // shape below, precisely because there the sender and the person being invited differ.
  | { type: 'ring'; from: string; callId: string }
  | { type: 'ring-accept'; from: string; callId: string }
  | { type: 'ring-decline'; from: string; callId: string }
  | { type: 'ring-leave'; from: string; callId: string }
  | { type: 'ring-invite'; from: string; callId: string; invitee: string }

export function parseSignalMessage(raw: string): SignalMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if ((v.type === 'offer' || v.type === 'answer') && typeof v.sdp === 'string') {
    return { type: v.type, sdp: v.sdp }
  }
  if (v.type === 'ice' && typeof v.candidate === 'object' && v.candidate !== null) {
    return { type: 'ice', candidate: v.candidate as RTCIceCandidateInit }
  }
  if (
    (v.type === 'ring' || v.type === 'ring-accept' || v.type === 'ring-decline' || v.type === 'ring-leave') &&
    typeof v.from === 'string' &&
    typeof v.callId === 'string'
  ) {
    return { type: v.type, from: v.from, callId: v.callId }
  }
  if (v.type === 'ring-invite' && typeof v.from === 'string' && typeof v.callId === 'string' && typeof v.invitee === 'string') {
    return { type: 'ring-invite', from: v.from, callId: v.callId, invitee: v.invitee }
  }
  return null
}

/** A minimal subset of the DOM `WebSocket` this client needs, so tests can supply a fake one
 *  instead of opening a real connection. */
export interface SignalSocket {
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onclose: (() => void) | null
  onerror: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: string }) => void) | null
}

export type SignalSocketFactory = (url: string) => SignalSocket

/** Connects to one room and exchanges `SignalMessage`s with whoever else is in it. Reconnection,
 *  backoff and the actual `RTCPeerConnection` wiring (offer/answer negotiation, ICE restart, data
 *  channels) are the caller's job — this class only owns the relay socket. */
export class P2PSignalClient {
  private readonly relayBase: string
  private readonly roomId: string
  private readonly makeSocket: SignalSocketFactory
  private socket: SignalSocket | null = null
  private readonly listeners = new Set<(message: SignalMessage) => void>()

  constructor(
    relayBase: string,
    roomId: string,
    makeSocket: SignalSocketFactory = (url) => new WebSocket(url) as unknown as SignalSocket,
  ) {
    this.relayBase = relayBase
    this.roomId = roomId
    this.makeSocket = makeSocket
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = this.makeSocket(signalRelayUrl(this.relayBase, this.roomId))
      socket.onopen = () => resolve()
      socket.onerror = (ev) => reject(ev)
      socket.onmessage = (ev) => {
        const message = parseSignalMessage(ev.data)
        if (message) for (const listen of this.listeners) listen(message)
      }
      socket.onclose = () => {
        this.socket = null
      }
      this.socket = socket
    })
  }

  send(message: SignalMessage): void {
    this.socket?.send(JSON.stringify(message))
  }

  onMessage(listener: (message: SignalMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    this.socket?.close()
    this.socket = null
  }
}
