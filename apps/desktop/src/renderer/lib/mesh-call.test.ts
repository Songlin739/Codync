import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_CALL_PEERS, accept, callState, decline, incomingCall, invite, leave, startCall } from './mesh-call.ts'

test('starting a call puts the caller in as joined and everyone invited as ringing', () => {
  const session = startCall('c1', 'me', ['alice', 'bob'])
  assert.equal(session.participants.get('me'), 'joined')
  assert.equal(session.participants.get('alice'), 'ringing')
  assert.equal(session.participants.get('bob'), 'ringing')
  assert.equal(callState(session), 'ringing')
})

test('a 1:1 call becomes active once the one other side accepts', () => {
  let session = startCall('c1', 'me', ['alice'])
  session = accept(session, 'alice')
  assert.equal(callState(session), 'active')
})

test('a 1:1 call ends when the other side leaves', () => {
  let session = startCall('c1', 'me', ['alice'])
  session = accept(session, 'alice')
  session = leave(session, 'alice')
  assert.equal(callState(session), 'ended')
})

test('a group call stays ringing until everyone invited has answered, one way or another', () => {
  let session = startCall('c1', 'me', ['alice', 'bob', 'carol'])
  session = accept(session, 'alice')
  assert.equal(callState(session), 'ringing')
  session = decline(session, 'bob')
  assert.equal(callState(session), 'ringing')
  session = accept(session, 'carol')
  assert.equal(callState(session), 'active')
})

test('a group call ends only once everyone else has declined or left, not when some still has', () => {
  let session = startCall('c1', 'me', ['alice', 'bob'])
  session = decline(session, 'alice')
  assert.equal(callState(session), 'ringing') // bob hasn't answered yet
  session = decline(session, 'bob')
  assert.equal(callState(session), 'ended')
})

test(`starting a call cannot seat more than ${MAX_CALL_PEERS} including the caller`, () => {
  assert.throws(() => startCall('c1', 'me', ['a', 'b', 'c', 'd']))
  assert.doesNotThrow(() => startCall('c1', 'me', ['a', 'b', 'c']))
})

test('inviting a new person mid-call respects the same cap', () => {
  let session = startCall('c1', 'me', ['a', 'b', 'c'])
  session = accept(session, 'a')
  session = accept(session, 'b')
  session = accept(session, 'c')
  assert.throws(() => invite(session, 'd'))
})

test('a new joiner cannot squeeze into an already-full call, but an existing participant re-accepting is fine', () => {
  let session = startCall('c1', 'me', ['a', 'b', 'c'])
  session = accept(session, 'a')
  session = accept(session, 'b')
  session = accept(session, 'c')
  assert.throws(() => accept(session, 'stranger'))
  assert.doesNotThrow(() => accept(session, 'a'))
})

test('the callee of an incoming call starts out ringing, with the caller already joined', () => {
  const session = incomingCall('c1', 'me', 'alice')
  assert.equal(session.participants.get('alice'), 'joined')
  assert.equal(session.participants.get('me'), 'ringing')
  assert.equal(callState(session), 'ringing')
})

test('a callee accepting an incoming call makes it active', () => {
  let session = incomingCall('c1', 'me', 'alice')
  session = accept(session, 'me')
  assert.equal(callState(session), 'active')
})

test('declining then later accepting the same invite still works (calling someone back)', () => {
  let session = startCall('c1', 'me', ['alice'])
  session = decline(session, 'alice')
  assert.equal(callState(session), 'ended')
  session = invite(session, 'alice')
  assert.equal(callState(session), 'ringing')
  session = accept(session, 'alice')
  assert.equal(callState(session), 'active')
})
