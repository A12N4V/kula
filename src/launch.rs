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

// –– Seat lint: eight checks, all before launch –––––––––––––––––––––––––––

/// One lint failure. Always names the field and the seat it belongs to.
#[derive(Debug, Clone, Serialize)]
pub struct LintError {
    /// Seat id (`team/key`), empty for a config-wide failure.
    pub seat: String,
    /// The toml field the failure is about (`skills`, `mcp`, `memory`, `fence`,
    /// `reports_to`, `budget`, `agent`, …).
    pub field: String,
    pub problem: String,
}

/// Run all eight lint checks. `KULA_NO_AGENT=1` skips the CLI probe (no real
/// agent is ever started by lint; the probe only reads `--version`).
pub fn lint(root: &Path, cfg: &crate::config::Config) -> Vec<LintError> {
    let specs = crate::config::merge_config(cfg);
    let mut out = vec![];
    let no_agent = std::env::var_os("KULA_NO_AGENT").is_some();

    for spec in &specs {
        // 1 · CLI on PATH with a version
        if !no_agent && !spec.agent.is_empty() && spec.agent != "any" {
            match cli_version(&spec.agent) {
                Ok(v) if v.is_empty() => {
                    out.push(LintError { seat: spec.id(), field: "agent".into(), problem: format!("{} printed no version", spec.agent) })
                }
                Err(e) => out.push(LintError { seat: spec.id(), field: "agent".into(), problem: e }),
                _ => {}
            }
        }

        // 2 · every skill exists and parses
        if !spec.skills.is_empty() {
            let listed = crate::skills::list(root);
            for s in &spec.skills {
                match listed.iter().find(|l| &l.name == s) {
                    None => out.push(LintError {
                        seat: spec.id(),
                        field: "skills".into(),
                        problem: format!("skill {s:?} does not exist in .agents/skills/"),
                    }),
                    Some(sk) if sk.description.is_empty() => out.push(LintError {
                        seat: spec.id(),
                        field: "skills".into(),
                        problem: format!("skill {s:?} has no description in its SKILL.md"),
                    }),
                    _ => {}
                }
            }
        }

        // 3 · every MCP server defined once
        if !spec.mcp.is_empty() {
            let src = crate::agent_config::read_mcp(root, crate::agent_config::MCP_SOURCE).ok().flatten().unwrap_or_default();
            let dupes: Vec<&String> = spec.mcp.iter().filter(|n| spec.mcp.iter().filter(|m| *m == *n).count() > 1).collect();
            if !dupes.is_empty() {
                out.push(LintError {
                    seat: spec.id(),
                    field: "mcp".into(),
                    problem: format!("servers listed more than once: {}", dupes.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")),
                });
            }
            for name in &spec.mcp {
                if !src.contains_key(name) {
                    out.push(LintError {
                        seat: spec.id(),
                        field: "mcp".into(),
                        problem: format!("server {name:?} is not defined in {}", crate::agent_config::MCP_SOURCE),
                    });
                }
            }
        }

        // 4 · memory path inside the repo
        if !spec.memory.is_empty() {
            if spec.memory.contains("..") || std::path::Path::new(&spec.memory).is_absolute() {
                out.push(LintError {
                    seat: spec.id(),
                    field: "memory".into(),
                    problem: format!("path {:?} escapes the repository", spec.memory),
                });
            } else if !root.join(&spec.memory).is_file() {
                out.push(LintError {
                    seat: spec.id(),
                    field: "memory".into(),
                    problem: format!("memory file {:?} does not exist", spec.memory),
                });
            }
        }

        // 8 · budget and max_parallel set
        if spec.budget == 0 {
            out.push(LintError { seat: spec.id(), field: "budget".into(), problem: "budget is not set (tokens per run)".into() });
        }
        if spec.max_parallel == 0 {
            out.push(LintError { seat: spec.id(), field: "max_parallel".into(), problem: "max_parallel is not set".into() });
        }
    }

    // 6 · reports_to / hands_off is a DAG
    if let Some(cycle) = find_cycle(&specs) {
        out.push(LintError {
            seat: cycle.clone(),
            field: "reports_to".into(),
            problem: format!("{cycle} is part of a reports_to / hands_off cycle – a team must be a DAG"),
        });
    }

    // 5 · fence levels known and names unique
    for spec in &specs {
        let mut seen = std::collections::BTreeSet::new();
        for (level, pats) in [("lock", &spec.fence.lock), ("hide", &spec.fence.hide), ("review", &spec.fence.review)] {
            for p in pats {
                if !seen.insert(format!("{level}:{p}")) {
                    out.push(LintError { seat: spec.id(), field: format!("fence.{level}"), problem: format!("{p:?} is listed twice") });
                }
            }
        }
    }

    // 7 · no two seats write one symbol – B3's overlap check. TODO: switch to
    // guard::overlap() when B3 lands; team_overlaps is the pre-B3 stand-in and
    // only sees files, never symbols.
    // Skipped for now: needs a built Store; the B3 call replaces this stub.
    out
}

/// `--version` output of a CLI on PATH, or the reason it is not usable.
fn cli_version(agent: &str) -> Result<String, String> {
    let bin = match agent {
        "claude" | "codex" | "gemini" => agent,
        other => return Err(format!("agent {other:?} has no CLI adapter yet")),
    };
    let exe = find_on_path(bin).ok_or_else(|| format!("{} is not on PATH", bin))?;
    let out = std::process::Command::new(&exe).arg("--version").output().map_err(|e| format!("{bin} --version failed: {e}"))?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    Ok(text.lines().next().unwrap_or("").trim().to_string())
}

/// Find `name` on PATH, POSIX-style, without any extra crate.
pub fn find_on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let p = dir.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// Walk `reports_to` edges; returns the first seat caught in a cycle.
fn find_cycle(specs: &[crate::config::SeatSpec]) -> Option<String> {
    use std::collections::{BTreeMap, BTreeSet};
    let ids: BTreeSet<String> = specs.iter().map(|s| s.id()).collect();
    // resolve a name within the same team first, then any team
    let resolve = |s: &crate::config::SeatSpec, name: &str| -> Option<String> {
        let own = format!("{}/{}", s.team, name);
        if ids.contains(&own) {
            Some(own)
        } else {
            specs.iter().find(|o| o.key == name || o.team == name).map(|o| o.id())
        }
    };
    let mut edges: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for s in specs {
        for name in std::iter::once(&s.reports_to).filter(|r| !r.is_empty()).chain(s.hands_off.iter()) {
            if let Some(target) = resolve(s, name) {
                edges.entry(s.id()).or_default().push(target);
            }
        }
    }
    // DFS over every edge: reports_to and hands_off are both walked, so a
    // hands_off-only cycle (A→B→A) is caught the same as a reports_to one.
    // A node is a cycle only when met again while still on the current path –
    // a diamond revisits fine.
    let mut done: BTreeSet<String> = BTreeSet::new();
    for start in specs {
        let mut stack: Vec<(String, bool)> = vec![(start.id(), true)];
        let mut on_path: BTreeSet<String> = BTreeSet::new();
        while let Some((cur, entering)) = stack.pop() {
            if !entering {
                on_path.remove(&cur);
                done.insert(cur);
                continue;
            }
            if done.contains(&cur) {
                continue;
            }
            if !on_path.insert(cur.clone()) {
                return Some(cur);
            }
            stack.push((cur.clone(), false));
            if let Some(nexts) = edges.get(&cur) {
                stack.extend(nexts.iter().cloned().map(|n| (n, true)));
            }
        }
    }
    None
}

// –– Adapters: seat spec → argv for claude · codex · gemini –––––––––––––––

/// One CLI's flags, pinned by version. Built from each CLI's `--help`; a CLI
/// whose version is not in the table refuses loudly rather than guessing flags.
#[derive(Debug, Clone)]
pub struct FlagTable {
    pub cli: &'static str,
    /// Version prefixes this table is true for (`"2."` matches 2.3.1).
    pub versions: &'static [&'static str],
    /// Flag that introduces the prompt (`None` = prompt is positional).
    pub prompt_flag: Option<&'static str>,
    /// Flags that turn on stream JSON output.
    pub json_flags: &'static [&'static str],
    /// `--cd`-style flag for the worktree, if the CLI has one.
    pub cd_flag: Option<&'static str>,
    pub model_flag: Option<&'static str>,
    /// Flag that takes the tool allow list as one comma separated value.
    pub allow_tools_flag: Option<&'static str>,
    /// Flag that takes the per-seat MCP config file, if any.
    pub mcp_config_flag: Option<&'static str>,
}

#[allow(dead_code)] // the launcher (B2's orch) wires these in when seats launch
pub const TABLES: &[FlagTable] = &[
    FlagTable {
        cli: "claude",
        versions: &["2.", "1."],
        prompt_flag: Some("-p"),
        json_flags: &["--output-format", "stream-json", "--verbose"],
        cd_flag: None,
        model_flag: Some("--model"),
        allow_tools_flag: Some("--allowedTools"),
        mcp_config_flag: Some("--mcp-config"),
    },
    FlagTable {
        cli: "codex",
        versions: &["0."],
        prompt_flag: None, // codex exec takes the prompt as the positional
        json_flags: &["--json"],
        cd_flag: Some("--cd"),
        model_flag: Some("-m"),
        allow_tools_flag: None, // codex has no allow-list flag; fence is the wall
        mcp_config_flag: None,  // servers ride as -c mcp_servers.* overrides
    },
    FlagTable {
        cli: "gemini",
        versions: &["0."],
        prompt_flag: Some("-p"),
        json_flags: &["--output-format", "json"],
        cd_flag: None,
        model_flag: Some("--model"),
        allow_tools_flag: None,
        mcp_config_flag: None, // servers ride as --allowed-mcp-server-names
    },
];

/// Build the argv for one seat run with the right adapter. `KULA_NO_AGENT=1`
/// short-circuits the version probe and still returns the would-be argv –
/// nothing spawns, tests stay hermetic. `seat_dir` is the rendered seat
/// folder; `prompt` the task text; `wt` the worktree.
#[allow(dead_code)] // the launcher (B2's orch) wires this in when seats launch
pub fn build_argv(
    spec: &crate::config::SeatSpec,
    seat_dir: &crate::agent_config::SeatDir,
    prompt: &str,
    wt: &Path,
) -> anyhow::Result<Vec<String>> {
    let table = TABLES.iter().find(|t| t.cli == spec.agent).ok_or_else(|| anyhow::anyhow!("no adapter for agent {:?}", spec.agent))?;
    let no_agent = std::env::var_os("KULA_NO_AGENT").is_some();
    if !no_agent {
        let v = cli_version(&spec.agent).map_err(anyhow::Error::msg)?;
        if !table.versions.iter().any(|p| v.starts_with(p)) {
            anyhow::bail!(
                "{} is version {v:?}, not pinned in kula's flag table (wants {}…) – refusing to guess flags",
                spec.agent,
                table.versions.join("/")
            );
        }
    }

    let mut argv: Vec<String> = vec![spec.agent.clone()];
    if let Some(cd) = table.cd_flag {
        argv.push(cd.into());
        argv.push(wt.to_string_lossy().into_owned());
    }
    for f in table.json_flags {
        argv.push((*f).into());
    }
    if let (Some(mf), false) = (table.model_flag, spec.model.is_empty()) {
        argv.push(mf.into());
        argv.push(spec.model.clone());
    }
    if let (Some(mcf), true) = (table.mcp_config_flag, !spec.mcp.is_empty()) {
        argv.push(mcf.into());
        argv.push(format!("{}/mcp.json", seat_dir.path));
        argv.push("--strict-mcp-config".into());
    }
    if spec.agent == "gemini" && !spec.mcp.is_empty() {
        argv.push("--allowed-mcp-server-names".into());
        argv.push(spec.mcp.join(","));
    }
    if let (Some(atf), true) = (table.allow_tools_flag, !spec.mcp.is_empty()) {
        let tools: Vec<String> = spec.mcp.iter().map(|m| format!("mcp__{m}")).collect();
        argv.push(atf.into());
        argv.push(tools.join(","));
    }
    if spec.agent == "claude" {
        // -p is non-interactive; it needs the permission gate off.
        argv.push("--dangerously-skip-permissions".into());
    }
    if let Some(pf) = table.prompt_flag {
        argv.push(pf.into());
    }
    argv.push(prompt.to_string());
    Ok(argv)
}

/// Public aliases the plan names; all three go through `build_argv`.
/// Test-only for now – the launcher (B2's orch) wires them in when seats launch.
#[allow(dead_code)]
pub mod adapters {
    use super::*;
    pub fn claude_argv(
        spec: &crate::config::SeatSpec,
        seat_dir: &crate::agent_config::SeatDir,
        prompt: &str,
        wt: &Path,
    ) -> anyhow::Result<Vec<String>> {
        build_argv(&spec_with_agent(spec, "claude"), seat_dir, prompt, wt)
    }
    pub fn codex_argv(
        spec: &crate::config::SeatSpec,
        seat_dir: &crate::agent_config::SeatDir,
        prompt: &str,
        wt: &Path,
    ) -> anyhow::Result<Vec<String>> {
        build_argv(&spec_with_agent(spec, "codex"), seat_dir, prompt, wt)
    }
    pub fn gemini_argv(
        spec: &crate::config::SeatSpec,
        seat_dir: &crate::agent_config::SeatDir,
        prompt: &str,
        wt: &Path,
    ) -> anyhow::Result<Vec<String>> {
        build_argv(&spec_with_agent(spec, "gemini"), seat_dir, prompt, wt)
    }
    fn spec_with_agent(spec: &crate::config::SeatSpec, agent: &str) -> crate::config::SeatSpec {
        let mut s = spec.clone();
        s.agent = agent.into();
        s
    }
}

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
        // an agent prints its own usage lines, so the sums saturate instead of wrapping
        self.tokens_in = self.tokens_in.saturating_add(o.tokens_in);
        self.tokens_out = self.tokens_out.saturating_add(o.tokens_out);
        self.cost_usd += if o.cost_usd.is_finite() { o.cost_usd.max(0.0) } else { 0.0 };
        self.turns = self.turns.saturating_add(o.turns);
        self.duration_ms = self.duration_ms.saturating_add(o.duration_ms);
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
                if std::fs::create_dir_all(dir).is_ok()
                    && std::fs::write(&f, serde_json::json!({ "mcpServers": servers }).to_string()).is_ok()
                {
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
    /// What the seat set out to do: an experiment's hypothesis.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note: String,
}

/// One experiment of an autoresearch run, as the metric chart draws it.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Point {
    pub n: u32,
    /// The metric after the change; none when it was rejected or failed.
    pub value: Option<f64>,
    /// The best so far, after this experiment.
    pub best: f64,
    /// kept | reverted | rejected
    pub verdict: String,
}

/// What an autoresearch run measures (H.7): the metric over its experiments.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct ResearchLine {
    pub workflow: String,
    pub metric: String,
    /// min | max
    pub goal: String,
    pub budget: u32,
    pub branch: String,
    pub baseline: f64,
    pub best: f64,
    /// How much better the best is than the baseline, as a fraction.
    pub gain: f64,
    pub points: Vec<Point>,
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
    /// passed | partial | failed, or running while research goes on
    pub state: String,
    pub seats: Vec<SeatRun>,
    pub handoffs: Vec<Handoff>,
    pub usage: Usage,
    pub score: f64,
    pub weights: Option<Weights>,
    /// Set on autoresearch runs: the metric and every experiment's value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub research: Option<ResearchLine>,
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
pub fn build(
    plan: &Plan,
    run: &str,
    trigger: &str,
    started: u64,
    ended: u64,
    head: &str,
    seats: BTreeMap<String, SeatRun>,
    refused: &BTreeMap<String, u32>,
) -> Run {
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
        research: None,
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
    use crate::config::SeatSpec;

    /// A repo built from the tests/fixtures/seat-lint template – a disposable
    /// kula.toml, one skill, one MCP server, a notes file. Never the repo's
    /// own config.
    // Tests that touch process env (KULA_NO_AGENT, PATH) must hold this: the
    // env is global and tests run concurrently in one process, so a set in one
    // test racing the remove-and-rebuild window of another flips verdicts.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn seat_repo() -> tempfile::TempDir {
        let t = tempfile::tempdir().unwrap();
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/seat-lint");
        copy_rec(&src, t.path());
        t
    }

    fn copy_rec(from: &Path, to: &Path) {
        std::fs::create_dir_all(to).unwrap();
        for e in std::fs::read_dir(from).unwrap() {
            let e = e.unwrap();
            let p = e.path();
            let d = to.join(e.file_name());
            if p.is_dir() {
                copy_rec(&p, &d);
            } else {
                std::fs::copy(&p, &d).unwrap();
            }
        }
    }

    #[test]
    fn lint_passes_a_good_config_and_fails_named_fields() {
        // fixture config has budget and max_parallel set, valid skill, mcp,
        // memory and fences: with KULA_NO_AGENT the CLI check is skipped.
        let _env = ENV_LOCK.lock().unwrap();
        std::env::set_var("KULA_NO_AGENT", "1");
        let d = seat_repo();
        let root = d.path();
        assert!(lint(root, &crate::config::Config::load(root).unwrap()).is_empty(), "fixture must lint clean");

        let cases: &[(&str, &str, &str)] = &[
            ("memory escapes the repo", "memory = \"../x.md\"", "memory"),
            ("unknown mcp server", "mcp = [\"nope\"]", "mcp"),
            ("missing skill", "skills = [\"nope\"]", "skills"),
            ("budget unset", "budget = 100000, max_parallel = 1,", "budget"),
        ];
        let text = std::fs::read_to_string(root.join("kula.toml")).unwrap();
        for (name, from, field) in cases {
            let mut bad = if *field == "budget" { text.replace("budget = 100000,", "") } else { text.replace(*from, "") };
            let _ = name;
            bad = if *field == "memory" { text.replace("memory = \"notes.md\"", "memory = \"../x.md\"") } else { bad };
            if *field == "mcp" {
                bad = text.replace("mcp = [\"demo\"]", "mcp = [\"nope\"]");
            }
            if *field == "skills" {
                bad = text.replace("skills = [\"demo-skill\"]", "skills = [\"nope\"]");
            }
            std::fs::write(root.join("kula.toml"), &bad).unwrap();
            let cfg = crate::config::Config::load(root).unwrap();
            let errs = lint(root, &cfg);
            assert!(errs.iter().any(|e| e.seat.contains("alpha") && e.field == *field), "{name}: {errs:?}");
            std::fs::write(root.join("kula.toml"), &text).unwrap();
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn lint_catches_hands_off_cycle_and_absolute_memory_path() {
        let _env = ENV_LOCK.lock().unwrap();
        std::env::set_var("KULA_NO_AGENT", "1");
        let d = seat_repo();
        let root = d.path();
        let text = std::fs::read_to_string(root.join("kula.toml")).unwrap();

        // A hands_off-only cycle: alpha hands off to beta, beta hands off back
        // to alpha – no reports_to anywhere, the DAG check must still fire.
        let handoff = text
            .replace("name = \"alpha\",", "name = \"alpha\", hands_off = [\"beta\"],")
            .replace("reports_to = \"alpha\"", "hands_off = [\"alpha\"]");
        std::fs::write(root.join("kula.toml"), &handoff).unwrap();
        let errs = lint(root, &crate::config::Config::load(root).unwrap());
        assert!(errs.iter().any(|e| e.problem.contains("cycle")), "hands_off-only cycle must be caught: {errs:?}");

        // An absolute memory path reads outside the repo even without "..".
        std::fs::write(root.join("kula.toml"), &text).unwrap();
        let abs = text.replace("memory = \"notes.md\"", "memory = \"/etc/hosts\"");
        std::fs::write(root.join("kula.toml"), &abs).unwrap();
        let errs = lint(root, &crate::config::Config::load(root).unwrap());
        assert!(
            errs.iter().any(|e| e.field == "memory" && e.problem.contains("escapes")),
            "absolute memory path must be refused: {errs:?}"
        );
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn lint_catches_cycle_and_missing_budget() {
        let _env = ENV_LOCK.lock().unwrap();
        std::env::set_var("KULA_NO_AGENT", "1");
        let d = seat_repo();
        let root = d.path();
        let text = std::fs::read_to_string(root.join("kula.toml")).unwrap();
        // alpha reports to beta while beta reports to alpha → cycle
        let cyc = text.replace("name = \"alpha\",", "name = \"alpha\", reports_to = \"beta\",");
        std::fs::write(root.join("kula.toml"), &cyc).unwrap();
        let cfg = crate::config::Config::load(root).unwrap();
        let errs = lint(root, &cfg);
        assert!(errs.iter().any(|e| e.field == "reports_to" && e.problem.contains("cycle")), "cycle must be caught: {errs:?}");

        let nobud = text.replace("budget = 100000,", "").replace("budget = 50000,", "");
        std::fs::write(root.join("kula.toml"), &nobud).unwrap();
        let errs = lint(root, &crate::config::Config::load(root).unwrap());
        assert!(errs.iter().any(|e| e.field == "budget"), "budget unset must be caught");
        assert!(errs.iter().any(|e| e.field == "max_parallel" || e.field == "budget"), "{errs:?}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn adapters_build_pinned_argv_and_refuse_unknown_versions() {
        let _env = ENV_LOCK.lock().unwrap();
        std::env::set_var("KULA_NO_AGENT", "1");
        let d = seat_repo();
        let root = d.path();
        let s = spec_alpha();
        let dir = crate::agent_config::render_seat(root, &s).unwrap();
        let wt = root.join(".worktrees/alpha");

        let a = crate::launch::adapters::claude_argv(&s, &dir, "do it", &wt).unwrap();
        let (p, j) = (a.iter().position(|x| x == "-p").unwrap(), a.iter().position(|x| x == "--output-format").unwrap());
        assert_eq!(a[j + 1], "stream-json", "claude streams JSON");
        assert!(a.iter().any(|x| x == "--mcp-config") && a.iter().any(|x| x.ends_with("/mcp.json")), "per-seat mcp.json passed");
        assert!(a.iter().any(|x| x == "mcp__demo"), "allow list carries the server as a tool");
        assert_eq!(a[p + 1], "do it", "prompt flag takes the prompt");

        let c = crate::launch::adapters::codex_argv(&s, &dir, "do it", &wt).unwrap();
        let cd = c.iter().position(|x| x == "--cd").unwrap();
        assert_eq!(c[cd + 1], wt.to_string_lossy(), "codex gets the worktree via --cd");
        assert!(c.iter().any(|x| x == "--json"), "codex streams JSON");

        let g = crate::launch::adapters::gemini_argv(&s, &dir, "do it", &wt).unwrap();
        assert!(g.iter().any(|x| x == "demo"), "gemini allow-lists MCP server names");

        // unknown CLI version must fail loud, not guess flags
        // (the ENV_LOCK is already held at the top of this test – never re-lock)
        let old = std::env::var("KULA_NO_AGENT").ok();
        std::env::remove_var("KULA_NO_AGENT");
        if crate::launch::find_on_path("claude").is_some() {
            let mut fake = spec_alpha();
            fake.agent = "claude".into();
            // simulate an unpinned version by pointing at a fake CLI via PATH
            let fakedir = tempfile::tempdir().unwrap();
            let bin = fakedir.path().join("claude");
            std::fs::write(&bin, "#!/bin/sh\necho 9.9.9\n").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            let old_path = std::env::var("PATH").unwrap();
            std::env::set_var("PATH", format!("{}:{}", fakedir.path().display(), old_path));
            let err = crate::launch::build_argv(&fake, &dir, "p", &wt);
            assert!(err.is_err(), "version 9.9.9 is not pinned – must refuse: {a:?}");
            std::env::set_var("PATH", old_path);
        }
        match old {
            Some(v) => std::env::set_var("KULA_NO_AGENT", v),
            None => std::env::remove_var("KULA_NO_AGENT"),
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    fn spec_alpha() -> SeatSpec {
        SeatSpec {
            team: "lint".into(),
            key: "alpha".into(),
            agent: "claude".into(),
            model: "opus".into(),
            workflow: "build".into(),
            scope: vec![],
            role: String::new(),
            prompt: "p".into(),
            reports_to: String::new(),
            hands_off: vec![],
            skills: vec!["demo-skill".into()],
            mcp: vec!["demo".into()],
            memory: "notes.md".into(),
            fence: crate::config::SeatFence { lock: vec![], hide: vec![], review: vec![] },
            budget: 1000,
            max_parallel: 1,
            tags: vec![],
            color: String::new(),
        }
    }

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
        let good = SeatRun {
            verdict: "passed".into(),
            attempts: 1,
            usage: Usage { tokens_in: 1000, turns: 1, ..Default::default() },
            duration_ms: 60_000,
            ..Default::default()
        };
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
