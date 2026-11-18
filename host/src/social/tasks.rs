//! Claimable work-bot tasks inside a 好友协作群 (a collaboration group that includes real
//! friends, not just this account's own bots — see `social::friends`). JEV (or a human member)
//! posts a task to a group's board instead of creating a work bot directly; any member can
//! claim it, and whoever claims it is whose model quota the resulting bot runs on — see the
//! design doc's "模型与额度归属" section. The six standing roles (JEV plus
//! 流程/效果/复核/文档/习惯观察, built by `createGroupRoster` on the TypeScript side) never go
//! through this ledger; they always run on the group owner's quota.
//!
//! This host only ever tracks the LOCAL side of a claim. A task posted here is visible to
//! other members only once something carries it over the group's P2P connection — the
//! WebRTC data channel built on `signal-relay/` and
//! `apps/desktop/src/renderer/lib/p2p-signal.ts` — and that sync isn't wired up yet, so for
//! now a task posted or claimed on this computer is only visible on this computer.
//! `claimed_by: Some("me")` is the only claim this host can act on by actually instantiating
//! the bot (the TypeScript side does that, via the normal bot-save RPC, once `claim` below
//! succeeds); any other id would mean a friend claimed it on their own side, once that sync
//! exists — recorded for display here, never actionable locally.

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};

const TASKS_SLOT_PREFIX: &str = "group_tasks:";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupTask {
    pub id: String,
    pub group_id: String,
    pub title: String,
    pub instructions: String,
    /// The bot id that posted it (almost always a group's JEV), or "owner" when a human
    /// member posted it directly.
    pub created_by: String,
    pub created_at: i64,
    /// None while open. `Some("me")` once this account claims it; any other value is a
    /// friend's id, recorded for display but not actionable locally (see module doc).
    pub claimed_by: Option<String>,
    /// The bot this host actually instantiated for it, once claimed locally (`claimed_by ==
    /// "me"`). Never set for a task recorded as claimed by someone else.
    pub claimed_bot_id: Option<String>,
}

fn slot(group_id: &str) -> String {
    format!("{TASKS_SLOT_PREFIX}{group_id}")
}

fn load(store: &crate::store::Store, group_id: &str) -> Vec<GroupTask> {
    store.kv_get(&slot(group_id)).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save(store: &crate::store::Store, group_id: &str, items: &[GroupTask]) -> Result<()> {
    store.kv_set(&slot(group_id), &serde_json::to_string(items)?)
}

pub fn tasks(store: &crate::store::Store, group_id: &str) -> Vec<GroupTask> {
    load(store, group_id)
}

/// Posts a new open task to a group's board.
pub fn post(store: &crate::store::Store, group_id: &str, title: &str, instructions: &str, created_by: &str) -> Result<GroupTask> {
    let title = title.trim();
    if title.is_empty() {
        bail!("任务标题不能为空");
    }
    let task = GroupTask {
        id: uuid::Uuid::new_v4().to_string(),
        group_id: group_id.to_string(),
        title: title.to_string(),
        instructions: instructions.trim().to_string(),
        created_by: created_by.to_string(),
        created_at: crate::store::now_ms(),
        claimed_by: None,
        claimed_bot_id: None,
    };
    let mut all = load(store, group_id);
    all.push(task.clone());
    save(store, group_id, &all)?;
    Ok(task)
}

/// Claims an open task for `claimant` ("me" for this account; a friend id once cross-host sync
/// exists). Fails if the task is already claimed — first claim wins, so two members racing to
/// claim the same row never both get it.
pub fn claim(store: &crate::store::Store, group_id: &str, task_id: &str, claimant: &str) -> Result<GroupTask> {
    let mut all = load(store, group_id);
    let task = all.iter_mut().find(|t| t.id == task_id).ok_or_else(|| anyhow::anyhow!("没有这个任务"))?;
    if task.claimed_by.is_some() {
        bail!("这个任务已经被认领了");
    }
    task.claimed_by = Some(claimant.to_string());
    let result = task.clone();
    save(store, group_id, &all)?;
    Ok(result)
}

/// Records which bot this host instantiated for a task it claimed itself — called right after
/// the TypeScript side saves that bot, so later reads of the task can point at it.
pub fn set_claimed_bot(store: &crate::store::Store, group_id: &str, task_id: &str, bot_id: &str) -> Result<GroupTask> {
    let mut all = load(store, group_id);
    let task = all.iter_mut().find(|t| t.id == task_id).ok_or_else(|| anyhow::anyhow!("没有这个任务"))?;
    task.claimed_bot_id = Some(bot_id.to_string());
    let result = task.clone();
    save(store, group_id, &all)?;
    Ok(result)
}

/// Releases a claim back to open — the claimer backed out before a bot was actually
/// instantiated (`claimed_bot_id` is still empty); once a bot exists for it, un-claiming would
/// orphan that bot, so the caller should delete the bot itself first if it wants to undo that.
pub fn unclaim(store: &crate::store::Store, group_id: &str, task_id: &str) -> Result<GroupTask> {
    let mut all = load(store, group_id);
    let task = all.iter_mut().find(|t| t.id == task_id).ok_or_else(|| anyhow::anyhow!("没有这个任务"))?;
    if task.claimed_bot_id.is_some() {
        bail!("这个任务已经在运行了，请先删除对应的 bot 再取消认领");
    }
    task.claimed_by = None;
    let result = task.clone();
    save(store, group_id, &all)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn posting_then_claiming_moves_a_task_from_open_to_claimed() {
        let store = crate::store::Store::open(std::path::Path::new(":memory:")).unwrap();
        let task = post(&store, "g1", "整理本周数据", "把CSV清洗一下", "jev-bot-id").unwrap();
        assert_eq!(tasks(&store, "g1").len(), 1);
        assert!(task.claimed_by.is_none());

        let claimed = claim(&store, "g1", &task.id, "me").unwrap();
        assert_eq!(claimed.claimed_by, Some("me".to_string()));

        let with_bot = set_claimed_bot(&store, "g1", &task.id, "bot-123").unwrap();
        assert_eq!(with_bot.claimed_bot_id, Some("bot-123".to_string()));
    }

    #[test]
    fn a_second_claim_on_an_already_claimed_task_is_rejected() {
        let store = crate::store::Store::open(std::path::Path::new(":memory:")).unwrap();
        let task = post(&store, "g1", "标题", "说明", "jev-bot-id").unwrap();
        claim(&store, "g1", &task.id, "me").unwrap();
        assert!(claim(&store, "g1", &task.id, "a-friend-id").is_err());
    }

    #[test]
    fn unclaiming_before_a_bot_exists_reopens_it_but_not_after() {
        let store = crate::store::Store::open(std::path::Path::new(":memory:")).unwrap();
        let task = post(&store, "g1", "标题", "说明", "jev-bot-id").unwrap();
        claim(&store, "g1", &task.id, "me").unwrap();

        let reopened = unclaim(&store, "g1", &task.id).unwrap();
        assert!(reopened.claimed_by.is_none());

        claim(&store, "g1", &task.id, "me").unwrap();
        set_claimed_bot(&store, "g1", &task.id, "bot-123").unwrap();
        assert!(unclaim(&store, "g1", &task.id).is_err());
    }

    #[test]
    fn an_empty_title_is_rejected() {
        let store = crate::store::Store::open(std::path::Path::new(":memory:")).unwrap();
        assert!(post(&store, "g1", "   ", "说明", "jev-bot-id").is_err());
    }
}
