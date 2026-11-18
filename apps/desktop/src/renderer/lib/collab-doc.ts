import * as Y from 'yjs'

/** 协作文件存储 (design doc "多人协作架构"): a group's shared *text* documents use a CRDT
 *  (Yjs) so two friends' own computers can each edit offline and merge without a server ever
 *  resolving the conflict — a binary file (an image, a .docx, …) still just gets broadcast and
 *  pulled whole, the way a group's files already work; CRDT merging only makes sense for text.
 *
 *  This module only owns the *document*: creating one, applying a local edit, and merging in an
 *  update that arrived from a peer. Carrying those update bytes to and from a friend's computer
 *  is the group's P2P data channel (built on `signal-relay/` and `p2p-signal.ts`), which isn't
 *  wired up yet — see those files' own doc comments. Until it is, a `CollabDoc` only ever sees
 *  its own local edits. */
export interface CollabDoc {
  ydoc: Y.Doc
  text: Y.Text
}

/** A fresh document, or one restored from a snapshot this computer saved earlier
 *  (`encodeSnapshot`/host storage) — pass that snapshot's bytes as `fromSnapshot`. */
export function createCollabDoc(fromSnapshot?: Uint8Array): CollabDoc {
  const ydoc = new Y.Doc()
  if (fromSnapshot) Y.applyUpdate(ydoc, fromSnapshot)
  return { ydoc, text: ydoc.getText('content') }
}

export function getText(doc: CollabDoc): string {
  return doc.text.toString()
}

/** Replaces the whole document's text with a single local edit — the simplest way to apply a
 *  user's typing; a caller that wants finer-grained Yjs ops (insert/delete at a position) can
 *  use `doc.text` directly instead. */
export function setText(doc: CollabDoc, text: string): void {
  doc.ydoc.transact(() => {
    doc.text.delete(0, doc.text.length)
    doc.text.insert(0, text)
  })
}

/** The bytes to hand to every other peer after a local change — call this inside (or right
 *  after) whatever made the edit, with `sinceState` the vector you last sent them (omit it the
 *  first time, or to send the whole document). */
export function encodeUpdate(doc: CollabDoc, sinceState?: Uint8Array): Uint8Array {
  return sinceState ? Y.encodeStateAsUpdate(doc.ydoc, sinceState) : Y.encodeStateAsUpdate(doc.ydoc)
}

/** Merges an update that arrived from a peer — safe to call with updates in any order, including
 *  ones this document has already seen (Yjs updates are idempotent) or that both sides made
 *  concurrently; that's the whole point of a CRDT. */
export function applyRemoteUpdate(doc: CollabDoc, update: Uint8Array): void {
  Y.applyUpdate(doc.ydoc, update)
}

/** This document's current state vector — hand it back to a peer so their next `encodeUpdate`
 *  sends only what's changed since, rather than the whole document. */
export function stateVector(doc: CollabDoc): Uint8Array {
  return Y.encodeStateVector(doc.ydoc)
}

/** A full snapshot to persist (the host stores it as an opaque blob next to the group's other
 *  files) so a restart doesn't lose anything this computer wrote before any peer ever saw it. */
export function encodeSnapshot(doc: CollabDoc): Uint8Array {
  return Y.encodeStateAsUpdate(doc.ydoc)
}
