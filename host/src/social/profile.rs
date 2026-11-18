//! This account's own display identity — a name and an avatar image — for the 好友协作群
//! feature (`social::friends`). Separate from a bot's `avatarColor`/`avatarShape` dot-grid face:
//! a friend is a real person, and real people upload a photo rather than pick a procedural
//! shape.
//!
//! This is purely local storage. The invite code (`friends::my_invite_code`) stays just the two
//! public keys — an avatar photo is too large to fit in a code meant to be pasted as text or
//! shown as a QR code — so a friend doesn't see this profile automatically on adding you; that
//! needs the group's own P2P data channel (not wired up yet, same gap `social::tasks` and
//! `social::collab_docs` already document) to actually carry it across. Until then, this is
//! what the account shows of itself, on this computer, to itself.

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};

const PROFILE_SLOT: &str = "my_profile";

/// A data URL is `data:<mime>;base64,<payload>` — three copies of the base64 overhead alone
/// pushes a modest photo well past this, so this is about "did the renderer actually resize it
/// first" rather than a real ceiling on image size.
const MAX_AVATAR_LEN: usize = 900_000;

#[derive(Clone, Serialize, Deserialize, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MyProfile {
    pub name: Option<String>,
    /// A `data:image/...;base64,...` URL, already resized by the renderer (see
    /// `renderer/lib/image-resize.ts`) — this module stores whatever string comes in, as long as
    /// it looks like an image data URL and isn't absurdly large; it never decodes the image.
    pub avatar: Option<String>,
}

pub fn load(store: &crate::store::Store) -> MyProfile {
    store.kv_get(PROFILE_SLOT).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// `name`: trimmed; an empty or all-whitespace name is stored as `None`, not `Some("")`.
/// `avatar`: `None` clears it; `Some(data_url)` must actually look like an image data URL and
/// fit under the size cap, or this bails rather than saving something a friend's app, or this
/// one on restart, might fail to render.
pub fn save(store: &crate::store::Store, name: Option<&str>, avatar: Option<&str>) -> Result<MyProfile> {
    if let Some(a) = avatar {
        if !a.starts_with("data:image/") {
            bail!("头像必须是图片");
        }
        if a.len() > MAX_AVATAR_LEN {
            bail!("头像文件太大，请换一张小一点的图片");
        }
    }
    let profile = MyProfile {
        name: name.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string),
        avatar: avatar.map(str::to_string),
    };
    store.kv_set(PROFILE_SLOT, &serde_json::to_string(&profile)?)?;
    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn with_nothing_saved_yet_the_profile_is_empty() {
        let store = crate::store::Store::open(Path::new(":memory:")).unwrap();
        assert_eq!(load(&store), MyProfile::default());
    }

    #[test]
    fn saving_then_loading_round_trips_name_and_avatar() {
        let store = crate::store::Store::open(Path::new(":memory:")).unwrap();
        let saved = save(&store, Some("Songlin"), Some("data:image/png;base64,AAEC")).unwrap();
        assert_eq!(saved.name, Some("Songlin".to_string()));
        assert_eq!(saved.avatar, Some("data:image/png;base64,AAEC".to_string()));
        assert_eq!(load(&store), saved);
    }

    #[test]
    fn a_blank_name_is_stored_as_none_not_an_empty_string() {
        let store = crate::store::Store::open(Path::new(":memory:")).unwrap();
        let saved = save(&store, Some("   "), None).unwrap();
        assert_eq!(saved.name, None);
    }

    #[test]
    fn a_later_save_with_no_avatar_clears_a_previously_saved_one() {
        let store = crate::store::Store::open(Path::new(":memory:")).unwrap();
        save(&store, Some("Songlin"), Some("data:image/png;base64,AAEC")).unwrap();
        let saved = save(&store, Some("Songlin"), None).unwrap();
        assert_eq!(saved.avatar, None);
        assert_eq!(load(&store).avatar, None);
    }

    #[test]
    fn something_that_is_not_an_image_data_url_is_rejected() {
        let store = crate::store::Store::open(Path::new(":memory:")).unwrap();
        assert!(save(&store, None, Some("not-a-data-url")).is_err());
        assert!(save(&store, None, Some("data:text/plain;base64,AAEC")).is_err());
        assert_eq!(load(&store), MyProfile::default()); // the rejected save changed nothing
    }

    #[test]
    fn an_oversized_avatar_is_rejected() {
        let store = crate::store::Store::open(Path::new(":memory:")).unwrap();
        let huge = format!("data:image/png;base64,{}", "A".repeat(MAX_AVATAR_LEN));
        assert!(save(&store, None, Some(&huge)).is_err());
    }
}
