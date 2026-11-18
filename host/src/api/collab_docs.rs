//! Collaborative-document snapshot methods: load/save the opaque bytes a group's CRDT text
//! document (`collab-doc.ts`) encodes itself. See `social::collab_docs` for the storage; this
//! file is just the wire surface.

use super::str_arg;
use crate::hub::Hub;
use crate::social::collab_docs;
use anyhow::Result;
use serde_json::{Value, json};
use std::ops::ControlFlow;
use std::sync::Arc;

pub(super) async fn call(hub: &Arc<Hub>, method: &str, b: Value) -> Result<ControlFlow<Value, Value>> {
    Ok(ControlFlow::Break(match method {
        "collabDocLoad" => {
            let snapshot = collab_docs::load_snapshot(&hub.store, str_arg(&b, "groupId")?, str_arg(&b, "docId")?);
            json!({"snapshot": snapshot})
        }
        "collabDocSave" => {
            collab_docs::save_snapshot(&hub.store, str_arg(&b, "groupId")?, str_arg(&b, "docId")?, str_arg(&b, "snapshot")?)?;
            json!({})
        }
        _ => return Ok(ControlFlow::Continue(b)),
    }))
}
