//! Friend-to-friend state for Super's 好友协作群 (collaboration groups with real
//! people, not just this account's own bots): invite codes, friend requests and
//! the accepted friend list.
//!
//! Distinct from `remote::identity`'s device pairing, which is this *same*
//! account's own phones and computers. A friend here is a different person's
//! own computer, with its own identity and its own Codync/Super account — there
//! is no shared account between friends. The P2P connection itself (signaling,
//! STUN/TURN) is a separate piece (`signal-relay/`); this module only establishes
//! who's a friend and exchanges the public keys that connection will need.
//!
//! `tasks` is the claimable-work-bot board for a 好友协作群's dynamically-created bots —
//! see that module's own doc comment for how claiming ties into model-quota ownership.
//! `collab_docs` persists the opaque snapshots of a group's CRDT text documents.
//! `profile` is this account's own display name and avatar photo — see its own doc comment
//! for why that's separate from the invite code.

pub mod collab_docs;
pub mod friends;
pub mod profile;
pub mod tasks;
