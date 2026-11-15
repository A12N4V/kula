//! The run ledger (H.5): what each seat of a run cost and how it did.
//!
//! kula starts agents with machine readable output (`claude -p --output-format
//! json`, `codex exec --json`, `gemini -o json`) and reads their usage from it:
//! tokens in and out, cost, turns and time. Any other harness can print one
//! `{"kula_usage": {...}}` line. When a run ends, one file per run goes to
//! `.kula/runs/<run>.json` and a copy to `refs/kula/meta`, with a score per
//! seat and per run whose weights travel with it.

use crate::git::Repo;
use crate::orch::task::{Plan, Slice, SliceState};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Runs kept in `refs/kula/meta`; the files in `.kula/runs/` are not cut back.
pub const KEEP_IN_META: usize = 200;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Usage {
    #[serde(default)]
    pub tokens_in: u64,
    #[serde(default)]
    pub tokens_out: u64,
    /// US dollars, as the agent reported it; 0 when it did not.
    #[serde(default)]
    pub cost_usd: f64,
    #[serde(default)]
    pub turns: u32,
    /// The agent's own wall time, when it reports one.
    #[serde(default)]
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub model: String,
}

impl Usage {
    pub fn add(&mut self, o: &Usage) {
        self.tokens_in += o.tokens_in;
        self.tokens_out += o.tokens_out;
        self.cost_usd += o.cost_usd;
        self.turns += o.turns;
        self.duration_ms += o.duration_ms;
        if self.model.is_empty() {
            self.model = o.model.clone();
        }
    }
    pub fn is_empty(&self) -> bool {
        self.tokens_in == 0 && self.tokens_out == 0 && self.cost_usd == 0.0 && self.turns == 0
    }
}

fn u(v: &serde_json::Value, k: &str) -> u64 {
    v.get(k).and_then(|x| x.as_u64()).unwrap_or(0)
}

/// Usage from one JSON value in any of the shapes kula knows; `None` when it is none of them.
fn from_value(v: &serde_json::Value, turns_seen: &mut u32) -> Option<Usage> {
    // Any harness: {"kula_usage": {tokens_in, tokens_out, cost_usd, turns, model}}
    if let Some(k) = v.get("kula_usage") {
        return serde_json::from_value(k.clone()).ok();
    }
    // Claude Code: the final {"type":"result", usage, total_cost_usd, num_turns, duration_ms}
    if v.get("type").and_then(|t| t.as_str()) == Some("result") && v.get("usage").is_some() {
        let us = &v["usage"];
        let model = v.get("modelUsage").and_then(|m| m.as_object()).and_then(|m| m.keys().next().cloned()).unwrap_or_default();
        return Some(Usage {
            tokens_in: u(us, "input_tokens") + u(us, "cache_read_input_tokens") + u(us, "cache_creation_input_tokens"),
            tokens_out: u(us, "output_tokens"),
            cost_usd: v.get("total_cost_usd").and_then(|x| x.as_f64()).unwrap_or(0.0),
            turns: u(v, "num_turns") as u32,
            duration_ms: u(v, "duration_ms"),
            model,
        });
    }
    // Codex: one {"type":"turn.completed","usage":{...}} per turn.
    if v.get("type").and_then(|t| t.as_str()) == Some("turn.completed") {
        let us = &v["usage"];
        *turns_seen += 1;
        return Some(Usage { tokens_in: u(us, "input_tokens"), tokens_out: u(us, "output_tokens"), turns: 1, ..Default::default() });
    }
    // Gemini CLI: {"response", "stats": {"models": {"<model>": {"api": {...}, "tokens": {...}}}}}
    if let Some(models) = v.get("stats").and_then(|s| s.get("models")).and_then(|m| m.as_object()) {
        let mut out = Usage::default();
        for (name, m) in models {
            let t = &m["tokens"];
            out.tokens_in += u(t, "prompt");
            out.tokens_out += u(t, "candidates");
            out.turns += u(&m["api"], "totalRequests") as u32;
            if out.model.is_empty() {
                out.model = name.clone();
            }
        }
        return Some(out);
    }
    None
}

/// Every usage report in an agent's output, summed. Reads JSON lines, and the
/// whole output as one document for agents that pretty print it.
pub fn parse(output: &str) -> Option<Usage> {
    let mut total = Usage::default();
    let mut found = false;
    let mut turns = 0;
    let t = output.trim();
    if let Some(v) = (t.starts_with('{')).then(|| serde_json::from_str::<serde_json::Value>(t).ok()).flatten() {
        if let Some(x) = from_value(&v, &mut turns) {
            return Some(x);
        }
    }
    for line in output.lines().map(str::trim).filter(|l| l.starts_with('{')) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(x) = from_value(&v, &mut turns) {
                total.add(&x);
                found = true;
            }
        }
    }
    // A pretty printed object between other lines: from the first `{` line to the last `}` line.
    if !found {
        let lines: Vec<&str> = output.lines().collect();
        if let (Some(a), Some(b)) = (lines.iter().position(|l| l.starts_with('{')), lines.iter().rposition(|l| l.starts_with('}'))) {
            if a < b {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&lines[a..=b].join("\n")) {
                    return from_value(&v, &mut turns);
                }
            }
        }
    }
    found.then_some(total)
}

/// The seat a slice runs as, from `kula.toml`: `team/key`.
pub fn seat_of<'a>(cfg: &'a crate::config::Config, seat: &str) -> Option<&'a crate::config::Member> {
    let (team, key) = seat.split_once('/')?;
    cfg.teams.iter().find(|t| t.name == team)?.members.iter().find(|m| m.key() == key)
}

/// Extra arguments and a prompt preamble that give a seat its own MCP
/// servers, skills and memory. MCP configs are written under `dir` (the
/// slice's log folder), never into the worktree.
pub fn seat_setup(root: &Path, agent: &str, m: &crate::config::Member, dir: &Path) -> (Vec<String>, String) {
    let mut args = vec![];
    let mut pre = String::new();
    if !m.mcp.is_empty() {
        let src = crate::agent_config::read_mcp(root, crate::agent_config::MCP_SOURCE).ok().flatten().unwrap_or_default();
        let mine: BTreeMap<&String, &crate::agent_config::McpDef> = src.iter().filter(|(k, _)| m.mcp.contains(k)).collect();
        match agent {
            "claude" => {
                let servers: serde_json::Map<String, serde_json::Value> = mine
                    .iter()
                    .map(|(k, d)| {
                        let v = if d.url.is_empty() {
                            serde_json::json!({ "command": d.command, "args": d.args })
                        } else {
                            serde_json::json!({ "type": "http", "url": d.url })
                        };
                        (k.to_string(), v)
                    })
                    .collect();
                let f = dir.join("mcp.json");
                if std::fs::create_dir_all(dir).is_ok() && std::fs::write(&f, serde_json::json!({ "mcpServers": servers }).to_string()).is_ok() {
                    args.extend(["--mcp-config".to_string(), f.to_string_lossy().into_owned(), "--strict-mcp-config".into()]);
                }
            }
            "codex" => {
                for (k, d) in &mine {
                    if d.url.is_empty() {
                        let a: Vec<String> = d.args.iter().map(|x| format!("{x:?}")).collect();
                        args.extend(["-c".into(), format!("mcp_servers.{k}.command={:?}", d.command)]);
                        args.extend(["-c".into(), format!("mcp_servers.{k}.args=[{}]", a.join(","))]);
                    } else {
                        args.extend(["-c".into(), format!("mcp_servers.{k}.url={:?}", d.url)]);
                    }
                }
            }
            "gemini" => {
                let names: Vec<&str> = mine.keys().map(|k| k.as_str()).collect();
                args.extend(["--allowed-mcp-server-names".into(), names.join(",")]);
            }
            _ => {}
        }
    }
    if !m.skills.is_empty() {
        pre.push_str(&format!("Skills for this task (in .agents/skills/): {}.\n", m.skills.join(", ")));
    }
    if !m.memory.is_empty() && !m.memory.contains("..") {
        if let Ok(t) = std::fs::read_to_string(root.join(&m.memory)) {
            let t: String = t.chars().take(16_000).collect();
            pre.push_str(&format!("Memory ({}):\n{}\n", m.memory, t.trim_end()));
        }
    }
    if !m.prompt.trim().is_empty() {
        pre.push_str(m.prompt.trim());
        pre.push('\n');
    }
    (args, pre)
}

/// How much each part of a seat's score counts. Sums to 100.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Weights {
    pub gate: f64,
    pub tests: f64,
    pub refusals: f64,
    pub retries: f64,
    pub cost: f64,
    pub duration: f64,
}

pub const WEIGHTS: Weights = Weights { gate: 40.0, tests: 20.0, refusals: 15.0, retries: 10.0, cost: 10.0, duration: 5.0 };

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct SeatRun {
    pub slice: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub seat: String,
    pub agent: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub model: String,
    pub usage: Usage,
    /// Wall time kula measured, every attempt together.
    pub duration_ms: u64,
    pub files: usize,
    pub added: u64,
    pub removed: u64,
    pub refusals: u32,
    pub attempts: u32,
    /// passed | failed | rejected
    pub verdict: String,
    /// `None` when the plan runs no tests.
    pub tests: Option<bool>,
    pub score: f64,
    /// Files it changed (wiring excluded), at most `MAX_PATHS`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<String>,
    /// The commit kept on the slice branch, when it passed.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub commit: String,
}

pub const MAX_PATHS: usize = 300;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Handoff {
    pub from: String,
    pub to: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Run {
    pub schema: u32,
    pub id: String,
    pub plan: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub team: String,
    pub goal: String,
    /// manual | schedule | push | pr
    pub trigger: String,
    pub started: u64,
    pub ended: u64,
    pub base: String,
    pub head: String,
    /// passed | partial | failed
    pub state: String,
    pub seats: Vec<SeatRun>,
    pub handoffs: Vec<Handoff>,
    pub usage: Usage,
    pub score: f64,
    pub weights: Option<Weights>,
}

/// A seat's score out of 100.
pub fn seat_score(s: &SeatRun) -> f64 {
    let w = WEIGHTS;
    let gate = if s.verdict == "passed" { 1.0 } else { 0.0 };
    let tests = s.tests.map_or(gate, |t| if t { 1.0 } else { 0.0 });
    let refusals = 1.0 / (1.0 + s.refusals as f64);
    let retries = 1.0 / s.attempts.max(1) as f64;
    let tokens = (s.usage.tokens_in + s.usage.tokens_out) as f64;
    // Unknown usage scores the middle, not the top.
    let cost = if s.usage.is_empty() { 0.5 } else { 1.0 / (1.0 + tokens / 200_000.0 + s.usage.cost_usd) };
    let duration = 1.0 / (1.0 + s.duration_ms as f64 / 1_800_000.0);
    let v = w.gate * gate + w.tests * tests + w.refusals * refusals + w.retries * retries + w.cost * cost + w.duration * duration;
    (v * 10.0).round() / 10.0
}

pub fn verdict_of(st: SliceState) -> &'static str {
    match st {
        SliceState::Passed => "passed",
        SliceState::Rejected => "rejected",
        _ => "failed",
    }
}

/// Whether a slice's tests passed: `None` without a test command.
pub fn tests_of(plan: &Plan, s: &Slice) -> Option<bool> {
    plan.test_cmd.as_ref().filter(|c| !c.trim().is_empty())?;
    // A slice stopped before its tests ran has no test result.
    if s.state == SliceState::Passed {
        Some(true)
    } else if s.reasons.iter().any(|r| r.to_lowercase().contains("test")) {
        Some(false)
    } else {
        None
    }
}

/// Paths changed and lines added and removed in a `git diff --numstat`.
pub fn numstat(text: &str) -> (Vec<String>, u64, u64) {
    let mut n = (vec![], 0, 0);
    for l in text.lines() {
        let mut it = l.split('\t');
        let (Some(a), Some(r), Some(p)) = (it.next(), it.next(), it.next()) else { continue };
        if p.starts_with(".kula/") || p.starts_with(".claude/") || p.starts_with(".codex/") || p.starts_with(".gemini/") {
            continue;
        }
        n.0.push(p.to_string());
        n.1 += a.parse::<u64>().unwrap_or(0);
        n.2 += r.parse::<u64>().unwrap_or(0);
    }
    n
}

/// Refusals the guard logged for this run, by slice.
pub fn refusals(kula_dir: &Path, run: &str) -> BTreeMap<String, u32> {
    let mut out = BTreeMap::new();
    for e in crate::events::read(kula_dir, 0, usize::MAX) {
        if e.kind == "refused" && e.run == run {
            *out.entry(e.slice).or_insert(0) += 1;
        }
    }
    out
}

/// Builds the run's record from the finished plan and what was measured.
#[allow(clippy::too_many_arguments)]
pub fn build(plan: &Plan, run: &str, trigger: &str, started: u64, ended: u64, head: &str, seats: BTreeMap<String, SeatRun>, refused: &BTreeMap<String, u32>) -> Run {
    let mut out = vec![];
    let mut total = Usage::default();
    for s in &plan.slices {
        let mut r = seats.get(&s.id).cloned().unwrap_or_default();
        r.slice = s.id.clone();
        r.seat = s.seat.clone();
        r.agent = s.agent.clone();
        if r.model.is_empty() {
            r.model = r.usage.model.clone();
        }
        r.attempts = s.attempts;
        r.verdict = verdict_of(s.state).into();
        r.tests = tests_of(plan, s);
        r.refusals = refused.get(&s.id).copied().unwrap_or(0);
        r.score = seat_score(&r);
        total.add(&r.usage);
        out.push(r);
    }
    let handoffs = plan.slices.iter().flat_map(|s| s.deps.iter().map(|d| Handoff { from: d.clone(), to: s.id.clone() })).collect();
    let passed = out.iter().filter(|s| s.verdict == "passed").count();
    let state = if !out.is_empty() && passed == out.len() {
        "passed"
    } else if passed > 0 {
        "partial"
    } else {
        "failed"
    };
    let score = if out.is_empty() { 0.0 } else { (out.iter().map(|s| s.score).sum::<f64>() / out.len() as f64 * 10.0).round() / 10.0 };
    Run {
        schema: 1,
        id: run.into(),
        plan: plan.id.clone(),
        team: plan.team.clone(),
        goal: plan.goal.clone(),
        trigger: trigger.into(),
        started,
        ended,
        base: plan.base_ref.clone(),
        head: head.into(),
        state: state.into(),
        seats: out,
        handoffs,
        usage: total,
        score,
        weights: Some(WEIGHTS),
    }
}

pub fn dir(repo: &Repo) -> PathBuf {
    repo.kula_dir().join("runs")
}

/// Writes the run to `.kula/runs/<id>.json` and keeps a copy in `refs/kula/meta`.
pub fn save(repo: &Repo, r: &Run) -> anyhow::Result<PathBuf> {
    let d = dir(repo);
    std::fs::create_dir_all(&d)?;
    let p = d.join(format!("{}.json", r.id));
    std::fs::write(&p, serde_json::to_string_pretty(r)?)?;
    let mut m = crate::meta::load(repo)?;
    m.runs.retain(|v| v["id"] != r.id.as_str());
    m.runs.push(serde_json::to_value(r)?);
    if m.runs.len() > KEEP_IN_META {
        let cut = m.runs.len() - KEEP_IN_META;
        m.runs.drain(..cut);
    }
    crate::meta::save(repo, &m, &format!("run {}: {} ({})", r.id, r.state, r.score))?;
    Ok(p)
}

/// Every run, newest first: the files in `.kula/runs/`, else the copies in `refs/kula/meta`.
pub fn list(repo: &Repo) -> Vec<Run> {
    let mut out: BTreeMap<String, Run> = BTreeMap::new();
    if let Ok(m) = crate::meta::load(repo) {
        for v in m.runs {
            if let Ok(r) = serde_json::from_value::<Run>(v) {
                out.insert(r.id.clone(), r);
            }
        }
    }
    if let Ok(rd) = std::fs::read_dir(dir(repo)) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().is_some_and(|x| x == "json") {
                if let Some(r) = std::fs::read_to_string(&p).ok().and_then(|t| serde_json::from_str::<Run>(&t).ok()) {
                    out.insert(r.id.clone(), r);
                }
            }
        }
    }
    let mut v: Vec<Run> = out.into_values().collect();
    v.sort_by(|a, b| b.started.cmp(&a.started).then(b.id.cmp(&a.id)));
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_claude_codex_gemini_and_kula_usage() {
        let c = r#"{"type":"result","subtype":"success","num_turns":3,"duration_ms":4200,"total_cost_usd":0.0123,"usage":{"input_tokens":10,"cache_read_input_tokens":90,"output_tokens":55},"modelUsage":{"claude-sonnet-5-5":{}}}"#;
        let u = parse(c).unwrap();
        assert_eq!((u.tokens_in, u.tokens_out, u.turns, u.duration_ms), (100, 55, 3, 4200));
        assert!((u.cost_usd - 0.0123).abs() < 1e-9 && u.model == "claude-sonnet-5-5");

        let x = "{\"type\":\"thread.started\"}\n{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":7,\"output_tokens\":3}}\nnoise\n{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":5,\"output_tokens\":2}}\n";
        let u = parse(x).unwrap();
        assert_eq!((u.tokens_in, u.tokens_out, u.turns), (12, 5, 2));

        let g = "Loaded cached credentials.\n{\n  \"response\": \"ok\",\n  \"stats\": {\"models\": {\"gemini-3-pro\": {\"api\": {\"totalRequests\": 2}, \"tokens\": {\"prompt\": 40, \"candidates\": 9}}}}\n}\n";
        let u = parse(g).unwrap();
        assert_eq!((u.tokens_in, u.tokens_out, u.turns, u.model.as_str()), (40, 9, 2, "gemini-3-pro"));

        let k = "hello\n{\"kula_usage\":{\"tokens_in\":1,\"tokens_out\":2,\"cost_usd\":0.5,\"turns\":1}}\n";
        assert_eq!(parse(k).unwrap().cost_usd, 0.5);
        assert!(parse("plain text\n{not json").is_none());
    }

    #[test]
    fn scores_go_down_with_refusals_retries_and_failure() {
        let good = SeatRun { verdict: "passed".into(), attempts: 1, usage: Usage { tokens_in: 1000, turns: 1, ..Default::default() }, duration_ms: 60_000, ..Default::default() };
        let refused = SeatRun { refusals: 2, ..good.clone() };
        let retried = SeatRun { attempts: 3, ..good.clone() };
        let failed = SeatRun { verdict: "failed".into(), ..good.clone() };
        let (g, r, t, f) = (seat_score(&good), seat_score(&refused), seat_score(&retried), seat_score(&failed));
        assert!(g > r && g > t && g > f && g <= 100.0 && f < 50.0, "{g} {r} {t} {f}");
        let w = WEIGHTS;
        assert_eq!(w.gate + w.tests + w.refusals + w.retries + w.cost + w.duration, 100.0);
    }

    #[test]
    fn numstat_skips_kula_and_wiring() {
        let n = numstat("3\t1\tsrc/a.rs\n10\t0\t.claude/settings.json\n-\t-\tlogo.png\n2\t2\t.kula/x\n");
        assert_eq!(n, (vec!["src/a.rs".to_string(), "logo.png".to_string()], 3, 1));
    }
}
