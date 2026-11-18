import type { BotStore } from '../store/bot-store'
import { base64ToBytes, bytesToBase64 } from './base64.ts'
import { applyRemoteUpdate, createCollabDoc, encodeSnapshot, type CollabDoc } from './collab-doc.ts'

/** Loads a group's saved snapshot (host `collabDocLoad`) into a fresh `CollabDoc`, or starts an
 *  empty one if nothing has been saved yet. */
export async function loadCollabDoc(store: BotStore, groupId: string, docId: string): Promise<CollabDoc> {
  const { snapshot } = await (await store.ready()).call<{ snapshot: string | null }>('collabDocLoad', { groupId, docId })
  return createCollabDoc(snapshot ? base64ToBytes(snapshot) : undefined)
}

/** Saves this document's current state (host `collabDocSave`) — call after a local edit, and
 *  after merging in a peer's update, so a restart never loses either. */
export async function saveCollabDoc(store: BotStore, groupId: string, docId: string, doc: CollabDoc): Promise<void> {
  await (await store.ready()).call('collabDocSave', { groupId, docId, snapshot: bytesToBase64(encodeSnapshot(doc)) })
}

/** Merges a peer's update and persists the result in one step — the usual thing to do with
 *  whatever arrives over the group's P2P data channel once that's wired up (see
 *  `collab-doc.ts`'s doc comment). */
export async function receiveCollabUpdate(store: BotStore, groupId: string, docId: string, doc: CollabDoc, update: Uint8Array): Promise<void> {
  applyRemoteUpdate(doc, update)
  await saveCollabDoc(store, groupId, docId, doc)
}
