//! Guards: fences around parts of the codebase, for AI agents.
//!
//! Path-based permission lists exist in every agent tool. What kula adds is that
//! the fence is part of the code graph: a rule can name a symbol and follow it
//! wherever it moves, a task scope says which part of the graph an agent is
//! working in, and every agent-facing answer (MCP, the agent hook, `kula check`)
//! reads the same verdict.
//!
//! Levels, weakest to strongest:
//!   review   – may be edited; the change is flagged for a human
//!   scope    – outside the active task's scope (`kula task start`): read only
//!   locked   – may be read, never edited
//!   hidden   – never read or edited; left out of every agent answer
//!
//! Rules live in `kula.toml` (`[[guard]]`, shared with the team); the task lives
//! in `.kula/task.json` (local to this checkout).
//!
//! Fences are enforced, not advisory. kula's own config – kula.toml, `.kula/`,
//! every agent's hook and MCP wiring, the git hooks – is always locked for
//! agents, so no agent can loosen the fences it is held to (it may `suggest`).
//! The pre-tool hook reads shell commands too, the git pre-commit hook refuses
//! fenced changes from an agent, and `kula run` holds any other harness to the
//! same verdicts.

use crate::config::{Config, GuardRule};
use crate::git::Repo;
use crate::store::{Node, Store};
use crate::workflow::{self, Workflow};
use anyhow::{bail, Result};
use globset::{Glob, GlobSet, GlobSetBuilder};
use serde::{Deserialize, Serialize};

/// Files that are secrets more often than not; hidden when `agents.hide_secrets` is on.
pub const SECRETS: &[&str] = &[
    "**/.env",
    "**/.env.*",
    "**/*.pem",
    "**/*.key",
    "**/*.p12",
    "**/*.pfx",
    "**/*.keystore",
    "**/*.jks",
    "**/id_rsa*",
    "**/id_ed25519*",
    "**/.npmrc",
    "**/.pypirc",
    "**/credentials.json",
    "**/secrets/**",
];

/// kula's own config and every agent's wiring to it: locked for agents, always.
pub const OWN: &[&str] = &[
    "kula.toml",
    ".kula/**",
    ".mcp.json",
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".cursor/mcp.json",
    ".cursor/hooks.json",
    ".codex/config.toml",
    ".codex/hooks.json",
    ".gemini/settings.json",
    ".github/workflows/kula.yml",
    ".kula-ci.yml",
    ".git/**",
];

/// Whether a path is kula's own config or agent wiring.
pub fn is_own(path: &str) -> bool {
    static OWN_SET: std::sync::OnceLock<GlobSet> = std::sync::OnceLock::new();
    OWN_SET
        .get_or_init(|| globset(&OWN.iter().map(|s| s.to_string()).collect::<Vec<_>>()).unwrap_or_else(|_| GlobSet::empty()))
        .is_match(path.trim_start_matches("./"))
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Default)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    #[default]
    Open,
    Review,
    Scope,
    Locked,
    Hidden,
}

impl Level {
    fn parse(s: &str) -> Level {
        match s {
            "hidden" => Level::Hidden,
            "locked" => Level::Locked,
            "review" => Level::Review,
            _ => Level::Locked,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Level::Open => "open",
            Level::Review => "review",
            Level::Scope => "scope",
            Level::Locked => "locked",
            Level::Hidden => "hidden",
        }
    }
    /// Agents may change it.
    pub fn editable(self) -> bool {
        self <= Level::Review
    }
    /// Agents may see it.
    pub fn readable(self) -> bool {
        self != Level::Hidden
    }
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Verdict {
    pub level: Level,
    /// Why, in a sentence an agent can act on.
    pub reason: String,
    /// Which rule decided: `kula.toml guard #2`, `secrets`, `task`.
    pub rule: String,
}

/// The active task: a title and the part of the code it may change.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Task {
    pub title: String,
    /// Globs and symbol names; empty means the whole repository.
    pub scope: Vec<String>,
    pub started: i64,
    pub by: String,
    /// The workflow it runs in (`workflow.rs`); its fences apply while the task is open.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub workflow: String,
}

struct Compiled {
    rule: GuardRule,
    globs: GlobSet,
    level: Level,
    /// `kula.toml guard #2`, or `workflow refactor`.
    source: String,
}

/// Every fence in force for this checkout, compiled once.
pub struct Guards {
    rules: Vec<Compiled>,
    own: GlobSet,
    secrets: Option<GlobSet>,
    task: Option<(Task, GlobSet, Vec<String>)>,
    workflow: Option<Workflow>,
}

fn globset(pats: &[String]) -> Result<GlobSet> {
    let mut b = GlobSetBuilder::new();
    for p in pats {
        let p = p.trim_start_matches("./");
        b.add(Glob::new(p)?);
        // `dir/` and `dir` mean everything under it, as in .gitignore.
        if !p.contains('*') {
            b.add(Glob::new(&format!("{}/**", p.trim_end_matches('/')))?);
        }
    }
    Ok(b.build()?)
}

fn task_path(repo: &Repo) -> std::path::PathBuf {
    repo.kula_dir().join("task.json")
}

pub fn task(repo: &Repo) -> Option<Task> {
    serde_json::from_str(&std::fs::read_to_string(task_path(repo)).ok()?).ok()
}

/// Start a task, optionally in a workflow (whose scope applies when none is given).
pub fn task_start(repo: &Repo, title: &str, scope: Vec<String>, wf: Option<&str>, by: &str) -> Result<Task> {
    if title.trim().is_empty() {
        bail!("a task needs a title");
    }
    let wf = match wf.map(str::trim).filter(|w| !w.is_empty()) {
        Some(name) => match workflow::find(&Config::load(&repo.root)?, name) {
            Some(w) => Some(w),
            None => bail!("no workflow called {name} – `kula workflow list`"),
        },
        None => None,
    };
    let scope = if scope.is_empty() { wf.as_ref().map(|w| w.scope.clone()).unwrap_or_default() } else { scope };
    globset(&Config::load(&repo.root)?.expand_scope(&scope).iter().filter(|s| looks_like_path(s)).cloned().collect::<Vec<_>>())?;
    let t = Task {
        title: title.trim().into(),
        scope,
        started: crate::meta::now(),
        by: by.into(),
        workflow: wf.map(|w| w.name).unwrap_or_default(),
    };
    std::fs::create_dir_all(repo.kula_dir())?;
    std::fs::write(task_path(repo), serde_json::to_string_pretty(&t)?)?;
    Ok(t)
}

pub fn task_done(repo: &Repo) -> Result<Option<Task>> {
    let t = task(repo);
    let _ = std::fs::remove_file(task_path(repo));
    Ok(t)
}

/// A scope entry is a path glob when it has a slash, a glob character or a file extension.
fn looks_like_path(s: &str) -> bool {
    s.contains('/') || s.contains('*') || s.contains('.')
}

// ------------------------------------------------------------------ teams

/// The active team (`kula team start`): which agent works in which workflow.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ActiveTeam {
    pub name: String,
    pub started: i64,
    pub by: String,
}

fn team_path(repo: &Repo) -> std::path::PathBuf {
    repo.kula_dir().join("team.json")
}

pub fn team(repo: &Repo) -> Option<ActiveTeam> {
    serde_json::from_str(&std::fs::read_to_string(team_path(repo)).ok()?).ok()
}

pub fn team_start(repo: &Repo, name: &str, by: &str) -> Result<ActiveTeam> {
    let cfg = Config::load(&repo.root)?;
    let Some(t) = cfg.teams.iter().find(|t| t.name == name) else {
        bail!("no team called {name} – `kula team list`");
    };
    for m in &t.members {
        if !m.workflow.is_empty() && workflow::find(&cfg, &m.workflow).is_none() {
            bail!("team {name}: {} works in {}, which is not a workflow", m.key(), m.workflow);
        }
    }
    let a = ActiveTeam { name: name.into(), started: crate::meta::now(), by: by.into() };
    std::fs::create_dir_all(repo.kula_dir())?;
    std::fs::write(team_path(repo), serde_json::to_string_pretty(&a)?)?;
    Ok(a)
}

pub fn team_stop(repo: &Repo) -> Result<Option<ActiveTeam>> {
    let t = team(repo);
    let _ = std::fs::remove_file(team_path(repo));
    Ok(t)
}

/// One agent's place in the active team, if it has one.
pub fn member(repo: &Repo, cfg: &Config, agent: &str) -> Option<(String, crate::config::Member)> {
    let active = team(repo)?;
    let t = cfg.teams.iter().find(|t| t.name == active.name)?;
    // by seat name (`KULA_AGENT=atlas`), then by the agent that runs it, then
    // the first seat any connected agent may take
    let id = crate::agents::agent_id(agent);
    let pick = t
        .members
        .iter()
        .find(|m| !m.name.is_empty() && m.name.to_lowercase() == id)
        .or_else(|| t.members.iter().find(|m| !m.agent.is_empty() && crate::agents::agent_id(&m.agent) == id))
        .or_else(|| t.members.iter().find(|m| m.agent.is_empty() || m.agent == "any"));
    pick.map(|m| (t.name.clone(), m.clone()))
}

impl Guards {
    pub fn load(repo: &Repo) -> Result<Guards> {
        let cfg = Config::load(&repo.root)?;
        Guards::new(&cfg, task(repo))
    }

    /// The fences one agent works under: in an active team, its own workflow
    /// (and scope) replace the task's – separate workflows for separate agents.
    pub fn for_agent(repo: &Repo, agent: Option<&str>) -> Result<Guards> {
        let cfg = Config::load(&repo.root)?;
        let mut t = task(repo);
        if let Some((team, m)) = agent.and_then(|a| member(repo, &cfg, a)) {
            let wf = (!m.workflow.is_empty()).then(|| workflow::find(&cfg, &m.workflow)).flatten();
            let scope = if !m.scope.is_empty() { m.scope.clone() } else { wf.as_ref().map(|w| w.scope.clone()).unwrap_or_default() };
            let who = crate::agents::agent_id(agent.unwrap_or_default());
            let base = Task {
                title: format!(
                    "team {team}: {who} in {}{}",
                    if m.workflow.is_empty() { "no workflow" } else { &m.workflow },
                    if m.role.is_empty() { String::new() } else { format!(" – {}", m.role) }
                ),
                started: t.as_ref().map(|t| t.started).unwrap_or_else(crate::meta::now),
                by: format!("team:{team}"),
                ..Default::default()
            };
            t = Some(Task { workflow: m.workflow.clone(), scope: if scope.is_empty() { base.scope.clone() } else { scope }, ..base });
        }
        Guards::new(&cfg, t)
    }

    pub fn new(cfg: &Config, task: Option<Task>) -> Result<Guards> {
        let mut rules = Vec::new();
        for (i, r) in cfg.guards.iter().enumerate() {
            rules.push(Compiled {
                globs: globset(&r.paths)?,
                level: Level::parse(&r.level),
                rule: r.clone(),
                source: format!("kula.toml guard #{}", i + 1),
            });
        }
        // The active workflow's own fences sit on top of the repository's.
        let wf = task.as_ref().filter(|t| !t.workflow.is_empty()).and_then(|t| workflow::find(cfg, &t.workflow));
        if let Some(w) = &wf {
            for (pats, level, what) in
                [(&w.lock, Level::Locked, "locks"), (&w.hide, Level::Hidden, "hides"), (&w.review, Level::Review, "flags for review")]
            {
                if pats.is_empty() {
                    continue;
                }
                let (paths, symbols): (Vec<String>, Vec<String>) = pats.iter().cloned().partition(|s| looks_like_path(s) || s == "**");
                let reason = format!("the {} workflow {what} this – {}", w.name, w.about);
                rules.push(Compiled {
                    globs: globset(&paths)?,
                    level,
                    rule: GuardRule { paths, symbols, level: level.as_str().into(), reason },
                    source: format!("workflow {}", w.name),
                });
            }
        }
        let secrets =
            if cfg.agents.hide_secrets { Some(globset(&SECRETS.iter().map(|s| s.to_string()).collect::<Vec<_>>())?) } else { None };
        let task = match task {
            Some(t) if !t.scope.is_empty() => {
                let (paths, syms): (Vec<String>, Vec<String>) = cfg.expand_scope(&t.scope).into_iter().partition(|s| looks_like_path(s));
                let g = globset(&paths)?;
                Some((t, g, syms))
            }
            Some(t) => Some((t, GlobSet::empty(), vec![])),
            None => None,
        };
        let own = globset(&OWN.iter().map(|s| s.to_string()).collect::<Vec<_>>())?;
        Ok(Guards { rules, own, secrets, task, workflow: wf })
    }

    pub fn task(&self) -> Option<&Task> {
        self.task.as_ref().map(|t| &t.0)
    }

    /// The workflow of the active task, if it runs in one.
    pub fn workflow(&self) -> Option<&Workflow> {
        self.workflow.as_ref()
    }

    /// kula.toml's rules (the active workflow's are in `workflow_rules`).
    pub fn rules(&self) -> Vec<(GuardRule, Level)> {
        self.rules.iter().filter(|c| !c.source.starts_with("workflow")).map(|c| (c.rule.clone(), c.level)).collect()
    }

    pub fn workflow_rules(&self) -> Vec<(GuardRule, Level)> {
        self.rules.iter().filter(|c| c.source.starts_with("workflow")).map(|c| (c.rule.clone(), c.level)).collect()
    }

    /// The verdict for a file.
    pub fn path(&self, path: &str) -> Verdict {
        self.decide(path, None, false)
    }

    /// The verdict for a symbol: its own rules, then its file's.
    pub fn node(&self, n: &Node) -> Verdict {
        self.decide(&n.path, if n.kind == "file" || n.kind == "package" { None } else { Some(&n.name) }, false)
    }

    /// `in_scope` overrides the task scope (a file holding an in-scope symbol).
    fn decide(&self, path: &str, symbol: Option<&str>, in_scope: bool) -> Verdict {
        let path = path.trim_start_matches("./");
        let mut best = Verdict::default();
        let mut raise = |v: Verdict| {
            if v.level > best.level {
                best = v;
            }
        };
        if self.own.is_match(path) {
            raise(Verdict {
                level: Level::Locked,
                reason: "kula's own config and agent wiring – only a person changes it (agents can `suggest`)".into(),
                rule: "kula".into(),
            });
        }
        if let Some(s) = &self.secrets {
            if s.is_match(path) {
                raise(Verdict { level: Level::Hidden, reason: "likely a secret (agents.hide_secrets)".into(), rule: "secrets".into() });
            }
        }
        for c in &self.rules {
            let by_symbol = symbol.is_some_and(|name| {
                c.rule.symbols.iter().any(|s| match s.rsplit_once(':') {
                    Some((p, n)) => n == name && (path == p || path.ends_with(&format!("/{p}"))),
                    None => s == name,
                })
            });
            if by_symbol || c.globs.is_match(path) {
                let reason = if c.rule.reason.is_empty() { format!("{} by kula.toml", c.level.as_str()) } else { c.rule.reason.clone() };
                raise(Verdict { level: c.level, reason, rule: c.source.clone() });
            }
        }
        if let Some((t, globs, syms)) = &self.task {
            let inside = in_scope || t.scope.is_empty() || globs.is_match(path) || symbol.is_some_and(|n| syms.iter().any(|s| s == n));
            if !inside {
                raise(Verdict {
                    level: Level::Scope,
                    reason: format!("task \"{}\" covers only {}", t.title, t.scope.join(", ")),
                    rule: "task".into(),
                });
            }
        }
        best
    }

    /// For edit checks on a file: a symbol-scoped task opens the files that
    /// define its symbols (looked up in the graph when there is one).
    ///
    /// Coarse on symbols: a file that holds a locked or hidden symbol is fenced
    /// whole, because the hook's payload does not say which lines changed.
    /// `kula guard commit`, `kula verify` and `kula check` know the hunks and
    /// use [`Guards::edit_touched`], which is exact.
    pub fn edit(&self, store: Option<&Store>, path: &str) -> Verdict {
        let holds = match (&self.task, store) {
            (Some((_, _, syms)), Some(st)) if !syms.is_empty() => syms
                .iter()
                .any(|s| st.nodes_where("name = ?1 AND path = ?2", rusqlite::params![s, path]).map(|h| !h.is_empty()).unwrap_or(false)),
            _ => false,
        };
        let mut best = self.decide(path, None, holds);
        // A symbol rule must hold even at hook time: every symbol the file
        // defines is a possible touch, so a locked symbol locks the file.
        if let Some(st) = store {
            for n in st.nodes_where("path = ?1 AND kind != 'file' AND kind != 'package'", rusqlite::params![path]).unwrap_or_default() {
                let v = self.decide(path, Some(&n.name), holds);
                if v.level > best.level {
                    best = v;
                }
            }
        }
        best
    }

    /// Exact edit verdict for a file whose changed hunks are known to touch
    /// these symbols (names from the graph). Unchanged by symbol rules when
    /// the edit falls between symbols.
    pub fn edit_touched(&self, store: Option<&Store>, path: &str, symbols: &[String]) -> Verdict {
        let holds = match (&self.task, store) {
            (Some((_, _, syms)), Some(st)) if !syms.is_empty() => syms
                .iter()
                .any(|s| st.nodes_where("name = ?1 AND path = ?2", rusqlite::params![s, path]).map(|h| !h.is_empty()).unwrap_or(false)),
            _ => false,
        };
        let mut best = self.decide(path, None, holds);
        for s in symbols {
            let v = self.decide(path, Some(s), holds);
            if v.level > best.level {
                best = v;
                // A bare name fences every definition of it; say so.
                if let Some(st) = store {
                    if let Some(pat) = self.rules.iter().find(|c| c.rule.symbols.iter().any(|x| !x.contains(':') && x == s)) {
                        let n = st
                            .nodes_where("name = ?1 AND kind != 'file' AND kind != 'package'", rusqlite::params![s])
                            .map(|h| h.len())
                            .unwrap_or(0);
                        if n > 1 {
                            best.reason = format!("{} – the bare name {s:?} in {} fences all {n} definitions", best.reason, pat.source);
                        }
                    }
                }
            }
        }
        best
    }
}

/// Symbols whose spans the hunks of a `git diff -U0 …` touch: the names the
/// graph holds for each changed file, hit-tested against the changed lines.
pub fn diff_symbols(repo: &Repo, store: &Store, diff_args: &[&str]) -> Vec<(String, Vec<String>)> {
    let Ok(patch) = repo.run(diff_args) else { return vec![] };
    let mut cur = String::new();
    let mut ranges: std::collections::HashMap<String, Vec<(u32, u32)>> = Default::default();
    for line in patch.lines() {
        if let Some(p) = line.strip_prefix("+++ b/") {
            cur = p.to_string();
        } else if line.starts_with("@@") {
            if let Some(plus) = line.split_whitespace().find(|t| t.starts_with('+')) {
                let t = &plus[1..];
                let mut it = t.split(',');
                let start: u32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                let len: u32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(1);
                ranges.entry(cur.clone()).or_default().push((start, start + len.max(1) - 1));
            }
        }
    }
    ranges
        .into_iter()
        .map(|(path, rs)| {
            let names: Vec<String> = store
                .nodes_where("path = ?1 AND kind != 'file' AND kind != 'package'", rusqlite::params![path])
                .unwrap_or_default()
                .into_iter()
                .filter(|n| rs.iter().any(|(a, b)| (*a as i64) <= n.end_line && (*b as i64) >= n.start_line))
                .map(|n| n.name)
                .collect();
            (path, names)
        })
        .collect()
}

/// Every path in this checkout whose edit is forbidden: locked, hidden or
/// outside the task's scope. For refusing shell commands that touch them
/// indirectly (patches, resets, finds).
pub fn fenced_paths(repo: &Repo, g: &Guards, store: Option<&Store>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<String> = Vec::new();
    let mut check = |p: String, out: &mut Vec<String>| {
        let p = p.trim_start_matches("./").to_string();
        if seen.insert(p.clone()) && !g.edit(store, &p).level.editable() {
            out.push(p);
        }
    };
    if let Ok(ls) = repo.run(&["ls-files", "-z"]) {
        ls.split('\0').filter(|p| !p.is_empty()).for_each(|p| check(p.to_string(), &mut out));
    }
    if let Ok(fs) = repo.status() {
        for f in fs {
            check(f.path, &mut out);
        }
    }
    out
}

/// The paths agents may not even read (likely secrets).
pub fn hidden_paths(repo: &Repo, g: &Guards) -> Vec<String> {
    fenced_paths(repo, g, None).into_iter().filter(|p| g.path(p).level == Level::Hidden).collect()
}

// ------------------------------------------------------------------ session marker

/// How long a stamped agent session stays valid, in seconds.
const SESSION_TTL: i64 = 1800;

fn session_path(repo: &Repo) -> std::path::PathBuf {
    let rel = repo.run(&["rev-parse", "--git-path", "kula"]).unwrap_or_default();
    let p = std::path::PathBuf::from(rel.trim());
    let base = if p.is_absolute() { p } else { repo.root.join(p) };
    // --git-path kula names kula's directory under .git; the marker lives in it.
    if rel.trim().is_empty() {
        repo.root.join(".git").join("kula").join("session")
    } else {
        base.join("session")
    }
}

/// Stamp that an agent was here: a short-lived marker under `.git/kula`.
/// The pre-commit hook honours it, so identity survives a shell whose agent
/// environment was scrubbed. It is a speed bump, not a sandbox: anyone can
/// write the file, and it expires in {SESSION_TTL} s.
pub fn session_stamp(repo: &Repo, agent: &str) {
    let p = session_path(repo);
    if let Some(d) = p.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    let _ = std::fs::write(p, serde_json::json!({ "agent": agent, "at": crate::meta::now() }).to_string());
}

/// The agent of a fresh session marker, if one is stamped.
pub fn session_agent(repo: &Repo) -> Option<String> {
    let p = session_path(repo);
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()?;
    let at = v["at"].as_i64()?;
    (crate::meta::now() - at < SESSION_TTL).then(|| v["agent"].as_str().unwrap_or("agent").to_string())
}

/// Identity vars a shell command must not set, unset or scrub.
const IDENTITY_VARS: &[&str] = &["KULA_AGENT", "CLAUDECODE", "CURSOR_AGENT", "CODEX_SANDBOX", "GEMINI_CLI"];

/// One extra refusal layer over `agents::shell_targets`: the bypasses the
/// denylist tokenizer cannot see. `fenced` and `hidden` are repo-relative
/// paths (empty in an unfenced repo, where nothing is refused). Returns why
/// the command is refused, or extra write targets it hides.
pub fn shell_guard(cmd: &str, cwd_rel: &str, fenced: &[String], hidden: &[String]) -> (Vec<String>, Option<String>) {
    let mut extra = vec![];
    if fenced.is_empty() && hidden.is_empty() {
        return (extra, None);
    }
    let refuse = |why: &str| Some(format!("kula guard: refused – {why}."));
    // eval, command substitution, backticks: what they run is anything.
    let unquoted: String = cmd.chars().filter(|c| *c != '\'' && *c != '"').collect();
    if words(&unquoted).iter().any(|w| w == "eval") {
        return (extra, refuse("`eval` runs anything, fences included"));
    }
    if cmd.contains("$(") || cmd.contains('`') {
        return (extra, refuse("command substitution runs what the fence cannot see"));
    }
    // segments split on ; && || and newlines, each with its own cwd
    let mut cd = cwd_rel.trim_matches('/').to_string();
    let mut vars: std::collections::HashMap<String, String> = Default::default();
    for seg in unquoted.split([';', '\n']).flat_map(|s| s.split("&&")).map(str::trim).filter(|s| !s.is_empty()) {
        let ws = words(seg);
        let mut k = 0;
        // assignments and identity scrubbing
        while k < ws.len() {
            let w = &ws[k];
            if w.contains('=') && w.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') && !w.contains('/') {
                if let Some((n, v)) = w.split_once('=') {
                    if IDENTITY_VARS.contains(&n) {
                        return (extra, refuse("an agent does not decide whether it is an agent – identity vars are not yours to set"));
                    }
                    vars.insert(n.to_string(), v.to_string());
                }
                k += 1;
            } else if w == "unset" {
                if let Some(n) = ws.get(k + 1) {
                    if IDENTITY_VARS.contains(&n.as_str()) {
                        return (extra, refuse("an agent does not decide whether it is an agent – identity vars are not yours to unset"));
                    }
                }
                break;
            } else {
                break;
            }
        }
        let ws = &ws[k.min(ws.len())..];
        let Some(name) = ws.first().map(|w| w.rsplit('/').next().unwrap_or(w)) else { continue };
        // `cd` before a write: the target's cwd is where it lands
        let is_cd = name == "cd";
        if is_cd {
            if let Some(d) = ws.get(1) {
                cd = expand(d, &vars, cwd_rel);
            }
            continue;
        }
        if name == "env" {
            for (i, w) in ws.iter().enumerate() {
                if w == "-u" && ws.get(i + 1).is_some_and(|n| IDENTITY_VARS.contains(&n.as_str())) {
                    return (extra, refuse("an agent does not decide whether it is an agent – identity vars are not yours to unset"));
                }
            }
        }
        // heredoc-fed interpreters
        if seg.contains("<<") && matches!(name, "python" | "python3" | "node" | "ruby" | "perl" | "php" | "sh" | "bash" | "zsh" | "awk") {
            return (extra, refuse("a heredoc script can write anything"));
        }
        // `awk -i inplace` edits files in place
        let writes = name == "awk" && (ws.iter().any(|w| w == "-i") || ws.iter().any(|w| w == "inplace"));
        if name == "git" {
            let args: Vec<&str> = ws.iter().skip(1).map(String::as_str).collect();
            if let Some(why) = git_guard(&args, &mut cd, &vars, cwd_rel, fenced, hidden, &mut extra) {
                return (extra, Some(why));
            }
            continue;
        }
        if (name == "chmod" || name == "chown") && ws.iter().any(|w| w.contains(".git/hooks") || w.contains(".git/kula")) {
            return (extra, refuse("kula's git hooks are a person's to change"));
        }
        if name == "find" {
            if ws.iter().any(|w| w == "-delete") {
                let from: Vec<&str> = ws.iter().skip(1).take_while(|w| !w.starts_with('-')).map(String::as_str).collect();
                let roots: Vec<String> =
                    if from.is_empty() { vec![cd.clone()] } else { from.iter().map(|f| join_rel(cd.as_str(), f)).collect() };
                if fenced.iter().any(|f| roots.iter().any(|r| !r.is_empty() && (f.starts_with(r) || r.starts_with(f.as_str())))) {
                    return (extra, refuse("`find -delete` would remove fenced files"));
                }
            }
            continue;
        }
        if name == "patch" {
            // `patch -p1 < diff`: the diff's own paths are its targets
            if let Some(f) = input_target(seg) {
                match std::fs::read_to_string(&f) {
                    Ok(diff) => {
                        for line in diff.lines() {
                            if let Some(p) = line.strip_prefix("+++ b/").or_else(|| line.strip_prefix("+++ ./")) {
                                if let Some(why) = check_target(p.trim_end_matches('\t').trim(), &cd, &vars, cwd_rel, fenced, &mut extra) {
                                    return (extra, Some(why));
                                }
                            }
                        }
                    }
                    Err(_) => {
                        return (
                            extra,
                            refuse(
                                format!("cannot resolve what `{f}` would patch – apply it as a person, or move it inside a task's scope")
                                    .as_str(),
                            ),
                        );
                    }
                }
            }
            continue;
        }
        if name == "git" {
            continue;
        }
        // redirections in this segment: > and >> targets
        if let Some(t) = redirect_target(seg) {
            if let Some(why) = check_target(&t, &cd, &vars, cwd_rel, fenced, &mut extra) {
                return (extra, Some(why));
            }
        }
        if writes {
            let files: Vec<&str> = ws.iter().skip(1).filter(|w| !w.starts_with('-')).map(String::as_str).collect();
            for f in files {
                if let Some(why) = check_target(f, &cd, &vars, cwd_rel, fenced, &mut extra) {
                    return (extra, Some(why));
                }
            }
        }
        let _ = name;
    }
    (extra, None)
}

/// `git …` within `shell_guard`: the subcommands that rewrite history or trees
/// behind the fences, and reads of hidden paths.
fn git_guard(
    args: &[&str],
    cd: &mut str,
    vars: &std::collections::HashMap<String, String>,
    cwd: &str,
    fenced: &[String],
    hidden: &[String],
    extra: &mut Vec<String>,
) -> Option<String> {
    let refuse = |why: &str| Some(format!("kula guard: refused – {why}."));
    let sub = args.first().copied().unwrap_or("");
    // -c core.hooksPath=…, abbreviated --no-verify
    for (i, a) in args.iter().enumerate() {
        let val = if *a == "-c" { args.get(i + 1).copied().unwrap_or("") } else { a.strip_prefix("-c").unwrap_or(a) };
        if (a.starts_with("-c") || *a == "-c") && val.contains("hooksPath") {
            return refuse("`git -c core.hooksPath` would switch kula's pre-commit fence check off");
        }
        if a.starts_with("--no-v") {
            return refuse("`git commit --no-verify` (or its abbreviation) skips kula's pre-commit fence check");
        }
        let _ = val;
    }
    // update-ref on kula's own refs (memories, issues, meta)
    if sub == "update-ref" && args.iter().any(|a| a.contains("refs/kula/")) {
        return refuse("`git update-ref refs/kula/…` would wipe kula's memories, issues and notes");
    }
    // reads of hidden paths through revisions
    if matches!(sub, "show" | "log" | "cat-file" | "rev-parse" | "diff") {
        for a in args {
            if let Some((_, p)) = a.split_once(':') {
                let p = p.trim_start_matches("./");
                if !p.is_empty() && hidden.iter().any(|h| h == p || h.ends_with(&format!("/{p}"))) {
                    return refuse("that revision path is hidden from agents (likely a secret) – `git show rev:path` is a read too");
                }
            }
        }
    }
    match sub {
        "apply" | "am" => {
            for a in args.iter().skip(1) {
                if a.starts_with('-') || a.is_empty() {
                    continue;
                }
                // a patch's own paths are its targets; unreadable patches stay unread
                match std::fs::read_to_string(a) {
                    Ok(diff) => {
                        for line in diff.lines() {
                            if let Some(p) = line.strip_prefix("+++ b/").or_else(|| line.strip_prefix("+++ ./")) {
                                if let Some(why) = check_target(p.trim_end_matches('\t').trim(), cd, vars, cwd, fenced, extra) {
                                    return Some(why);
                                }
                            }
                        }
                    }
                    Err(_) => {
                        if !fenced.is_empty() {
                            return refuse(
                                format!("cannot resolve what `{a}` would patch – apply it as a person, or move it inside a task's scope")
                                    .as_str(),
                            );
                        }
                    }
                }
            }
        }
        "stash" | "reset" => {
            if !fenced.is_empty() {
                return refuse("`git stash` / `git reset --hard` rewrite the working tree wholesale – fenced files included");
            }
        }
        "checkout" | "restore" => {
            let paths: Vec<&str> = args.iter().skip(1).filter(|a| !a.starts_with('-')).map(|a| a.trim_start_matches("-- ")).collect();
            for p in paths {
                let full = join_rel(cd, expand(p, vars, cwd).as_str());
                if fenced.iter().any(|f| *f == full || f.starts_with(&format!("{full}/"))) {
                    return refuse(format!("`git {sub}` would overwrite fenced file(s) under {full}").as_str());
                }
            }
        }
        _ => {}
    }
    None
}

fn expand(w: &str, vars: &std::collections::HashMap<String, String>, _cwd: &str) -> String {
    let mut s = w.to_string();
    for (k, v) in vars {
        s = s.replace(&format!("${k}"), v).replace(&format!("${{{k}}}"), v);
    }
    s
}

fn join_rel(base: &str, p: &str) -> String {
    let p = p.trim_start_matches("./");
    if p.starts_with('/') {
        return p.trim_start_matches('/').to_string();
    }
    let mut parts: Vec<&str> = vec![];
    let base_parts = base.trim_matches('/');
    if !base_parts.is_empty() && base_parts != "." {
        parts.extend(base_parts.split('/'));
    }
    for c in p.split('/') {
        match c {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

fn words(cmd: &str) -> Vec<String> {
    let mut out = vec![];
    let mut w = String::new();
    for c in cmd.chars() {
        // whitespace and shell separators both end a word
        if c.is_whitespace() || matches!(c, '|' | '&' | '(' | ')') {
            if !w.is_empty() {
                out.push(std::mem::take(&mut w));
            }
        } else {
            w.push(c);
        }
    }
    if !w.is_empty() {
        out.push(w);
    }
    out
}

/// The file a `>` or `>>` in one segment writes, if it is a plain word.
fn redirect_target(seg: &str) -> Option<String> {
    let bytes: Vec<char> = seg.chars().collect();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            '\'' | '"' => {
                let q = bytes[i];
                i += 1;
                while i < bytes.len() && bytes[i] != q {
                    i += 1;
                }
            }
            '>' => {
                let mut j = i + 1;
                if bytes.get(j) == Some(&'>') {
                    j += 1;
                }
                // a leading fd number (2>) belongs to the redirection; >&2 goes nowhere
                while j < bytes.len() && bytes[j].is_ascii_digit() {
                    j += 1;
                }
                if bytes.get(j) == Some(&'&') {
                    return None;
                }
                while j < bytes.len() && bytes[j].is_whitespace() {
                    j += 1;
                }
                let mut t = String::new();
                while j < bytes.len() && !bytes[j].is_whitespace() && bytes[j] != ';' {
                    t.push(bytes[j]);
                    j += 1;
                }
                let t = t.trim_matches(['"', '\'']).to_string();
                if !t.is_empty() && t != "/dev/null" && !t.starts_with("/dev/") {
                    return Some(t);
                }
                return None;
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// The file a `<` in one segment feeds from, if it is a plain word (not a heredoc).
fn input_target(seg: &str) -> Option<String> {
    let bytes: Vec<char> = seg.chars().collect();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            '\'' | '"' => {
                let q = bytes[i];
                i += 1;
                while i < bytes.len() && bytes[i] != q {
                    i += 1;
                }
            }
            '<' => {
                if bytes.get(i + 1) == Some(&'<') {
                    return None; // heredoc, not a file
                }
                let mut j = i + 1;
                while j < bytes.len() && bytes[j].is_ascii_digit() {
                    j += 1;
                }
                while j < bytes.len() && bytes[j].is_whitespace() {
                    j += 1;
                }
                let mut t = String::new();
                while j < bytes.len() && !bytes[j].is_whitespace() && bytes[j] != ';' {
                    t.push(bytes[j]);
                    j += 1;
                }
                let t = t.trim_matches(['"', '\'']).to_string();
                if !t.is_empty() {
                    return Some(t);
                }
                return None;
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn check_target(
    t: &str,
    cd: &str,
    vars: &std::collections::HashMap<String, String>,
    cwd: &str,
    fenced: &[String],
    extra: &mut Vec<String>,
) -> Option<String> {
    let expanded = expand(t, vars, cwd);
    if expanded.contains('$') || expanded.contains('`') {
        return Some(format!(
            "kula guard: refused – the write target {t:?} does not resolve to a path in this fenced repository (variable or command substitution)."
        ));
    }
    if expanded.starts_with('/') || expanded.starts_with('~') {
        return None; // outside this repository: not ours to fence
    }
    let full = join_rel(cd, &expanded);
    if fenced.iter().any(|f| *f == full || f.starts_with(&format!("{full}/")) || full.starts_with(&format!("{f}/"))) {
        return Some(format!("kula guard: refused – {full} is fenced for agents."));
    }
    extra.push(full.clone());
    None
}

/// Every guarded file in the graph, with its verdict: for `kula guard` and the UI.
pub fn guarded_files(repo: &Repo, store: &Store) -> Result<Vec<(String, Verdict)>> {
    let g = Guards::load(repo)?;
    let mut out = vec![];
    for n in store.nodes_where("kind = 'file' ORDER BY path", [])? {
        let v = g.path(&n.path);
        if v.level != Level::Open {
            out.push((n.path, v));
        }
    }
    Ok(out)
}

/// Check paths for an agent edit: those whose verdict forbids editing. With
/// the symbols each path's changed hunks touch: symbol rules are enforced
/// exactly, not only at file level.
pub fn violations_with(
    repo: &Repo,
    store: Option<&Store>,
    paths: &[(String, Vec<String>)],
    agent: Option<&str>,
) -> Result<Vec<(String, Verdict)>> {
    let g = Guards::for_agent(repo, agent)?;
    Ok(paths.iter().map(|(p, syms)| (p.clone(), g.edit_touched(store, p, syms))).filter(|(_, v)| !v.level.editable()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn guards(toml: &str, task: Option<Task>) -> Guards {
        Guards::new(&toml::from_str::<Config>(toml).unwrap(), task).unwrap()
    }

    #[test]
    fn levels_rules_secrets_and_scope() {
        let g = guards(
            r#"
            [[guard]]
            paths = ["migrations"]
            level = "locked"
            reason = "schema changes go through the DBA"
            [[guard]]
            paths = ["src/billing/**"]
            symbols = ["charge"]
            level = "review"
            [[guard]]
            symbols = ["src/auth.rs:token"]
            level = "hidden"
            "#,
            None,
        );
        assert_eq!(g.path("migrations/001.sql").level, Level::Locked);
        assert_eq!(g.path("migrations/001.sql").reason, "schema changes go through the DBA");
        assert_eq!(g.path("src/billing/pay.rs").level, Level::Review);
        assert_eq!(g.path("src/main.rs").level, Level::Open);
        assert_eq!(g.path("config/.env").level, Level::Hidden);
        assert_eq!(g.path(".env.local").level, Level::Hidden);
        let node = |name: &str, path: &str| Node {
            id: 1,
            kind: "function".into(),
            name: name.into(),
            path: path.into(),
            lang: "rust".into(),
            start_line: 1,
            end_line: 2,
            parent: None,
            community: 0,
        };
        assert_eq!(g.node(&node("charge", "src/pay.rs")).level, Level::Review);
        assert_eq!(g.node(&node("token", "src/auth.rs")).level, Level::Hidden);
        assert_eq!(g.node(&node("token", "src/other.rs")).level, Level::Open);

        let t = Task {
            title: "fix login".into(),
            scope: vec!["src/auth/**".into(), "login".into()],
            started: 0,
            by: "a".into(),
            workflow: "".into(),
        };
        let g = guards("", Some(t));
        assert_eq!(g.path("src/auth/session.rs").level, Level::Open);
        assert_eq!(g.path("src/db.rs").level, Level::Scope);
        assert_eq!(g.node(&node("login", "src/web.rs")).level, Level::Open);
        assert!(!Level::Scope.editable() && Level::Scope.readable());
        assert!(!Level::Hidden.readable());
    }

    #[test]
    fn workflows_bring_their_own_fences() {
        let t = |wf: &str| Some(Task { title: "t".into(), scope: vec![], started: 0, by: "a".into(), workflow: wf.into() });
        let g = guards("", t("refactor"));
        assert_eq!(g.path("tests/cli.rs").level, Level::Locked);
        assert_eq!(g.path("web/src/a.test.ts").level, Level::Locked);
        assert_eq!(g.path("src/main.rs").level, Level::Open);
        assert_eq!(g.path("tests/cli.rs").rule, "workflow refactor");
        assert!(g.rules().is_empty() && !g.workflow_rules().is_empty());
        let g = guards("", t("explore"));
        assert_eq!(g.path("src/main.rs").level, Level::Locked);
        let g = guards("[[workflow]]\nname = \"db\"\nhide = [\"data/**\"]\nreview = [\"charge\"]\n", t("db"));
        assert_eq!(g.path("data/x.csv").level, Level::Hidden);
        let n = Node {
            id: 1,
            kind: "function".into(),
            name: "charge".into(),
            path: "a.rs".into(),
            lang: "rust".into(),
            start_line: 1,
            end_line: 2,
            parent: None,
            community: 0,
        };
        assert_eq!(g.node(&n).level, Level::Review);
    }

    #[test]
    fn kula_config_is_always_locked() {
        let g = guards("", None);
        for p in ["kula.toml", ".kula/task.json", ".claude/settings.json", ".cursor/hooks.json", ".git/hooks/pre-commit", ".mcp.json"] {
            assert_eq!(g.path(p).level, Level::Locked, "{p}");
            assert_eq!(g.path(p).rule, "kula");
        }
        assert_eq!(g.path("src/kula.rs").level, Level::Open);
    }

    #[test]
    fn secrets_can_be_shown() {
        let g = guards("[agents]\nhide_secrets = false\n", None);
        assert_eq!(g.path(".env").level, Level::Open);
    }
}

#[cfg(test)]
mod shell_guard_tests {
    use super::*;

    fn f(s: &str) -> String {
        s.to_string()
    }

    #[test]
    fn shell_guard_catches_the_critique_matrix() {
        let fenced = vec![f("tests/login.test.ts")];
        for cmd in [
            "cd tests && echo x > test_pay.py",
            "eval \"echo x > tests/login.test.ts\"",
            "T=tests; echo x > $T/login.test.ts",
            "echo x > $NOWHERE/test_pay.py",
            "git checkout HEAD -- tests",
            "git stash",
            "find tests -name '*.py' -delete",
            "git update-ref -d refs/kula/meta",
            "git show HEAD:.env",
            "git commit -am x --no-verif",
            "chmod -x .git/hooks/pre-commit",
            "unset KULA_AGENT; git commit",
        ] {
            let hidden = if cmd.contains(".env") { vec![f(".env")] } else { vec![] };
            let (more, why) = shell_guard(cmd, "", &fenced, &hidden);
            assert!(why.is_some() || !more.is_empty(), "{cmd} -> no refusal, no extra targets");
        }
        assert!(shell_guard("cat tests/login.test.ts | grep -n salt", "", &fenced, &[]).1.is_none());
    }
}
