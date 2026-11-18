//! Lightweight per-bot usage stats for the Dashboard: cumulative tokens and average turn latency.
//!
//! This is a coarse monitoring aid, not a billing figure. Only `inputTokens` (plus the prompt
//! cache's read/write tokens) are counted, because that's what an ACP turn's `usage` object
//! reliably carries across the agents Codync runs (see `agent::bot::compaction::after_turn`) —
//! most backends don't report an output-token count over ACP, so this never invents one. Latency
//! is wall-clock time from the turn's `started_at` (`hub::Runtime`) to when the host records the
//! finished turn, so it includes the agent's own thinking time, not just model latency.

use crate::store::{Store, now_ms};
use serde::{Deserialize, Serialize};

fn key(bot: &str) -> String {
    format!("stats.usage.{bot}")
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BotStats {
    pub turns: u64,
    pub input_tokens: u64,
    pub cached_read_tokens: u64,
    pub cached_write_tokens: u64,
    /// Summed turn latency in ms; divide by `turns` for the average (see `avg_latency_ms`).
    pub total_latency_ms: u64,
}

impl BotStats {
    /// For the Dashboard to show directly if it ever reads this from Rust instead of the wire JSON (today's
    /// `botStats` RPC sends `totalLatencyMs`/`turns` raw and divides client-side).
    #[allow(dead_code, reason = "kept for Rust-side callers and tests; the wire API divides client-side")]
    pub fn avg_latency_ms(&self) -> u64 {
        self.total_latency_ms.checked_div(self.turns).unwrap_or(0)
    }
}

/// The bot's stats so far; the zero value for one that hasn't finished a turn yet.
pub fn read(store: &Store, bot: &str) -> BotStats {
    store.kv_get(&key(bot)).and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default()
}

/// Adds one turn's tokens and latency to the bot's running total.
pub fn record(store: &Store, bot: &str, input_tokens: u64, cached_read_tokens: u64, cached_write_tokens: u64, latency_ms: u64) {
    let mut s = read(store, bot);
    s.turns += 1;
    s.input_tokens += input_tokens;
    s.cached_read_tokens += cached_read_tokens;
    s.cached_write_tokens += cached_write_tokens;
    s.total_latency_ms += latency_ms;
    if let Err(error) = store.kv_set(&key(bot), &serde_json::to_string(&s).unwrap_or_default()) {
        tracing::warn!(bot = %bot, error = format!("{error:#}"), "couldn't record usage stats");
    }
}

/// `started` (a turn's `started_at`, ms) to now, in ms; 0 if there's nothing to measure from.
pub fn latency_since(started: Option<i64>) -> u64 {
    started.map(|t| now_ms().saturating_sub(t)).and_then(|d| u64::try_from(d).ok()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_accumulate_and_average() {
        let path = std::env::temp_dir().join(format!("codync-stats-{}.db", uuid::Uuid::new_v4()));
        let store = Store::open(&path).unwrap();
        assert_eq!(read(&store, "b").turns, 0);
        record(&store, "b", 100, 10, 5, 1000);
        record(&store, "b", 200, 0, 0, 3000);
        let s = read(&store, "b");
        assert_eq!(s.turns, 2);
        assert_eq!(s.input_tokens, 300);
        assert_eq!(s.cached_read_tokens, 10);
        assert_eq!(s.cached_write_tokens, 5);
        assert_eq!(s.avg_latency_ms(), 2000);
    }
}
