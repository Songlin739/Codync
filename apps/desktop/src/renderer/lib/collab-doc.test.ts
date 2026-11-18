import assert from 'node:assert/strict'
import test from 'node:test'
import { applyRemoteUpdate, createCollabDoc, encodeSnapshot, encodeUpdate, getText, setText, stateVector } from './collab-doc.ts'

test('a fresh document starts empty and holds whatever is written to it', () => {
  const doc = createCollabDoc()
  assert.equal(getText(doc), '')
  setText(doc, '第一版草稿')
  assert.equal(getText(doc), '第一版草稿')
})

test('two peers converge after exchanging updates, in either order', () => {
  const alice = createCollabDoc()
  setText(alice, '大家好')
  const update = encodeUpdate(alice)

  const bob = createCollabDoc()
  applyRemoteUpdate(bob, update)
  assert.equal(getText(bob), '大家好')

  // The same update applied again (a retried send, a replayed message) changes nothing.
  applyRemoteUpdate(bob, update)
  assert.equal(getText(bob), '大家好')
})

test('concurrent edits on two computers merge without either side overwriting the other', () => {
  const alice = createCollabDoc()
  const bob = createCollabDoc()
  setText(alice, 'hello')
  applyRemoteUpdate(bob, encodeUpdate(alice))
  assert.equal(getText(bob), 'hello')

  // Both edit their own copy before either has seen the other's change.
  alice.text.insert(5, ' alice')
  bob.text.insert(5, ' bob')
  assert.equal(getText(alice), 'hello alice')
  assert.equal(getText(bob), 'hello bob')

  const aliceUpdate = encodeUpdate(alice)
  const bobUpdate = encodeUpdate(bob)
  applyRemoteUpdate(bob, aliceUpdate)
  applyRemoteUpdate(alice, bobUpdate)

  // Neither edit was dropped, and — the actual point of a CRDT — both sides land on the exact
  // same merged text without anyone having to decide whose edit "wins".
  assert.equal(getText(alice), getText(bob))
  assert.ok(getText(alice).includes('alice'))
  assert.ok(getText(alice).includes('bob'))
})

test('a state vector lets a peer send only what changed since, not the whole document', () => {
  const alice = createCollabDoc()
  setText(alice, 'first')
  const bob = createCollabDoc()
  applyRemoteUpdate(bob, encodeUpdate(alice))
  const bobKnows = stateVector(bob)

  alice.text.insert(5, ' second')
  const incremental = encodeUpdate(alice, bobKnows)
  const whole = encodeUpdate(alice)
  assert.ok(incremental.length < whole.length)

  applyRemoteUpdate(bob, incremental)
  assert.equal(getText(bob), 'first second')
})

test('a snapshot restores a document to the same text, including its full edit history for future merges', () => {
  const doc = createCollabDoc()
  setText(doc, '草稿')
  doc.text.insert(2, '（已保存）')
  const snapshot = encodeSnapshot(doc)

  const restored = createCollabDoc(snapshot)
  assert.equal(getText(restored), getText(doc))

  // A peer's update made against the pre-snapshot state still merges cleanly into the restored doc.
  const peer = createCollabDoc()
  setText(peer, '草稿')
  peer.text.insert(2, '（同行编辑）')
  applyRemoteUpdate(restored, encodeUpdate(peer))
  assert.ok(getText(restored).includes('已保存'))
  assert.ok(getText(restored).includes('同行编辑'))
})
