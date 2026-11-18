import assert from 'node:assert/strict'
import test from 'node:test'
import type { BotStore } from '../store/bot-store'
import { encodeUpdate, getText, setText } from './collab-doc.ts'
import { loadCollabDoc, receiveCollabUpdate, saveCollabDoc } from './collab-doc-store.ts'

function fakeStore(): { store: BotStore; saved: Map<string, string> } {
  const saved = new Map<string, string>()
  const call = async <T>(method: string, args: Record<string, unknown>): Promise<T> => {
    if (method === 'collabDocLoad') {
      return { snapshot: saved.get(`${args.groupId}:${args.docId}`) ?? null } as T
    }
    if (method === 'collabDocSave') {
      saved.set(`${args.groupId}:${args.docId}`, args.snapshot as string)
      return {} as T
    }
    throw new Error(`unexpected call: ${method}`)
  }
  const store = { ready: async () => ({ call }) } as unknown as BotStore
  return { store, saved }
}

test('a document with no saved snapshot loads empty, and a save persists it under the group+doc key', async () => {
  const { store, saved } = fakeStore()
  const doc = await loadCollabDoc(store, 'g1', 'notes')
  assert.equal(getText(doc), '')

  setText(doc, '你好')
  await saveCollabDoc(store, 'g1', 'notes', doc)
  assert.ok(saved.has('g1:notes'))

  const reloaded = await loadCollabDoc(store, 'g1', 'notes')
  assert.equal(getText(reloaded), '你好')
})

test('different groups or docs never collide in storage', async () => {
  const { store } = fakeStore()
  const a = await loadCollabDoc(store, 'g1', 'notes')
  setText(a, 'g1 notes')
  await saveCollabDoc(store, 'g1', 'notes', a)

  const b = await loadCollabDoc(store, 'g2', 'notes')
  assert.equal(getText(b), '')
})

test('receiving a peer update merges it in and persists the merged result', async () => {
  const { store } = fakeStore()
  const mine = await loadCollabDoc(store, 'g1', 'notes')
  setText(mine, 'line one')
  await saveCollabDoc(store, 'g1', 'notes', mine)

  const peerDoc = await loadCollabDoc(store, 'g1', 'notes')
  peerDoc.text.insert(peerDoc.text.length, ' from peer')
  const update = encodeUpdate(peerDoc)

  await receiveCollabUpdate(store, 'g1', 'notes', mine, update)
  assert.equal(getText(mine), 'line one from peer')

  const reloaded = await loadCollabDoc(store, 'g1', 'notes')
  assert.equal(getText(reloaded), 'line one from peer')
})
