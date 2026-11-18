//! This account's own name/avatar (`social::profile`) — see that module for storage and why
//! it's local-only for now. This file is just the wire surface.

use crate::hub::Hub;
use crate::social::profile;
use anyhow::Result;
use serde_json::{Value, json};
use std::ops::ControlFlow;
use std::sync::Arc;

pub(super) async fn call(hub: &Arc<Hub>, method: &str, b: Value) -> Result<ControlFlow<Value, Value>> {
    Ok(ControlFlow::Break(match method {
        "myProfile" => json!({"profile": profile::load(&hub.store)}),
        "myProfileSet" => {
            let current = profile::load(&hub.store);
            let name = resolved(&b, "name", &current.name);
            let avatar = resolved(&b, "avatar", &current.avatar);
            let saved = profile::save(&hub.store, name, avatar)?;
            json!({"profile": saved})
        }
        _ => return Ok(ControlFlow::Continue(b)),
    }))
}

/// What to pass to `profile::save` for one field: the body's own value if the caller included
/// the key at all (`null` clears it, a string sets it), otherwise the field's current value —
/// the caller didn't mention it, so an update to the other field doesn't silently wipe it.
fn resolved<'a>(b: &'a Value, key: &str, current: &'a Option<String>) -> Option<&'a str> {
    if b.get(key).is_some() { b[key].as_str() } else { current.as_deref() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_key_left_out_of_the_body_falls_back_to_the_current_value() {
        let current = Some("old-name".to_string());
        assert_eq!(resolved(&json!({}), "name", &current), Some("old-name"));
    }

    #[test]
    fn a_key_sent_as_null_clears_it_regardless_of_the_current_value() {
        let current = Some("old-name".to_string());
        assert_eq!(resolved(&json!({"name": null}), "name", &current), None);
    }

    #[test]
    fn a_key_sent_as_a_string_overrides_the_current_value() {
        let current = Some("old-name".to_string());
        assert_eq!(resolved(&json!({"name": "new-name"}), "name", &current), Some("new-name"));
    }

    #[test]
    fn with_nothing_saved_yet_and_the_key_left_out_it_resolves_to_none() {
        assert_eq!(resolved(&json!({}), "avatar", &None), None);
    }
}
