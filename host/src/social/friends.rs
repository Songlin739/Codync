//! Invite codes, friend requests and the accepted friend list (spec: `docs/super-friends.md`
//! once written — for now see the Super design doc's "左侧栏与好友系统" section).
//!
//! An invite code is just this computer's own identity keys (the same Ed25519 sign key and
//! X25519 box key `remote::identity::Identity` already generates for phone pairing), base64url
//! encoded with a version byte. There is no search or directory: the only way to become
//! friends is for one side to hand the other this code (as text or a QR code) and the other
//! side to accept the resulting request.

use crate::remote::crypto::{b64, computer_id, unb64};
use crate::remote::identity::Identity;
use anyhow::{Result, anyhow, bail};
use serde::{Deserialize, Serialize};

const FRIENDS_SLOT: &str = "friends";
const REQUESTS_SLOT: &str = "friend_requests";
const INVITE_VERSION: u8 = 1;

/// An accepted friend: their public keys, enough to open a P2P connection to them later.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Friend {
    /// = `computer_id(sign_pub)`: stable, derived, never chosen by either side.
    pub id: String,
    pub name: String,
    pub sign_pub: String,
    pub box_pub: String,
    pub added_at: i64,
}

/// An incoming request, not yet accepted or declined.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendRequest {
    pub id: String,
    pub name: String,
    pub sign_pub: String,
    pub box_pub: String,
    pub received_at: i64,
}

/// What a parsed invite code says about its holder, before we decide whether to act on it.
pub struct ParsedInvite {
    pub id: String,
    pub sign_pub: [u8; 32],
    pub box_pub: [u8; 32],
}

/// This computer's own invite code: hand it to a friend (as text or inside a QR code) so
/// they can send a request back.
pub fn my_invite_code(identity: &Identity) -> String {
    let mut bytes = Vec::with_capacity(1 + 32 + 32);
    bytes.push(INVITE_VERSION);
    bytes.extend_from_slice(&identity.sign_pub());
    bytes.extend_from_slice(&identity.box_pub());
    b64(&bytes)
}

/// Decodes a code someone else handed us. Never trusts anything about them beyond the two
/// public keys it carries — the name on the resulting request is whatever they typed alongside it.
pub fn parse_invite_code(code: &str) -> Result<ParsedInvite> {
    let bytes = unb64(code.trim()).map_err(|_| anyhow!("邀请码格式不对，请检查有没有复制完整"))?;
    if bytes.len() != 1 + 32 + 32 {
        bail!("邀请码格式不对，请检查有没有复制完整");
    }
    if bytes[0] != INVITE_VERSION {
        bail!("这个邀请码的版本当前客户端不支持，请更新到最新版本再试");
    }
    let sign_pub: [u8; 32] = bytes[1..33].try_into().expect("checked above");
    let box_pub: [u8; 32] = bytes[33..65].try_into().expect("checked above");
    Ok(ParsedInvite { id: computer_id(&sign_pub), sign_pub, box_pub })
}

fn load_list<T: for<'de> Deserialize<'de>>(store: &crate::store::Store, key: &str) -> Vec<T> {
    store.kv_get(key).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save_list<T: Serialize>(store: &crate::store::Store, key: &str, items: &[T]) -> Result<()> {
    store.kv_set(key, &serde_json::to_string(items)?)
}

pub fn friends(store: &crate::store::Store) -> Vec<Friend> {
    load_list(store, FRIENDS_SLOT)
}

pub fn requests(store: &crate::store::Store) -> Vec<FriendRequest> {
    load_list(store, REQUESTS_SLOT)
}

/// Files someone's invite code as an incoming request. Idempotent — pasting the same code
/// twice doesn't duplicate the request — and refuses a code from someone already a friend.
pub fn receive_request(store: &crate::store::Store, code: &str, their_name: &str) -> Result<FriendRequest> {
    let parsed = parse_invite_code(code)?;
    if friends(store).iter().any(|f| f.id == parsed.id) {
        bail!("已经是好友了");
    }
    let mut reqs = requests(store);
    if let Some(existing) = reqs.iter().find(|r| r.id == parsed.id) {
        return Ok(existing.clone());
    }
    let name = their_name.trim();
    let req = FriendRequest {
        id: parsed.id,
        name: if name.is_empty() { "新好友".into() } else { name.into() },
        sign_pub: b64(&parsed.sign_pub),
        box_pub: b64(&parsed.box_pub),
        received_at: crate::store::now_ms(),
    };
    reqs.push(req.clone());
    save_list(store, REQUESTS_SLOT, &reqs)?;
    Ok(req)
}

/// Accepts a pending request: moves it from `requests` into the friend list.
pub fn accept_request(store: &crate::store::Store, id: &str) -> Result<Friend> {
    let mut reqs = requests(store);
    let pos = reqs.iter().position(|r| r.id == id).ok_or_else(|| anyhow!("没有这条好友请求"))?;
    let req = reqs.remove(pos);
    save_list(store, REQUESTS_SLOT, &reqs)?;

    let friend = Friend {
        id: req.id,
        name: req.name,
        sign_pub: req.sign_pub,
        box_pub: req.box_pub,
        added_at: crate::store::now_ms(),
    };
    let mut all = friends(store);
    if !all.iter().any(|f| f.id == friend.id) {
        all.push(friend.clone());
    }
    save_list(store, FRIENDS_SLOT, &all)?;
    Ok(friend)
}

pub fn decline_request(store: &crate::store::Store, id: &str) -> Result<()> {
    let mut reqs = requests(store);
    reqs.retain(|r| r.id != id);
    save_list(store, REQUESTS_SLOT, &reqs)
}

pub fn remove_friend(store: &crate::store::Store, id: &str) -> Result<()> {
    let mut all = friends(store);
    all.retain(|f| f.id != id);
    save_list(store, FRIENDS_SLOT, &all)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> Identity {
        Identity {
            sign: ed25519_dalek::SigningKey::from_bytes(&crate::remote::crypto::random()),
            box_secret: x25519_dalek::StaticSecret::from(crate::remote::crypto::random::<32>()),
        }
    }

    #[test]
    fn invite_code_roundtrips_to_the_same_computer_id() {
        let id = identity();
        let code = my_invite_code(&id);
        let parsed = parse_invite_code(&code).unwrap();
        assert_eq!(parsed.id, id.computer_id());
        assert_eq!(parsed.sign_pub, id.sign_pub());
        assert_eq!(parsed.box_pub, id.box_pub());
    }

    #[test]
    fn garbage_code_is_rejected() {
        assert!(parse_invite_code("not-an-invite-code").is_err());
    }

    #[test]
    fn accept_then_decline_are_mutually_exclusive_and_idempotent() {
        let store = crate::store::Store::open(std::path::Path::new(":memory:")).unwrap();
        let friend_identity = identity();
        let code = my_invite_code(&friend_identity);

        let req = receive_request(&store, &code, "小宋").unwrap();
        assert_eq!(requests(&store).len(), 1);

        // Re-receiving the same code before it's resolved doesn't duplicate it.
        receive_request(&store, &code, "小宋").unwrap();
        assert_eq!(requests(&store).len(), 1);

        let friend = accept_request(&store, &req.id).unwrap();
        assert_eq!(friend.id, req.id);
        assert!(requests(&store).is_empty());
        assert_eq!(friends(&store).len(), 1);

        // Once a friend, their code can no longer be filed as a fresh request.
        assert!(receive_request(&store, &code, "小宋").is_err());

        remove_friend(&store, &friend.id).unwrap();
        assert!(friends(&store).is_empty());
    }
}
