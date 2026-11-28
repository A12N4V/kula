//! B6 · T7 Tokens: proof tests for the usage pipeline.
//!
//! The pipeline modules live in the binary crate, so the test compiles the
//! files it needs directly (`#[path]` includes). `crate::config` and
//! `crate::workflow` resolve to the same sources; the one function the test
//! tree lacks is `orch::task::slug`, shimmed to the identical implementation
//! in `workflow.rs`.

#[path = "../src/config.rs"]
pub mod config;
#[path = "../src/usage.rs"]
pub mod usage;
#[path = "../src/workflow.rs"]
pub mod workflow;

/// The pipeline's `Captured` carries the launcher's legacy aggregate. The
/// test tree cannot compile all of launch.rs, so the same struct is
/// reproduced field for field: `usage.rs` only reads and writes these
/// fields, and the binary's own tests cover the real type.
pub mod launch {
    use serde::{Deserialize, Serialize};

    #[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
    pub struct Usage {
        #[serde(default)]
        pub tokens_in: u64,
        #[serde(default)]
        pub tokens_out: u64,
        #[serde(default)]
        pub turns: u64,
        #[serde(default)]
        pub cost_usd: f64,
        #[serde(default)]
        pub duration_ms: u64,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        pub model: String,
    }
}

pub mod orch {
    pub mod task {
        /// Same behaviour as orch::task::slug, which the test tree cannot
        /// include (it pulls in the whole orchestrator).
        pub fn slug(s: &str) -> String {
            let mut out = String::new();
            for w in s.split(|c: char| !c.is_ascii_alphanumeric()).filter(|w| !w.is_empty()) {
                if !out.is_empty() {
                    out.push('-');
                }
                out.push_str(&w.to_ascii_lowercase());
                if out.len() >= 40 {
                    break;
                }
            }
            out
        }
    }
}

use config::PriceTable;
use std::path::Path;
use usage::{Accumulator, UsageRecord};

fn fixture(rel: &str) -> String {
    std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join(rel)).unwrap()
}

/// The price table for the recorded streams: dollars per million tokens.
fn table() -> PriceTable {
    let cfg = toml::from_str::<config::Config>(
        r#"
[[price]]
model = "claude-sonnet-4-5"
date = "2026-11-01"
input = 3.0
output = 15.0
cache_read = 0.3
cache_write = 3.75
[[price]]
model = "gpt-5-codex"
date = "2026-11-01"
input = 1.25
output = 10.0
cache_read = 0.125
cache_write = 0.0
[[price]]
model = "gemini-3-pro"
date = "2026-11-01"
input = 1.25
output = 10.0
cache_read = 0.31
cache_write = 0.0
[[price]]
model = "fake"
date = "2026-11-01"
input = 1.0
output = 2.0
cache_read = 0.1
cache_write = 0.1
"#,
    )
    .unwrap();
    PriceTable::from(&cfg)
}

const DAY: &str = "2026-11-01";

/// Parse a recorded stream into priced records the way capture does.
fn replay(stream: &str, agent: &str, t: &PriceTable) -> (Accumulator, Vec<String>) {
    let mut acc = Accumulator::new("team/one", "replay", 0.0);
    let mut errors = vec![];
    for raw in usage::parse_stream(stream, agent) {
        let cost = match usage::price(t, &raw, DAY) {
            Ok(c) => c,
            Err(e) => {
                errors.push(e.to_string());
                0.0
            }
        };
        acc.add(&UsageRecord {
            seat: "team/one".into(),
            run: "replay".into(),
            slice: "p-1".into(),
            model: raw.model.clone(),
            day: DAY.into(),
            ts: 1_795_747_200_000,
            tokens: raw.tokens,
            cost_usd: cost,
            estimated: raw.estimated,
            agent: agent.into(),
            message_id: raw.message_id,
        });
    }
    (acc, errors)
}

fn total(acc: &Accumulator) -> usage::Tokens {
    let mut t = usage::Tokens::default();
    for b in &acc.buckets {
        t.add(&b.tokens);
    }
    t
}

/// Recorded streams for 3 CLIs replay to exact totals.
#[test]
fn recorded_streams_replay_to_exact_totals() {
    let t = table();

    let (acc, errs) = &replay(&fixture("tests/fixtures/streams/claude/session.jsonl"), "claude", &t);
    assert!(errs.is_empty(), "{errs:?}");
    let tok = total(acc);
    // Three real messages plus a duplicated one: 4 lines, 3 counted.
    assert_eq!(acc.buckets[0].messages, 3, "the duplicated message never counts twice");
    assert_eq!(tok.input, 3000);
    assert_eq!(tok.output, 600);
    assert_eq!(tok.cache_read, 12_000);
    assert_eq!(tok.cache_write, 750);

    let (acc, errs) = &replay(&fixture("tests/fixtures/streams/codex/session.jsonl"), "codex", &t);
    assert!(errs.is_empty(), "{errs:?}");
    let tok = total(acc);
    assert_eq!(acc.buckets[0].messages, 2, "the duplicated turn.completed never counts twice");
    assert_eq!(tok.input, 1100, "codex input excludes cached tokens");
    assert_eq!(tok.cache_read, 1000);
    assert_eq!(tok.output, 400);

    let (acc, errs) = &replay(&fixture("tests/fixtures/streams/gemini/session.json"), "gemini", &t);
    assert!(errs.is_empty(), "{errs:?}");
    let tok = total(acc);
    assert_eq!(acc.buckets[0].messages, 1);
    assert_eq!(tok.input, 2000);
    assert_eq!(tok.output, 400);
    assert_eq!(tok.cache_read, 600);
}

/// Totals match the kula-refs/ccusage formula on the same transcripts:
/// input×rate + output×rate + cache_create×rate + cache_read×rate, rates in
/// dollars per million tokens.
#[test]
fn totals_match_ccusage_logic_on_the_same_transcripts() {
    let t = table();
    for (stream, agent) in [
        ("tests/fixtures/streams/claude/session.jsonl", "claude"),
        ("tests/fixtures/streams/codex/session.jsonl", "codex"),
        ("tests/fixtures/streams/gemini/session.json", "gemini"),
    ] {
        let (acc, _) = replay(&fixture(stream), agent, &t);
        let row = t.price(&acc.buckets[0].model, DAY).unwrap();
        let tok = total(&acc);
        let m = 1_000_000.0;
        let ccusage = tok.input as f64 / m * row.input
            + tok.output as f64 / m * row.output
            + tok.cache_write as f64 / m * row.cache_write
            + tok.cache_read as f64 / m * row.cache_read;
        let ours: f64 = acc.buckets.iter().map(|b| b.cost_usd).sum();
        assert!((ours - ccusage).abs() < 1e-9, "{agent}: {ours} vs ccusage {ccusage}");
    }
}

/// A duplicated message never counts twice, whatever the arrival order.
#[test]
fn duplicated_message_never_counts_twice() {
    let _t = table();
    let mk = |id: &str, input: u64| UsageRecord {
        seat: "team/one".into(),
        run: "d".into(),
        slice: "p-1".into(),
        model: "fake".into(),
        day: DAY.into(),
        ts: 1_000,
        tokens: usage::Tokens { input, ..Default::default() },
        cost_usd: 0.0,
        estimated: String::new(),
        agent: "fake".into(),
        message_id: id.into(),
    };
    let mut a = Accumulator::new("team/one", "d", 0.0);
    assert!(a.add(&mk("dup-1", 10)));
    assert!(!a.add(&mk("dup-1", 10)), "same id twice: counted once");
    // The reverse order – duplicate first – counts the same single message.
    let mut b = Accumulator::new("team/one", "d", 0.0);
    assert!(b.add(&mk("dup-1", 10)));
    assert!(b.add(&mk("dup-2", 20)), "a different id is a different message");
    assert_eq!(a.buckets[0].tokens.input, 10);
    assert_eq!(b.buckets[0].tokens.input, 30);
}

/// A fake agent over budget is stopped within one turn: the shipped capture
/// path does the reading – spawn → parse → dedupe → price → budget check →
/// SIGINT, then SIGTERM 5 s later if it lived. The fake agent is the
/// stand-in, never a real model call.
#[test]
fn fake_agent_over_budget_is_stopped_within_one_turn() {
    use std::process::Command;

    let dir = std::env::temp_dir().join(format!("b6-over-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-agent.sh");
    let mut cmd = {
        let mut c = Command::new("sh");
        c.arg(&script)
            .env("FAKE_USAGE", "1")
            .env("FAKE_MODE", "clean")
            .env("KULA_SLICE", "p-1")
            .env("KULA_ATTEMPT", "1")
            .env("KULA_SCOPE", "src:src");
        c
    };
    let mut warned = 0;
    // Budget so small the first kula_usage line (1200 in x $1/M = $0.0012)
    // is already past the line: the seat must be stopped in this turn.
    let cap = usage::capture_stream(&mut cmd, "team/one", "over", "p-1", "fake", &table(), 0.001, &dir, |st, _, _| {
        if st == usage::BudgetState::Warn {
            warned += 1;
        }
    })
    .expect("capture_stream runs the fake agent");

    assert!(cap.stopped, "the seat was stopped within the turn: the budget stop fired");
    assert_eq!(cap.code, 130, "a budget stop reports SIGINT's exit code");
    assert!(warned <= 1, "at most one 80% warning is emitted per accumulator, saw {warned}");
    assert!(cap.acc.metrics().tokens.input > 0, "the message that crossed the line still counts");
    assert!(usage::ledger_path(&dir, "over").exists(), "the ledger was written before the stop");
    let _ = std::fs::remove_dir_all(&dir);
}
