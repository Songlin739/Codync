/** 通讯功能 (design doc "多人协作架构" §通话): a friend-to-friend call's *session* state — who's
 *  ringing, who's joined, who's left — capped at the same 4 participants as `signal-relay`'s
 *  `SignalRoom` (a call that could seat a 5th peer could never actually connect them, so the cap
 *  lives in both places on purpose). This module is pure state; it knows nothing about audio,
 *  video, or `RTCPeerConnection` — see `call-signal.ts` for how a session's transitions turn into
 *  outgoing signaling messages, and `p2p-signal.ts`'s own doc comment for what's still missing
 *  before a call can actually carry media (the WebRTC lifecycle itself).
 *
 *  A 1:1 call is just a mesh of two: nothing here distinguishes them, so there's one code path
 *  for both, matching the design doc's "1:1 / 群通话 Mesh 4人上限" as a single feature. */
export const MAX_CALL_PEERS = 4

export type ParticipantState = 'ringing' | 'joined' | 'declined' | 'left'

export type CallState = 'ringing' | 'active' | 'ended'

export interface CallSession {
  callId: string
  /** This computer's own friend id (or `'me'` in the group-owner-local case), always `'joined'`
   *  from the moment the session exists — you don't ring yourself. */
  participants: Map<string, ParticipantState>
}

/** Starts a session with this computer already in it and the given friends ringing. Throws if
 *  that would exceed the mesh cap (self included) — nobody is invited past capacity, rather than
 *  silently dropping whoever doesn't fit. */
export function startCall(callId: string, me: string, invite: string[]): CallSession {
  if (1 + invite.length > MAX_CALL_PEERS) {
    throw new Error(`最多 ${MAX_CALL_PEERS} 人通话，这次邀请的人数超过了上限`)
  }
  const participants = new Map<string, ParticipantState>([[me, 'joined']])
  for (const id of invite) participants.set(id, 'ringing')
  return { callId, participants }
}

/** The callee's side of a call someone else placed: the caller is already `joined` (they placed
 *  it), and this computer starts out `ringing` until it accepts or declines — the mirror image of
 *  `startCall`, whose caller starts `joined` and whose invitees start `ringing`. Using `startCall`
 *  here would get the two backwards: on the callee's own session, the callee would show up
 *  already `joined` before deciding anything. */
export function incomingCall(callId: string, me: string, caller: string): CallSession {
  return { callId, participants: new Map([[caller, 'joined'], [me, 'ringing']]) }
}

/** A friend accepting an invite someone else placed (or this computer receiving one — same
 *  transition either way; idempotent for a friend already in the session). Throws only for
 *  someone not already part of the session trying to join a call that's already full. */
export function accept(session: CallSession, friendId: string): CallSession {
  if (!session.participants.has(friendId) && session.participants.size >= MAX_CALL_PEERS) {
    throw new Error('通话人数已满，无法再加入')
  }
  const participants = new Map(session.participants)
  participants.set(friendId, 'joined')
  return { ...session, participants }
}

export function decline(session: CallSession, friendId: string): CallSession {
  const participants = new Map(session.participants)
  participants.set(friendId, 'declined')
  return { ...session, participants }
}

export function leave(session: CallSession, friendId: string): CallSession {
  const participants = new Map(session.participants)
  participants.set(friendId, 'left')
  return { ...session, participants }
}

/** Invites one more friend mid-call — the same cap applies as starting one. */
export function invite(session: CallSession, friendId: string): CallSession {
  if (joinedCount(session) + ringingCount(session) >= MAX_CALL_PEERS) {
    throw new Error(`最多 ${MAX_CALL_PEERS} 人通话，现在已经满了`)
  }
  const participants = new Map(session.participants)
  participants.set(friendId, 'ringing')
  return { ...session, participants }
}

export function joinedCount(session: CallSession): number {
  return [...session.participants.values()].filter((s) => s === 'joined').length
}

function ringingCount(session: CallSession): number {
  return [...session.participants.values()].filter((s) => s === 'ringing').length
}

/** `ended` once fewer than two people are joined or still ringing — a call of one is no call at
 *  all, whether that's a 1:1 call's other side leaving or a group call's last other member
 *  declining. `ringing` while anyone invited hasn't answered yet, otherwise `active`. */
export function callState(session: CallSession): CallState {
  const inCall = joinedCount(session) + ringingCount(session)
  if (inCall < 2) return 'ended'
  return ringingCount(session) > 0 ? 'ringing' : 'active'
}
