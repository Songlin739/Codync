//! Persisted snapshots of a group's CRDT text documents (协作文件存储: see
//! `apps/desktop/src/renderer/lib/collab-doc.ts`). The host only stores and returns the opaque,
//! base64-encoded bytes a Yjs document encodes itself — it has no idea what's inside a snapshot
//! and never merges anything; that's the renderer's job, the same way it already owns every
//! other bit of chat and bot state. A binary file (an image, a `.docx`) doesn't go through this
//! at all — it's still broadcast and pulled whole, the way a group's files already work.

const SLOT_PREFIX: &str = "collab_doc:";

fn slot(group_id: &str, doc_id: &str) -> String {
    format!("{SLOT_PREFIX}{group_id}:{doc_id}")
}

/// The last snapshot saved for this document, or `None` if nothing has been saved yet (a brand
/// new document, or one only a friend has written to so far — see the module doc on sync).
pub fn load_snapshot(store: &crate::store::Store, group_id: &str, doc_id: &str) -> Option<String> {
    store.kv_get(&slot(group_id, doc_id))
}

/// Overwrites the saved snapshot. `snapshot_b64` is whatever `Y.encodeStateAsUpdate` produced,
/// base64-encoded by the caller — opaque to this host either way.
pub fn save_snapshot(store: &crate::store::Store, group_id: &str, doc_id: &str, snapshot_b64: &str) -> anyhow::Result<()> {
    store.kv_set(&slot(group_id, doc_id), snapshot_b64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_document_with_no_saved_snapshot_loads_as_none() {
        let store = crate::store::Store::open(std::path::Path::new(":memory:")).unwrap();
        assert!(load_snapshot(&store, "g1", "notes").is_none());
    }

    #[test]
    fn saving_then_loading_round_trips_the_snapshot_and_a_later_save_overwrites_it() {
        let store = crate::store::Store::open(std::path::Path::new(":memory:")).unwrap();
        save_snapshot(&store, "g1", "notes", "AAEC").unwrap();
        assert_eq!(load_snapshot(&store, "g1", "notes"), Some("AAEC".to_string()));

        save_snapshot(&store, "g1", "notes", "AwQF").unwrap();
        assert_eq!(load_snapshot(&store, "g1", "notes"), Some("AwQF".to_string()));
    }

    #[test]
    fn different_groups_or_docs_never_share_a_slot() {
        let store = crate::store::Store::open(std::path::Path::new(":memory:")).unwrap();
        save_snapshot(&store, "g1", "notes", "aaa").unwrap();
        save_snapshot(&store, "g2", "notes", "bbb").unwrap();
        save_snapshot(&store, "g1", "other-doc", "ccc").unwrap();
        assert_eq!(load_snapshot(&store, "g1", "notes"), Some("aaa".to_string()));
        assert_eq!(load_snapshot(&store, "g2", "notes"), Some("bbb".to_string()));
        assert_eq!(load_snapshot(&store, "g1", "other-doc"), Some("ccc".to_string()));
    }
}
