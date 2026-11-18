import assert from 'node:assert/strict'
import test from 'node:test'
import { CallManager } from './call-signal.ts'
import type { P2PSignalClient, SignalMessage } from './p2p-signal.ts'

/** A fake relay room: every `send` from one fake client is delivered to every *other* fake
 *  client sharing the same `room` array — mirroring `signal-relay`'s SignalRoom, which forwards a
 *  message to every other peer and never echoes it back to its sender. */
function fakeRoom(): { join: () => P2PSignalClient } {
  const members: { listeners: Set<(m: SignalMessage) => void> }[] = []
  return {
    join: () => {
      const self = { listeners: new Set<(m: SignalMessage) => void>() }
      members.push(self)
      const fake = {
        send: (message: SignalMessage) => {
          for (const other of members) if (other !== self) for (const listen of other.listeners) listen(message)
        },
        onMessage: (listener: (m: SignalMessage) => void) => {
          self.listeners.add(listener)
          return () => self.listeners.delete(listener)
        },
      }
      return fake as unknown as P2PSignalClient
    },
  }
}

test('a 1:1 call: the caller rings, the callee hears it, accepts, and both sides agree it is active', () => {
  const room = fakeRoom()
  const callerSignal = room.join()
  const callee = CallManager.start(callerSignal, 'alice', 'c1', ['bob'])
  assert.equal(callee.state, 'ringing')

  const bobSignal = room.join()
  let incoming: Extract<SignalMessage, { type: 'ring' }> | null = null
  bobSignal.onMessage((m) => {
    if (m.type === 'ring') incoming = m
  })
  // Re-send so bob's just-attached listener sees it too, same as the real relay would for a
  // peer that joins the room mid-ring (out of scope for this test: just drives the fixture).
  callerSignal.send({ type: 'ring', from: 'alice', callId: 'c1' })
  assert.ok(incoming)
  const bob = CallManager.fromIncomingRing(bobSignal, 'bob', incoming!)
  assert.equal(bob.state, 'ringing')

  bob.accept()
  assert.equal(bob.state, 'active')
  assert.equal(callee.state, 'active') // alice's side heard bob's ring-accept
})

test('a 1:1 call ends on both sides when the callee declines', () => {
  const room = fakeRoom()
  const aliceSignal = room.join()
  const alice = CallManager.start(aliceSignal, 'alice', 'c1', ['bob'])
  const bobSignal = room.join()
  const bob = CallManager.fromIncomingRing(bobSignal, 'bob', { type: 'ring', from: 'alice', callId: 'c1' })

  bob.decline()
  assert.equal(bob.state, 'ended')
  assert.equal(alice.state, 'ended')
})

test('a group call: a third friend joining mid-call is seen by everyone already in it', () => {
  const room = fakeRoom()
  const aliceSignal = room.join()
  const alice = CallManager.start(aliceSignal, 'alice', 'c1', ['bob'])
  const bobSignal = room.join()
  const bob = CallManager.fromIncomingRing(bobSignal, 'bob', { type: 'ring', from: 'alice', callId: 'c1' })
  bob.accept()
  assert.equal(alice.state, 'active')

  alice.inviteMore('carol')
  assert.equal(alice.state, 'ringing') // waiting on carol now
  assert.equal(bob.state, 'ringing') // bob heard the new ring too

  const carolSignal = room.join()
  const carol = CallManager.fromRingInvite(carolSignal, 'carol', { type: 'ring-invite', from: 'alice', callId: 'c1', invitee: 'carol' })
  carol.accept()
  assert.equal(alice.state, 'active')
  assert.equal(bob.state, 'active')
  assert.equal(carol.state, 'active')
})

test('onStateChange fires exactly once per real transition, not on every message', () => {
  const room = fakeRoom()
  const aliceSignal = room.join()
  const transitions: string[] = []
  const alice = CallManager.start(aliceSignal, 'alice', 'c1', ['bob'], {
    onStateChange: (state) => transitions.push(state),
  })
  const bobSignal = room.join()
  const bob = CallManager.fromIncomingRing(bobSignal, 'bob', { type: 'ring', from: 'alice', callId: 'c1' })
  bob.accept()
  bob.leave()
  assert.deepEqual(transitions, ['active', 'ended'])
  assert.equal(alice.state, 'ended')
})

test('a disposed manager stops reacting to further ring traffic on the same room', () => {
  const room = fakeRoom()
  const aliceSignal = room.join()
  const alice = CallManager.start(aliceSignal, 'alice', 'c1', ['bob'])
  const bobSignal = room.join()
  const bob = CallManager.fromIncomingRing(bobSignal, 'bob', { type: 'ring', from: 'alice', callId: 'c1' })
  alice.dispose()
  bob.accept()
  assert.equal(alice.state, 'ringing') // alice stopped listening before bob's accept arrived
})
