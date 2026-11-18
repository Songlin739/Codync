//! Friend methods: invite codes, incoming requests, the friend list. See `social::friends`
//! for the storage and crypto; this file is just the wire surface.

use super::str_arg;
use crate::hub::Hub;
use crate::social::friends;
use anyhow::Result;
use serde_json::{Value, json};
use std::ops::ControlFlow;
use std::sync::Arc;

pub(super) async fn call(hub: &Arc<Hub>, method: &str, b: Value) -> Result<ControlFlow<Value, Value>> {
    Ok(ControlFlow::Break(match method {
        "myInviteCode" => json!({"code": friends::my_invite_code(&hub.identity)}),
        "friends" => json!({"items": friends::friends(&hub.store)}),
        "friendRequests" => json!({"items": friends::requests(&hub.store)}),
        "friendRequestReceive" => {
            let req = friends::receive_request(&hub.store, str_arg(&b, "code")?, b["name"].as_str().unwrap_or_default())?;
            json!({"request": req})
        }
        "friendAccept" => json!({"friend": friends::accept_request(&hub.store, str_arg(&b, "id")?)?}),
        "friendDecline" => {
            friends::decline_request(&hub.store, str_arg(&b, "id")?)?;
            json!({})
        }
        "friendRemove" => {
            friends::remove_friend(&hub.store, str_arg(&b, "id")?)?;
            json!({})
        }
        _ => return Ok(ControlFlow::Continue(b)),
    }))
}
