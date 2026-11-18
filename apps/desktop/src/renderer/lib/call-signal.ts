/** Wires a `mesh-call.ts` session's transitions to the `ring`/`ring-accept`/`ring-decline`/
 *  `ring-leave` messages a `P2PSignalClient` exchanges — the glue the design doc's "reusing the
 *  established P2P connection" refers to for call setup. What this does NOT do, because it isn't
 *  built yet: open an `RTCPeerConnection`, request a microphone or camera, or move any audio or
 *  video between the two computers. A `CallManager` here reaches `active` in the sense that
 *  everyone invited has answered — the moment real media would need to start flowing — and stops
 *  there; wiring that moment to actual WebRTC tracks is the deferred work `p2p-signal.ts`'s doc
 *  comment and `signal-relay/README.md` already flag. */

import type { P2PSignalClient, SignalMessage } from './p2p-signal.ts'
import { type CallSession, type CallState, accept, callState, decline, incomingCall, invite, leave, startCall } from './mesh-call.ts'

export interface CallManagerEvents {
  /** The session changed shape — someone rang, answered, declined, or left. */
  onSessionChange?: (session: CallSession) => void
  /** `state` just became what it now is, having been something else the moment before. */
  onStateChange?: (state: CallState, session: CallSession) => void
}

/** One call's manager: owns the session and the signal client's ring-message traffic for it.
 *  One `CallManager` per call, not per signal client — a friend you're not currently calling
 *  sends no ring messages for you to react to, so there's nothing for a manager to do until
 *  someone starts or receives one. */
export class CallManager {
  private readonly signal: P2PSignalClient
  private readonly me: string
  private session: CallSession
  private readonly events: CallManagerEvents
  private readonly unsubscribe: () => void

  private constructor(signal: P2PSignalClient, me: string, session: CallSession, events: CallManagerEvents) {
    this.signal = signal
    this.me = me
    this.session = session
    this.events = events
    this.unsubscribe = signal.onMessage((message) => this.receive(message))
  }

  /** This computer places the call: starts the session locally, then sends one `ring` — the
   *  room's relay broadcasts it to everyone else already in it, so this is one send regardless
   *  of how many friends are being invited, not one per invitee. */
  static start(signal: P2PSignalClient, me: string, callId: string, invitees: string[], events: CallManagerEvents = {}): CallManager {
    const session = startCall(callId, me, invitees)
    const manager = new CallManager(signal, me, session, events)
    signal.send({ type: 'ring', from: me, callId })
    return manager
  }

  /** This computer is one of the invitees: a `ring` already arrived, so build the session from
   *  that message instead of placing one. */
  static fromIncomingRing(signal: P2PSignalClient, me: string, ring: Extract<SignalMessage, { type: 'ring' }>, events: CallManagerEvents = {}): CallManager {
    const session = incomingCall(ring.callId, me, ring.from)
    return new CallManager(signal, me, session, events)
  }

  /** This computer is being pulled into a call already in progress — someone already in it
   *  named us in a `ring-invite` rather than us having placed or been the first one rung for it.
   *  Same shape as `fromIncomingRing`: whoever invited us (`invite.from`) is already `joined`. */
  static fromRingInvite(signal: P2PSignalClient, me: string, ringInvite: Extract<SignalMessage, { type: 'ring-invite' }>, events: CallManagerEvents = {}): CallManager {
    const session = incomingCall(ringInvite.callId, me, ringInvite.from)
    return new CallManager(signal, me, session, events)
  }

  get current(): CallSession {
    return this.session
  }

  get state(): CallState {
    return callState(this.session)
  }

  accept(): void {
    this.apply(accept(this.session, this.me))
    this.signal.send({ type: 'ring-accept', from: this.me, callId: this.session.callId })
  }

  decline(): void {
    this.apply(decline(this.session, this.me))
    this.signal.send({ type: 'ring-decline', from: this.me, callId: this.session.callId })
  }

  leave(): void {
    this.apply(leave(this.session, this.me))
    this.signal.send({ type: 'ring-leave', from: this.me, callId: this.session.callId })
  }

  /** Invites one more friend into an active or still-ringing call (the group-mesh case; a 1:1
   *  call growing into one). Unlike the initial `ring` — where the sender and the person joining
   *  are the same — the sender here (me) is already in the call, so the message has to name the
   *  invitee separately; see `ring-invite` in `p2p-signal.ts`. */
  inviteMore(friendId: string): void {
    this.apply(invite(this.session, friendId))
    this.signal.send({ type: 'ring-invite', from: this.me, callId: this.session.callId, invitee: friendId })
  }

  dispose(): void {
    this.unsubscribe()
  }

  private receive(message: SignalMessage): void {
    // A bare `ring` is only ever handled by `fromIncomingRing`, building a session that doesn't
    // exist yet — by the time a manager with this callId is listening here, it already knows
    // about the original caller, so a stray `ring` for the same callId is not this method's job.
    if (message.type !== 'ring-invite' && message.type !== 'ring-accept' && message.type !== 'ring-decline' && message.type !== 'ring-leave') return
    if (message.callId !== this.session.callId) return
    // Arriving for a call that's already full (someone else's invite and this one crossed in
    // flight) is a real possibility, not a bug — drop it rather than let it throw out of the
    // signal client's synchronous listener loop and take other listeners down with it.
    try {
      if (message.type === 'ring-invite') this.apply(invite(this.session, message.invitee))
      else if (message.type === 'ring-accept') this.apply(accept(this.session, message.from))
      else if (message.type === 'ring-decline') this.apply(decline(this.session, message.from))
      else this.apply(leave(this.session, message.from))
    } catch {
      // full mesh; the friend who sent this will see their own accept/invite rejected on their side
    }
  }

  private apply(next: CallSession): void {
    const before = callState(this.session)
    this.session = next
    this.events.onSessionChange?.(next)
    const after = callState(next)
    if (after !== before) this.events.onStateChange?.(after, next)
  }
}
