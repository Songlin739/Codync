import assert from 'node:assert/strict'
import test from 'node:test'
import { P2PSignalClient, parseSignalMessage, signalRelayUrl, signalRoomId, type SignalSocket } from './p2p-signal.ts'

test('the room id is the same for both friends regardless of who computes it first', () => {
  assert.equal(signalRoomId('alice-id', 'bob-id'), signalRoomId('bob-id', 'alice-id'))
  assert.equal(signalRoomId('alice-id', 'bob-id'), 'alice-id.bob-id')
})

test('the relay base address is trimmed and switched to a websocket scheme', () => {
  assert.equal(signalRelayUrl('https://relay.example.com/', 'room1'), 'wss://relay.example.com/v1/room/room1')
  assert.equal(signalRelayUrl('http://localhost:8799', 'room1'), 'ws://localhost:8799/v1/room/room1')
})

test('only the known signaling shapes parse; anything else is dropped', () => {
  assert.deepEqual(parseSignalMessage('{"type":"offer","sdp":"x"}'), { type: 'offer', sdp: 'x' })
  assert.deepEqual(parseSignalMessage('{"type":"answer","sdp":"y"}'), { type: 'answer', sdp: 'y' })
  assert.deepEqual(parseSignalMessage('{"type":"ice","candidate":{"candidate":"c"}}'), {
    type: 'ice',
    candidate: { candidate: 'c' },
  })
  assert.equal(parseSignalMessage('not json'), null)
  assert.equal(parseSignalMessage('{"type":"offer"}'), null) // missing sdp
  assert.equal(parseSignalMessage('{"type":"somethingElse"}'), null)
  assert.equal(parseSignalMessage('null'), null)
})

test('ring messages parse with their sender and call id, and reject malformed ones', () => {
  assert.deepEqual(parseSignalMessage('{"type":"ring","from":"alice","callId":"c1"}'), {
    type: 'ring',
    from: 'alice',
    callId: 'c1',
  })
  assert.deepEqual(parseSignalMessage('{"type":"ring-accept","from":"bob","callId":"c1"}'), {
    type: 'ring-accept',
    from: 'bob',
    callId: 'c1',
  })
  assert.deepEqual(parseSignalMessage('{"type":"ring-decline","from":"bob","callId":"c1"}'), {
    type: 'ring-decline',
    from: 'bob',
    callId: 'c1',
  })
  assert.deepEqual(parseSignalMessage('{"type":"ring-leave","from":"bob","callId":"c1"}'), {
    type: 'ring-leave',
    from: 'bob',
    callId: 'c1',
  })
  assert.equal(parseSignalMessage('{"type":"ring","from":"alice"}'), null) // missing callId
  assert.equal(parseSignalMessage('{"type":"ring","callId":"c1"}'), null) // missing from
})

test('a ring-invite names both who sent it and who is being invited, and needs both to parse', () => {
  assert.deepEqual(parseSignalMessage('{"type":"ring-invite","from":"alice","callId":"c1","invitee":"carol"}'), {
    type: 'ring-invite',
    from: 'alice',
    callId: 'c1',
    invitee: 'carol',
  })
  assert.equal(parseSignalMessage('{"type":"ring-invite","from":"alice","callId":"c1"}'), null) // missing invitee
})

function fakeSocket(): { socket: SignalSocket; emitOpen: () => void; emitMessage: (raw: string) => void; sent: string[] } {
  const sent: string[] = []
  const socket: SignalSocket = {
    send: (data) => sent.push(data),
    close: () => {},
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
  }
  return {
    socket,
    sent,
    emitOpen: () => socket.onopen?.(),
    emitMessage: (raw) => socket.onmessage?.({ data: raw }),
  }
}

test('connect resolves once the socket opens, and messages reach every listener', async () => {
  const fake = fakeSocket()
  const client = new P2PSignalClient('https://relay.example.com', 'room1', () => fake.socket)
  const connected = client.connect()
  fake.emitOpen()
  await connected

  const received: string[] = []
  client.onMessage((m) => received.push(m.type))
  fake.emitMessage('{"type":"offer","sdp":"x"}')
  fake.emitMessage('{"type":"garbage"}')
  assert.deepEqual(received, ['offer'])
})

test('send encodes the message as JSON on the underlying socket', async () => {
  const fake = fakeSocket()
  const client = new P2PSignalClient('https://relay.example.com', 'room1', () => fake.socket)
  const connected = client.connect()
  fake.emitOpen()
  await connected

  client.send({ type: 'answer', sdp: 'reply-sdp' })
  assert.deepEqual(fake.sent, ['{"type":"answer","sdp":"reply-sdp"}'])
})

test('a listener removed via its unsubscribe function stops receiving messages', async () => {
  const fake = fakeSocket()
  const client = new P2PSignalClient('https://relay.example.com', 'room1', () => fake.socket)
  const connected = client.connect()
  fake.emitOpen()
  await connected

  const received: string[] = []
  const unsubscribe = client.onMessage((m) => received.push(m.type))
  unsubscribe()
  fake.emitMessage('{"type":"offer","sdp":"x"}')
  assert.deepEqual(received, [])
})
