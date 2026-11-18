//! Group task-board methods: posting a claimable work-bot task and claiming it. See
//! `social::tasks` for the storage and the claim rule; this file is just the wire surface.

use super::str_arg;
use crate::hub::Hub;
use crate::social::tasks;
use anyhow::Result;
use serde_json::{Value, json};
use std::ops::ControlFlow;
use std::sync::Arc;

pub(super) async fn call(hub: &Arc<Hub>, method: &str, b: Value) -> Result<ControlFlow<Value, Value>> {
    Ok(ControlFlow::Break(match method {
        "groupTasks" => json!({"items": tasks::tasks(&hub.store, str_arg(&b, "groupId")?)}),
        "groupTaskPost" => {
            let task = tasks::post(
                &hub.store,
                str_arg(&b, "groupId")?,
                str_arg(&b, "title")?,
                b["instructions"].as_str().unwrap_or_default(),
                str_arg(&b, "createdBy")?,
            )?;
            json!({"task": task})
        }
        "groupTaskClaim" => {
            let task = tasks::claim(&hub.store, str_arg(&b, "groupId")?, str_arg(&b, "taskId")?, str_arg(&b, "claimant")?)?;
            json!({"task": task})
        }
        "groupTaskSetClaimedBot" => {
            let task = tasks::set_claimed_bot(&hub.store, str_arg(&b, "groupId")?, str_arg(&b, "taskId")?, str_arg(&b, "botId")?)?;
            json!({"task": task})
        }
        "groupTaskUnclaim" => {
            let task = tasks::unclaim(&hub.store, str_arg(&b, "groupId")?, str_arg(&b, "taskId")?)?;
            json!({"task": task})
        }
        _ => return Ok(ControlFlow::Continue(b)),
    }))
}
