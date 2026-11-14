//! The team's event log (P3.17): an append only `.kula/events.jsonl` that
//! team starts and stops, guard refusals, slice hand-offs and gate verdicts
//! write to, and that `GET /api/agents/events` streams and replays.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Lines kept before the log is cut back to its newer half.
const KEEP: usize = 4000;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Event {
    /// Position in the log, set on read (1 based line number).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub seq: u64,
    /// Unix milliseconds.
    pub ts: u64,
    /// team_start | team_stop | refused | handoff | slice | verdict
    pub kind: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub team: String,
    /// The agent the event is about (the receiver of a hand-off).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub agent: String,
    /// The agent a hand-off comes from.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub from: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub plan: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub slice: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub path: String,
    /// passed | failed | rejected | refused, or a slice state.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub verdict: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub msg: String,
}

fn is_zero(n: &u64) -> bool {
    *n == 0
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn log_path(kula_dir: &Path) -> PathBuf {
    kula_dir.join("events.jsonl")
}

/// Append one event. Never fails the caller: the log is a view, not a record anything depends on.
pub fn append(kula_dir: &Path, mut e: Event) {
    if e.ts == 0 {
        e.ts = now_ms();
    }
    e.seq = 0;
    let Ok(line) = serde_json::to_string(&e) else { return };
    let _ = std::fs::create_dir_all(kula_dir);
    let p = log_path(kula_dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
        let _ = writeln!(f, "{line}");
    }
    trim(&p);
}

fn trim(p: &Path) {
    let Ok(meta) = std::fs::metadata(p) else { return };
    if meta.len() < 1_500_000 {
        return;
    }
    if let Ok(s) = std::fs::read_to_string(p) {
        let lines: Vec<&str> = s.lines().collect();
        if lines.len() > KEEP {
            let keep = lines[lines.len() - KEEP / 2..].join("\n") + "\n";
            let _ = std::fs::write(p, keep);
        }
    }
}

/// Events after `since` (a seq), oldest first, at most `limit` of the newest.
pub fn read(kula_dir: &Path, since: u64, limit: usize) -> Vec<Event> {
    let Ok(s) = std::fs::read_to_string(log_path(kula_dir)) else { return vec![] };
    let mut out: Vec<Event> = s
        .lines()
        .enumerate()
        .filter(|(i, _)| (*i as u64 + 1) > since)
        .filter_map(|(i, l)| {
            let mut e: Event = serde_json::from_str(l).ok()?;
            e.seq = i as u64 + 1;
            Some(e)
        })
        .collect();
    if out.len() > limit {
        out.drain(..out.len() - limit);
    }
    out
}

/// The repository path a guard refusal names, if any.
pub fn refused_path(msg: &str) -> String {
    let rest = msg.strip_prefix("kula guard: ").unwrap_or("");
    match rest.split_once(" is ") {
        Some((p, _)) if !p.contains(' ') => p.to_string(),
        _ => String::new(),
    }
}

/// What changed between two saves of a run: slice moves, hand-offs from the
/// slices it waited on, and gate verdicts.
pub fn plan_diff(old: Option<&crate::orch::task::Plan>, new: &crate::orch::task::Plan) -> Vec<Event> {
    use crate::orch::task::SliceState;
    let mut out = vec![];
    for s in &new.slices {
        let was = old.and_then(|o| o.slice(&s.id)).map(|o| o.state);
        if was == Some(s.state) || (was.is_none() && s.state == SliceState::Queued) {
            continue;
        }
        let st = serde_json::to_value(s.state).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default();
        let base = Event { kind: "slice".into(), agent: s.agent.clone(), plan: new.id.clone(), slice: s.id.clone(), verdict: st.clone(), ..Default::default() };
        if s.state == SliceState::Running {
            for d in &s.deps {
                if let Some(dep) = new.slice(d) {
                    out.push(Event { kind: "handoff".into(), from: dep.agent.clone(), msg: format!("{} after {}", s.id, dep.id), ..base.clone() });
                }
            }
        }
        if s.state.done() {
            out.push(Event { kind: "verdict".into(), msg: s.reasons.first().cloned().unwrap_or_default(), ..base });
        } else {
            out.push(base);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orch::task::{Plan, Slice, SliceState};

    #[test]
    fn append_and_replay() {
        let d = std::env::temp_dir().join(format!("kula-events-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        append(&d, Event { kind: "team_start".into(), team: "ship".into(), ..Default::default() });
        append(&d, Event { kind: "refused".into(), agent: "codex".into(), path: "src/a.rs".into(), ..Default::default() });
        let all = read(&d, 0, 100);
        assert_eq!(all.len(), 2);
        assert_eq!(all[1].seq, 2);
        assert_eq!(read(&d, 1, 100), vec![all[1].clone()]);
        assert_eq!(read(&d, 0, 1).len(), 1);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn refusal_names_its_path() {
        assert_eq!(refused_path("kula guard: src/a.rs is locked for agents – x (y)."), "src/a.rs");
        assert_eq!(refused_path("kula guard: refused – eval."), "");
    }

    #[test]
    fn plan_diff_sees_handoffs_and_verdicts() {
        let s = |id: &str, agent: &str, deps: &[&str], st| Slice { id: id.into(), agent: agent.into(), deps: deps.iter().map(|x| x.to_string()).collect(), state: st, ..Default::default() };
        let old = Plan { id: "p".into(), slices: vec![s("a", "claude", &[], SliceState::Gating), s("b", "codex", &["a"], SliceState::Queued)], ..Default::default() };
        let new = Plan { id: "p".into(), slices: vec![s("a", "claude", &[], SliceState::Passed), s("b", "codex", &["a"], SliceState::Running)], ..Default::default() };
        let ev = plan_diff(Some(&old), &new);
        assert!(ev.iter().any(|e| e.kind == "verdict" && e.slice == "a" && e.verdict == "passed"));
        assert!(ev.iter().any(|e| e.kind == "handoff" && e.from == "claude" && e.agent == "codex"));
        assert!(plan_diff(Some(&new), &new).is_empty());
    }
}
