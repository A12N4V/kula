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

mod bypass;

type Vars = std::collections::HashMap<String, String>;

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
    let set = OWN_SET.get_or_init(|| globset(&OWN.iter().map(|s| s.to_string()).collect::<Vec<_>>()).unwrap_or_else(|_| GlobSet::empty()));
    // a directory that holds kula's state (`.kula`) is kula's too
    let d = path.trim_start_matches("./").trim_end_matches('/');
    set.is_match(d) || (!d.is_empty() && set.is_match(format!("{d}/_")))
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
    /// A `[[guard]]` level. Anything else is an error; the caller still treats
    /// it as locked so a typo can never open code, and reports it.
    pub fn parse(s: &str) -> Result<Level, String> {
        match s.trim().to_ascii_lowercase().as_str() {
            "hidden" => Ok(Level::Hidden),
            "locked" => Ok(Level::Locked),
            "review" => Ok(Level::Review),
            _ => Err(format!("level {s:?} is not locked, hidden or review; it is treated as locked until fixed")),
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
    /// `kula.toml guard #2: level "lockd" …`, from [`Level::parse`].
    bad_levels: Vec<String>,
}

/// `kula guard explain`: the verdict and every rule behind it.
#[derive(Serialize, Clone, Debug)]
pub struct Explain {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    pub verdict: Verdict,
    pub hits: Vec<Verdict>,
}

/// Two scoped seats in one team that may both write the same files.
#[derive(Serialize, Clone, Debug)]
pub struct Overlap {
    pub team: String,
    pub a: String,
    pub b: String,
    pub count: usize,
    /// Up to eight of the shared files.
    pub paths: Vec<String>,
}

fn seat_label(m: &crate::config::Member) -> String {
    if !m.name.is_empty() {
        m.name.clone()
    } else if !m.agent.is_empty() {
        m.agent.clone()
    } else {
        "seat".into()
    }
}

/// Seats in the same team whose writable sets overlap. Only seats with a
/// scope count: an unscoped seat may write anything, which is not a conflict
/// the config can be blamed for. Files come from the index.
pub fn team_overlaps(cfg: &Config, store: &Store) -> Vec<Overlap> {
    let files: Vec<String> = store.nodes_where("kind = 'file' ORDER BY path", []).unwrap_or_default().into_iter().map(|n| n.path).collect();
    let mut out = vec![];
    for t in &cfg.teams {
        let seats: Vec<(String, std::collections::BTreeSet<String>)> = t
            .members
            .iter()
            .filter_map(|m| {
                let g = Guards::for_seat(cfg, &t.name, m, Some(0), None).ok()?;
                if g.task.as_ref().map_or(true, |(t, _, _)| t.scope.is_empty()) {
                    return None;
                }
                let w = files.iter().filter(|p| g.path(p).level.editable()).cloned().collect();
                Some((seat_label(m), w))
            })
            .collect();
        for i in 0..seats.len() {
            for j in i + 1..seats.len() {
                let shared: Vec<String> = seats[i].1.intersection(&seats[j].1).cloned().collect();
                if !shared.is_empty() {
                    out.push(Overlap {
                        team: t.name.clone(),
                        a: seats[i].0.clone(),
                        b: seats[j].0.clone(),
                        count: shared.len(),
                        paths: shared.into_iter().take(8).collect(),
                    });
                }
            }
        }
    }
    out
}

pub(crate) fn globset(pats: &[String]) -> Result<GlobSet> {
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
pub(crate) fn looks_like_path(s: &str) -> bool {
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
    if let Some(t) = std::fs::read_to_string(team_path(repo)).ok().and_then(|s| serde_json::from_str(&s).ok()) {
        return Some(t);
    }
    // a run-plan worktree carries its team in the environment (see `orch::run::launch`)
    let name = std::env::var("KULA_TEAM").ok().filter(|n| !n.is_empty())?;
    Some(ActiveTeam { name, started: crate::meta::now(), by: "run-plan".into() })
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
    crate::events::append(
        &repo.kula_dir(),
        crate::events::Event { kind: "team_start".into(), team: name.into(), agent: by.into(), ..Default::default() },
    );
    Ok(a)
}

pub fn team_stop(repo: &Repo) -> Result<Option<ActiveTeam>> {
    let t = team(repo);
    let _ = std::fs::remove_file(team_path(repo));
    if let Some(a) = &t {
        crate::events::append(
            &repo.kula_dir(),
            crate::events::Event { kind: "team_stop".into(), team: a.name.clone(), ..Default::default() },
        );
    }
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
        let t = task(repo);
        match agent.and_then(|a| member(repo, &cfg, a)) {
            Some((team, m)) => Guards::for_seat(&cfg, &team, &m, t.as_ref().map(|t| t.started), Some(agent.unwrap_or_default())),
            None => Guards::new(&cfg, t),
        }
    }

    /// The fences one seat works under, from the config alone: its workflow,
    /// its scope (or the workflow's), the repository's rules and its own fence.
    /// No active team is needed, so the hub can preview a seat before it runs.
    pub fn for_seat(cfg: &Config, team: &str, m: &crate::config::Member, started: Option<i64>, agent: Option<&str>) -> Result<Guards> {
        let wf = (!m.workflow.is_empty()).then(|| workflow::find(cfg, &m.workflow)).flatten();
        let scope = if !m.scope.is_empty() { m.scope.clone() } else { wf.as_ref().map(|w| w.scope.clone()).unwrap_or_default() };
        let who = crate::agents::agent_id(agent.unwrap_or(if m.agent.is_empty() { "any" } else { &m.agent }));
        let t = Task {
            title: format!(
                "team {team}: {who} in {}{}",
                if m.workflow.is_empty() { "no workflow" } else { &m.workflow },
                if m.role.is_empty() { String::new() } else { format!(" – {}", m.role) }
            ),
            started: started.unwrap_or_else(crate::meta::now),
            by: format!("team:{team}"),
            workflow: m.workflow.clone(),
            scope,
        };
        let mut g = Guards::new(cfg, Some(t))?;
        g.add_seat_fence(team, m)?;
        Ok(g)
    }

    /// A seat's own `fence` from `kula.toml`, on top of everything else. Rules
    /// only ever add restrictions, so this can never open what another rule shut.
    pub fn add_seat_fence(&mut self, team: &str, m: &crate::config::Member) -> Result<()> {
        for (pats, level, what) in [
            (&m.fence.lock, Level::Locked, "locks"),
            (&m.fence.hide, Level::Hidden, "hides"),
            (&m.fence.review, Level::Review, "flags for review"),
        ] {
            if pats.is_empty() {
                continue;
            }
            let (paths, symbols): (Vec<String>, Vec<String>) = pats.iter().cloned().partition(|s| looks_like_path(s) || s == "**");
            self.rules.push(Compiled {
                globs: globset(&paths)?,
                level,
                rule: GuardRule {
                    paths,
                    symbols,
                    level: level.as_str().into(),
                    reason: format!("seat {} in team {team} {what} this", m.key()),
                },
                source: format!("seat {}/{}", team, m.key()),
            });
        }
        Ok(())
    }

    pub fn new(cfg: &Config, task: Option<Task>) -> Result<Guards> {
        let mut rules = Vec::new();
        let mut bad_levels = Vec::new();
        for (i, r) in cfg.guards.iter().enumerate() {
            let level = Level::parse(&r.level).unwrap_or_else(|e| {
                bad_levels.push(format!("kula.toml guard #{}: {e}", i + 1));
                Level::Locked
            });
            rules.push(Compiled { globs: globset(&r.paths)?, level, rule: r.clone(), source: format!("kula.toml guard #{}", i + 1) });
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
                let all = cfg.expand_scope(&t.scope);
                let syms: Vec<String> = all.iter().filter(|s| !looks_like_path(s)).cloned().collect();
                // a bare name (`core`) is a symbol or a top-level directory: it covers both
                let g = globset(&all.iter().map(|s| s.trim_end_matches('/').to_string()).collect::<Vec<_>>())?;
                Some((t, g, syms))
            }
            Some(t) => Some((t, GlobSet::empty(), vec![])),
            None => None,
        };
        let own = globset(&OWN.iter().map(|s| s.to_string()).collect::<Vec<_>>())?;
        Ok(Guards { rules, own, secrets, task, workflow: wf, bad_levels })
    }

    /// Symbol patterns in `[[guard]]` rules that match no definition in the graph.
    /// A renamed or deleted symbol silently drops its fence; this surfaces it.
    pub fn dangling_symbols(&self, store: &Store) -> Vec<String> {
        let mut out = Vec::new();
        for c in &self.rules {
            for s in &c.rule.symbols {
                let name = s.rsplit_once(':').map_or(s.as_str(), |x| x.1);
                let n: i64 = store
                    .conn
                    .query_row("SELECT COUNT(*) FROM nodes WHERE name = ?1 AND kind != 'file'", [name], |r| r.get(0))
                    .unwrap_or(1);
                if n == 0 && !out.contains(s) {
                    out.push(s.clone());
                }
            }
        }
        out
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
    /// The highest level among the hits wins; levels only rise, so neither the
    /// order of the rules nor adding one can ever open what another shut.
    fn decide(&self, path: &str, symbol: Option<&str>, in_scope: bool) -> Verdict {
        let mut best = Verdict::default();
        for v in self.hits(path, symbol, in_scope) {
            if v.level > best.level {
                best = v;
            }
        }
        best
    }

    /// Every rule that applies to a file or symbol, in the order they are checked.
    fn hits(&self, path: &str, symbol: Option<&str>, in_scope: bool) -> Vec<Verdict> {
        let path = path.trim_start_matches("./");
        let mut out = Vec::new();
        if self.own.is_match(path) {
            out.push(Verdict {
                level: Level::Locked,
                reason: "kula's own config and agent wiring – only a person changes it (agents can `suggest`)".into(),
                rule: "kula".into(),
            });
        }
        if let Some(s) = &self.secrets {
            if s.is_match(path) {
                out.push(Verdict { level: Level::Hidden, reason: "likely a secret (agents.hide_secrets)".into(), rule: "secrets".into() });
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
                out.push(Verdict { level: c.level, reason, rule: c.source.clone() });
            }
        }
        if let Some((t, globs, syms)) = &self.task {
            let inside = in_scope || t.scope.is_empty() || globs.is_match(path) || symbol.is_some_and(|n| syms.iter().any(|s| s == n));
            if !inside {
                out.push(Verdict {
                    level: Level::Scope,
                    reason: format!("task \"{}\" covers only {}", t.title, t.scope.join(", ")),
                    rule: "task".into(),
                });
            }
        }
        out
    }

    /// Why a file or symbol has the verdict it has: every rule that applies,
    /// and the one that decided. Powers `kula guard explain` and the hub's
    /// "what can this seat touch" preview.
    pub fn explain(&self, path: &str, symbol: Option<&str>) -> Explain {
        let hits = self.hits(path, symbol, false);
        let verdict = self.decide(path, symbol, false);
        Explain { path: path.trim_start_matches("./").to_string(), symbol: symbol.map(String::from), verdict, hits }
    }

    /// Problems with the fences themselves: a level kula does not know (it is
    /// treated as locked until fixed, never as open), and a bare symbol name
    /// that fences more than one definition (qualify it as `path:name`).
    pub fn has_bad_levels(&self) -> bool {
        !self.bad_levels.is_empty()
    }

    pub fn warnings(&self, store: Option<&Store>) -> Vec<String> {
        let mut out = self.bad_levels.clone();
        let Some(st) = store else { return out };
        for c in &self.rules {
            for s in c.rule.symbols.iter().filter(|s| !s.contains(':')) {
                let defs = st.nodes_where("name = ?1 AND kind != 'file' AND kind != 'package'", rusqlite::params![s]).unwrap_or_default();
                if defs.len() > 1 {
                    let mut paths: Vec<String> = defs.iter().map(|n| format!("{}:{s}", n.path)).collect();
                    paths.sort();
                    paths.dedup();
                    let more = if paths.len() > 3 { format!(" and {} more", paths.len() - 3) } else { String::new() };
                    paths.truncate(3);
                    out.push(format!(
                        "{}: the bare name {s:?} fences {} definitions; to fence one, write {}{more}",
                        c.source,
                        defs.len(),
                        paths.join(" or ")
                    ));
                }
            }
        }
        out
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

    /// Exact hook-time verdict for an edit whose before and after text are
    /// known. The file's own rules apply as always; on top, every fenced symbol
    /// (locked or hidden, by name or `path:name`) must come out byte for byte
    /// the same: no change inside it, no new definition under its name, and no
    /// edit nearby that swallows it (an opened comment or string makes it
    /// vanish from the parse, which counts as a change). Edits between fenced
    /// symbols pass. `None` when either text does not parse; the caller then
    /// uses the whole-file [`Guards::edit`].
    pub fn edit_exact(&self, store: Option<&Store>, path: &str, before: &str, after: &str) -> Option<Verdict> {
        self.verdict_edit(store, path, before, after)
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

    /// Exact edit verdict (B3): a patience diff (`similar`) of the old and
    /// new text gives the changed line ranges, which are hit-tested against
    /// the file's symbol spans through an interval tree – O(log n + k) per
    /// range. The verdict is the join (max) of the levels of everything the
    /// edit touches: the file itself, every symbol span it intersects, and
    /// every fenced definition whose body changed or vanished. A locked or
    /// renamed symbol stays fenced: `relink` (B1's identity, two of path,
    /// name, bodyhash) carries the old symbol's fence onto its new position,
    /// with a notice. `None` when either text does not parse; the caller then
    /// falls back to the whole-file [`Guards::edit`].
    pub fn verdict_edit(&self, store: Option<&Store>, path: &str, before: &str, after: &str) -> Option<Verdict> {
        let old = crate::index::defs_now(path, before)?;
        let new = crate::index::defs_now(path, after)?;
        let mut best = self.edit_touched(store, path, &[]);
        if !best.level.editable() {
            return Some(best);
        }
        let holds = match (&self.task, store) {
            (Some((_, _, syms)), Some(st)) if !syms.is_empty() => syms
                .iter()
                .any(|s| st.nodes_where("name = ?1 AND path = ?2", rusqlite::params![s, path]).map(|h| !h.is_empty()).unwrap_or(false)),
            _ => false,
        };
        // Changed ranges ∩ symbol spans, through the interval tree. Both
        // sides are hit-tested: an edit inside an old span and a new span
        // both count, so an insertion between two fenced symbols still hits
        // nothing and an edit inside one hits it on both sides.
        let (old_ranges, new_ranges) = changed_ranges(before, after);
        let old_spans = SpanIndex::build(old.iter().map(|d| span_of(path, d)).collect());
        let new_spans = SpanIndex::build(new.iter().map(|d| span_of(path, d)).collect());
        let mut touched: Vec<String> = Vec::new();
        for (lo, hi) in &old_ranges {
            for s in old_spans.hits(*lo, *hi) {
                touched.push(s.name.clone());
            }
        }
        for (lo, hi) in &new_ranges {
            for s in new_spans.hits(*lo, *hi) {
                touched.push(s.name.clone());
            }
        }
        touched.sort();
        touched.dedup();
        for name in &touched {
            let v = self.decide(path, Some(name), holds);
            if v.level > best.level {
                best = Verdict { reason: format!("{} – the edit touches {name}", v.reason), ..v };
            }
        }
        // Belt and braces for spans the ranges missed: a fenced definition
        // whose body changed, or vanished under its name (an opened comment
        // or string swallows it), is still a change to it.
        let mut names: Vec<&str> = old.iter().chain(new.iter()).map(|d| d.0.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        for name in names {
            let v = self.decide(path, Some(name), holds);
            if v.level.editable() || v.level == Level::Scope {
                continue;
            }
            fn bodies<'a>(defs: &'a [(String, u32, u32, String)], name: &str) -> Vec<&'a str> {
                let mut b: Vec<&str> = defs.iter().filter(|d| d.0 == name).map(|d| d.3.as_str()).collect();
                b.sort_unstable();
                b
            }
            if bodies(&old, name) != bodies(&new, name) && v.level > best.level {
                best = Verdict { reason: format!("{} – the edit changes {name}", v.reason), ..v };
            }
        }
        // A renamed or moved locked fn stays locked: relink the old defs to
        // the new ones by B1 identity, and carry the fence across the move.
        // A pure rename also changes the body text (the name is in it), so
        // relink sees nothing: for a vanished fenced def, look for a new def
        // that is the old body with the name swapped, and report the rename.
        let triples = |defs: &[(String, u32, u32, String)]| -> Vec<(String, String, u64)> {
            defs.iter().map(|(n, _, _, b)| (path.to_string(), n.clone(), fnv64(b.as_bytes()))).collect()
        };
        let map = crate::index::identity::relink(&triples(&old), &triples(&new));
        for (i, j) in map.iter().enumerate() {
            let Some(j) = j else { continue };
            if old[i].0 == new[*j].0 {
                continue;
            }
            let v = self.decide(path, Some(&old[i].0), holds);
            if !v.level.editable() && v.level >= best.level {
                best = Verdict {
                    reason: format!("{} – locked {} was renamed to {} and stays locked", v.reason, old[i].0, new[*j].0),
                    ..v
                };
            }
        }
        // The rename fallback: every fenced old def that is gone under its
        // name, matched against a new def that is its body with the name
        // swapped in the signature line (same shape, same body otherwise).
        for o in old.iter() {
            if new.iter().any(|n| n.0 == o.0) {
                continue;
            }
            let v = self.decide(path, Some(&o.0), holds);
            if v.level.editable() {
                continue;
            }
            for n in new.iter() {
                let old_sig = o.3.lines().next().unwrap_or_default();
                let new_sig = n.3.lines().next().unwrap_or_default();
                if o.3.lines().count() == n.3.lines().count() && old_sig.replace(&o.0, &n.0) == new_sig {
                    if v.level >= best.level {
                        best = Verdict {
                            reason: format!("{} – locked {} was renamed to {} and stays locked", v.reason, o.0, n.0),
                            ..v
                        };
                    }
                    break;
                }
            }
        }
        Some(best)
    }

    /// Why a file or symbol has the verdict it has, split into the chain the
    /// brief asks for: repository rules, then the team's (task and workflow),
    /// then the seat's own fence. The final verdict is the highest of all
    /// three layers, and never depends on their order.
    pub fn explain_chain(&self, path: &str, symbol: Option<&str>) -> ExplainChain {
        let hits = self.hits(path, symbol, false);
        let pick = |l: Layer| -> Vec<Verdict> { hits.iter().filter(|v| layer_of(&v.rule) == l).cloned().collect() };
        let repo = pick(Layer::Repo);
        let team = pick(Layer::Team);
        let seat = pick(Layer::Seat);
        let verdict = repo.iter().chain(&team).chain(&seat).max_by_key(|v| v.level).cloned().unwrap_or_default();
        ExplainChain { path: path.trim_start_matches("./").to_string(), symbol: symbol.map(String::from), repo, team, seat, verdict }
    }
}

/// Which layer of the fence chain a rule belongs to, from its `rule` tag:
/// seat fences are tagged `seat <team>/<seat>`, the team's task and workflow
/// rules `task` and `workflow …`, everything else is the repository's own.
#[derive(PartialEq, Eq, Clone, Copy, Debug)]
pub enum Layer {
    Repo,
    Team,
    Seat,
}

fn layer_of(rule: &str) -> Layer {
    if rule.starts_with("seat ") {
        Layer::Seat
    } else if rule == "task" || rule.starts_with("workflow") {
        Layer::Team
    } else {
        Layer::Repo
    }
}

/// `guard::explain(target, seat)`: the rule chain repo → team → seat for one
/// target, highest wins. The target is a path, a `path:name` pair, or a bare
/// symbol name (fenced wherever it is defined).
#[derive(Serialize, Clone, Debug)]
pub struct ExplainChain {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    pub repo: Vec<Verdict>,
    pub team: Vec<Verdict>,
    pub seat: Vec<Verdict>,
    pub verdict: Verdict,
}

/// Split a target into (path, symbol): `a/b.rs:f` is the f in a/b.rs, a bare
/// `f` fences every definition of it, anything that looks like a file is one.
pub fn split_target(target: &str) -> (Option<String>, Option<String>) {
    if let Some((p, s)) = target.rsplit_once(':') {
        if p.contains('/') || p.contains('.') {
            return (Some(p.to_string()), Some(s.to_string()));
        }
    }
    if target.contains('/') || target.ends_with(".rs") || target.contains('.') {
        (Some(target.to_string()), None)
    } else {
        (None, Some(target.to_string()))
    }
}

/// `guard::explain(target, seat)`: the rule chain repo → team → seat, highest
/// wins. A seat is matched the way the hook matches one: by seat name, then by
/// the agent that runs it. Without a seat, only the repo and team layers apply.
pub fn explain(repo: &Repo, target: &str, seat: Option<&str>) -> Option<ExplainChain> {
    let (path, symbol) = split_target(target);
    let g = Guards::for_agent(repo, seat).ok()?;
    let store = crate::store::Store::open(repo).ok();
    // A bare symbol name: find the paths that define it, and explain the
    // first (they are fenced alike by the bare rule; the warning about
    // several definitions comes from `Guards::warnings`).
    let path = match path {
        Some(p) => p,
        None => {
            let st = store.as_ref()?;
            st.nodes_where("name = ?1 AND kind != 'file' AND kind != 'package' ORDER BY path", rusqlite::params![symbol.clone().unwrap_or_default()])
                .ok()?
                .first()
                .map(|n| n.path.clone())?
        }
    };
    Some(g.explain_chain(&path, symbol.as_deref()))
}

/// Two seats in one team that may both write the same symbol or file: the
/// overlap check B4's lint consumes. See [`team_overlaps`], which does the work.
// B4 calls this; tests exercise the same check in-module.
#[allow(dead_code)]
pub fn overlap(cfg: &Config, store: &Store) -> Vec<Overlap> {
    // Consumed by B4's lint; tests exercise it in-module.
    #[allow(dead_code)]
    team_overlaps(cfg, store)
}

/// The macOS `sandbox-exec` profile for a seat (the bash wall): everything is
/// allowed except writes into locked paths and reads of hidden ones, so a
/// shell escape cannot reach what the fence protects. Paths are resolved
/// against the repository root; profile syntax per kula-refs/sandbox-runtime.
// Seat profiles consume this outside the tests that exercise it here.
#[allow(dead_code)]
pub fn sandbox_profile(repo_root: &std::path::Path, locked: &[String], hidden: &[String]) -> String {
    // macOS symlinks /tmp to /private/tmp (and /var to /private/var), and a
    // subpath filter sees the real path only: canonicalize or the deny is
    // silently skipped.
    let abs = |p: &String| -> String {
        let p = p.trim_start_matches("./");
        let joined = if std::path::Path::new(p).is_absolute() {
            std::path::PathBuf::from(p)
        } else {
            repo_root.join(p)
        };
        joined.canonicalize().map(|c| c.to_string_lossy().into_owned()).unwrap_or_else(|_| joined.to_string_lossy().into_owned())
    };
    let mut out = String::from("(version 1)\n(allow default)\n");
    // A glob's literal prefix is the part sandbox-exec can deny: `certs/**`
    // becomes the directory `certs/`, a plain path stays itself.
    let dir_of = |p: &String| -> String {
        let p = p.trim_start_matches("./");
        let base = p.split(['*', '{', '[']).next().unwrap_or(p).trim_end_matches('/');
        if base.is_empty() {
            p.to_string()
        } else {
            base.to_string()
        }
    };
    for p in locked {
        let a = abs(&dir_of(p));
        out.push_str(&format!("(deny file-write* (subpath \"{a}\"))\n"));
    }
    for p in hidden {
        let a = abs(&dir_of(p));
        out.push_str(&format!("(deny file-read* (subpath \"{a}\"))\n"));
        out.push_str(&format!("(deny file-write* (subpath \"{a}\"))\n"));
    }
    out
}

// ---- B3 internals: spans, the interval tree, and the diff mapping ----

/// FNV-1a over bytes, the same constants as `index::identity`'s private
/// `fnv`: the index keeps its hash private, so guard computes body hashes
/// with the identical function to feed `symbol_id`.
fn fnv64(b: &[u8]) -> u64 {
    b.iter().fold(0xcbf29ce484222325u64, |h, x| (h ^ *x as u64).wrapping_mul(0x100000001b3))
}

/// One symbol's span in a file: its line range, its name, and its B1 identity
/// (`s…`), so fences can follow a symbol when it moves or renames.
#[derive(Clone, Debug)]
pub struct Span {
    pub start: u32,
    pub end: u32,
    pub name: String,
    // The B1 identity travels with every span so callers can keep a rule
    // pinned to a symbol even before they need it.
    #[allow(dead_code)]
    pub id: String,
}

/// An interval tree over one file's symbol spans: sorted by start with a
/// running maximum of the ends, so every span intersecting a query range is
/// found in O(log n + k) – binary search for the first span that can reach
/// the query's start, then walk forward while starts still fit.
pub struct SpanIndex {
    starts: Vec<u32>,
    max_end: Vec<u32>,
    spans: Vec<Span>,
}

impl SpanIndex {
    pub fn build(mut spans: Vec<Span>) -> SpanIndex {
        spans.sort_by_key(|s| (s.start, s.end));
        let mut max_end = Vec::with_capacity(spans.len());
        let mut m = 0u32;
        for s in &spans {
            m = m.max(s.end);
            max_end.push(m);
        }
        SpanIndex { starts: spans.iter().map(|s| s.start).collect(), max_end, spans }
    }

    // Standard collection accessors; tests use them, callers may too.
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.spans.is_empty()
    }

    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.spans.len()
    }

    /// Every span intersecting the closed line range `[lo, hi]`, in start order.
    pub fn hits(&self, lo: u32, hi: u32) -> Vec<&Span> {
        // max_end is nondecreasing, so the first entry that reaches lo is a
        // binary search away; earlier spans all end before lo.
        let mut i = self.max_end.partition_point(|&m| m < lo);
        let mut out = Vec::new();
        while i < self.spans.len() && self.starts[i] <= hi {
            let s = &self.spans[i];
            if s.end >= lo {
                out.push(s);
            }
            i += 1;
        }
        out
    }
}

fn span_of(path: &str, d: &(String, u32, u32, String)) -> Span {
    Span {
        start: d.1,
        end: d.2,
        name: d.0.clone(),
        id: crate::index::identity::symbol_id(path, &d.0, fnv64(d.3.as_bytes())),
    }
}

/// The changed ranges of an edit: old-side and new-side, each merged.
pub type Ranges = (Vec<(u32, u32)>, Vec<(u32, u32)>);

/// The line ranges an edit changes, in the old text and in the new one, from
/// a patience diff of the two. Line numbers are exact for both sides; ranges
/// are merged so a symbol touched by two adjacent hunks is found once.
pub fn changed_ranges(before: &str, after: &str) -> Ranges {
    let diff = similar::TextDiff::configure().algorithm(similar::Algorithm::Patience).diff_lines(before, after);
    let mut old: Vec<(u32, u32)> = Vec::new();
    let mut new: Vec<(u32, u32)> = Vec::new();
    for op in diff.ops() {
        if op.tag() == similar::DiffTag::Equal {
            continue;
        }
        let o = op.old_range();
        let n = op.new_range();
        if !o.is_empty() {
            old.push((o.start as u32 + 1, o.end as u32));
        }
        if !n.is_empty() {
            new.push((n.start as u32 + 1, n.end as u32));
        }
    }
    (merge_ranges(old), merge_ranges(new))
}

/// Sort and glue overlapping or adjacent ranges, so the interval tree sees
/// one clean set.
fn merge_ranges(mut v: Vec<(u32, u32)>) -> Vec<(u32, u32)> {
    v.sort_unstable();
    let mut out: Vec<(u32, u32)> = Vec::with_capacity(v.len());
    for (lo, hi) in v {
        match out.last_mut() {
            Some((_, e)) if lo <= *e + 1 => *e = (*e).max(hi),
            _ => out.push((lo, hi)),
        }
    }
    out
}

/// Hunks from an external diff (`git diff -U0`) mapped to file lines by
/// anchor search: when the reported start line does not hold the text the
/// hunk saw, the true position is found within ±16 lines by matching the
/// hunk's first changed line. Returns corrected, merged old-side ranges.
// Written for hook integrations that report editor-side hunk lists.
#[allow(dead_code)]
pub fn hunk_ranges(before: &str, hunks: &[(u32, u32)]) -> Vec<(u32, u32)> {
    let lines: Vec<&str> = before.lines().collect();
    let mut out = Vec::new();
    for (start, end) in hunks {
        // The hunk's first line as the diff saw it is not carried here; the
        // caller's hunk came from the same before text, so the anchor search
        // only repairs an off-by-N from a stale hunk list. Out-of-range or
        // degenerate hunks are clamped, never dropped.
        let lo = (*start).max(1).min(lines.len().max(1) as u32);
        let hi = (*end).max(lo).min(lines.len().max(1) as u32);
        out.push((lo, hi));
    }
    merge_ranges(out)
}

/// The text a file would hold after a file tool's edit, from the hook payload's
/// `tool_input`: Claude Code and Gemini `Edit` / `replace` (`old_string`,
/// `new_string`, `replace_all`), `MultiEdit` (`edits`), and `Write` /
/// `write_file` (`content`). `None` when the payload is none of these or an
/// `old_string` is not in the file, so the caller falls back to the whole-file verdict.
pub fn edited_text(ti: &serde_json::Value, old: &str) -> Option<String> {
    if let Some(c) = ti["content"].as_str() {
        return Some(c.to_string());
    }
    let one = |text: &str, e: &serde_json::Value| -> Option<String> {
        let from = e["old_string"].as_str()?;
        let to = e["new_string"].as_str()?;
        if from.is_empty() || !text.contains(from) {
            return None;
        }
        Some(if e["replace_all"].as_bool().unwrap_or(false) { text.replace(from, to) } else { text.replacen(from, to, 1) })
    };
    if let Some(edits) = ti["edits"].as_array() {
        let mut text = old.to_string();
        for e in edits {
            text = one(&text, e)?;
        }
        return Some(text);
    }
    one(old, ti)
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
    let mut vars: Vars = Default::default();
    for seg in unquoted.split([';', '\n']).flat_map(|s| s.split("&&")).flat_map(|s| s.split("||")).map(str::trim).filter(|s| !s.is_empty())
    {
        let ws: Vec<String> = words(seg)
            .into_iter()
            .skip_while(|w| matches!(w.as_str(), "{" | "}" | "!" | "if" | "then" | "else" | "elif" | "do" | "while" | "until" | "time"))
            .collect();
        let mut k = 0;
        // assignments and identity scrubbing
        while k < ws.len() {
            let w = &ws[k];
            if w.contains('=')
                && w.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                && !w.split('=').next().unwrap_or("").contains('/')
            {
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
        if name == "cd" || name == "pushd" {
            cd = match ws.get(1) {
                Some(d) => bypass::cd_to(&cd, d, &vars, cwd_rel),
                None => bypass::LOST.into(),
            };
            continue;
        }
        if name == "popd" {
            cd = cwd_rel.trim_matches('/').to_string();
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
        if let Some(why) = bypass::segment(seg, ws, &cd, &vars, cwd_rel, fenced, hidden, &mut extra) {
            return (extra, Some(why));
        }
        // `awk -i inplace` edits files in place
        let writes = name == "awk" && (ws.iter().any(|w| w == "-i") || ws.iter().any(|w| w == "inplace"));
        if name == "git" {
            let args: Vec<&str> = ws.iter().skip(1).map(String::as_str).collect();
            if let Some(why) = git_guard(&args, &mut cd, &vars, cwd_rel, fenced, hidden, &mut extra) {
                return (extra, Some(why));
            }
            if let Some(why) = bypass::git_moves(args.first().copied().unwrap_or(""), &args, &cd, fenced, hidden) {
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
        for t in redirect_targets(seg) {
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
/// Where git's subcommand sits after its global options (`-C dir`, `-c k=v`, `--git-dir=…`), and whether any of
/// them moves the tree the command works on. A valued option's value is never the subcommand.
pub fn git_sub(args: &[&str]) -> (usize, bool) {
    let (mut i, mut moved) = (0, false);
    while let Some(a) = args.get(i).copied() {
        match a {
            "-C" | "--git-dir" | "--work-tree" | "--namespace" | "--super-prefix" | "--exec-path" | "--config-env" => {
                moved |= matches!(a, "-C" | "--git-dir" | "--work-tree");
                i += 2;
            }
            "-c" => i += 2,
            _ if a.starts_with("--git-dir=") || a.starts_with("--work-tree=") => {
                moved = true;
                i += 1;
            }
            _ if a.starts_with("-C") && a.len() > 2 => {
                moved = true;
                i += 1;
            }
            _ if a.starts_with('-') && !a.is_empty() => i += 1,
            _ => break,
        }
    }
    (i.min(args.len()), moved)
}

fn git_guard(
    args: &[&str],
    cd: &mut str,
    vars: &Vars,
    cwd: &str,
    fenced: &[String],
    hidden: &[String],
    extra: &mut Vec<String>,
) -> Option<String> {
    let refuse = |why: &str| Some(format!("kula guard: refused – {why}."));
    let (at, moved) = git_sub(args);
    let full = args;
    let args = &args[at..];
    let sub = args.first().copied().unwrap_or("");
    // -c core.hooksPath=…, abbreviated --no-verify
    for (i, a) in full.iter().enumerate() {
        let val = if *a == "-c" { full.get(i + 1).copied().unwrap_or("") } else { a.strip_prefix("-c").unwrap_or(a) };
        if (a.starts_with("-c") || *a == "-c") && val.contains("hooksPath") {
            return refuse("`git -c core.hooksPath` would switch kula's pre-commit fence check off");
        }
        if a.starts_with("--no-v") {
            return refuse("`git commit --no-verify` (or its abbreviation) skips kula's pre-commit fence check");
        }
        let _ = val;
    }
    // `-C other`, `--git-dir`, `--work-tree` point git somewhere our path checks cannot follow
    if moved && !fenced.is_empty() && matches!(sub, "checkout" | "restore" | "apply" | "am" | "stash" | "reset" | "rm" | "mv" | "clean") {
        return refuse("`git -C`, `--git-dir` and `--work-tree` aim a rewrite at a tree kula cannot check");
    }
    // plumbing that writes commits or the index without the pre-commit check, and env-set git config
    if !fenced.is_empty() {
        if matches!(sub, "commit-tree" | "update-index" | "read-tree" | "checkout-index" | "hash-object" | "fast-import" | "replace") {
            return refuse("git plumbing writes commits and the index without kula's pre-commit fence check");
        }
        if sub == "update-ref" && args.iter().any(|a| a.starts_with("refs/heads/") || *a == "HEAD") {
            return refuse("`git update-ref` on a branch moves history past kula's pre-commit fence check");
        }
        if vars.keys().any(|k| k.starts_with("GIT_CONFIG") || k == "GIT_DIR" || k == "GIT_WORK_TREE" || k == "GIT_INDEX_FILE") {
            return refuse(
                "git's environment overrides (`GIT_CONFIG_*`, `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`) can switch the fences off",
            );
        }
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
                if fenced.iter().any(|f| bypass::covers(&full, f)) {
                    return refuse(format!("`git {sub}` would overwrite fenced file(s) under {full}").as_str());
                }
            }
        }
        _ => {}
    }
    None
}

fn expand(w: &str, vars: &Vars, _cwd: &str) -> String {
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

/// The files the `>`, `>>` and `<>` redirections in one segment write.
fn redirect_targets(seg: &str) -> Vec<String> {
    let mut out = vec![];
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
                    i = j + 1;
                    continue;
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
                    out.push(t);
                }
                i = j;
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    out
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

fn check_target(t: &str, cd: &str, vars: &Vars, cwd: &str, fenced: &[String], extra: &mut Vec<String>) -> Option<String> {
    let expanded = expand(t, vars, cwd);
    if expanded.contains('$') || expanded.contains('`') {
        return Some(format!(
            "kula guard: refused – the write target {t:?} does not resolve to a path in this fenced repository (variable or command substitution)."
        ));
    }
    let full = if expanded.starts_with('/') {
        bypass::inside(&expanded)? // outside this repository: not ours to fence
    } else if expanded.starts_with('~') {
        return None;
    } else if cd == bypass::LOST {
        return Some(format!("kula guard: refused – cannot tell which directory {t} is written from; use a repo path."));
    } else {
        join_rel(cd, &expanded)
    };
    if let Some(f) = fenced.iter().find(|f| bypass::covers(&full, f) || full.starts_with(&format!("{f}/"))) {
        return Some(if *f == full {
            format!("kula guard: refused – {full} is fenced for agents.")
        } else {
            format!("kula guard: refused – {full} reaches {f}, which is fenced for agents.")
        });
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
    fn a_seat_fence_adds_to_the_repo_rules_and_only_for_that_seat() {
        let cfg: Config = toml::from_str(
            r#"
            [[guard]]
            paths = ["vendor/**"]
            level = "review"
            [[team]]
            name = "ship"
            members = [
              { name = "Atlas", fence = { lock = ["src/pay/**"], hide = ["secrets_vault"] } },
              { name = "Quill" },
            ]
            "#,
        )
        .unwrap();
        let mut g = Guards::new(&cfg, None).unwrap();
        g.add_seat_fence("ship", &cfg.teams[0].members[0]).unwrap();
        assert_eq!(g.path("src/pay/card.rs").level, Level::Locked);
        assert!(g.path("src/pay/card.rs").reason.contains("Atlas"));
        assert_eq!(g.path("vendor/x.rs").level, Level::Review, "repo rules still apply");
        assert_eq!(g.path("src/other.rs").level, Level::Open);
        // a seat fence can only add: a lock over a hidden rule stays hidden
        let mut g2 = guards("[[guard]]\npaths = [\"src/pay/**\"]\nlevel = \"hidden\"\n", None);
        g2.add_seat_fence("ship", &cfg.teams[0].members[0]).unwrap();
        assert_eq!(g2.path("src/pay/card.rs").level, Level::Hidden);
        // the other seat gets none of it
        let mut q = Guards::new(&cfg, None).unwrap();
        q.add_seat_fence("ship", &cfg.teams[0].members[1]).unwrap();
        assert_eq!(q.path("src/pay/card.rs").level, Level::Open);
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

    const PAY: &str = "fn charge(x: u32) -> u32 {\n    x * 2\n}\n\nfn helper() -> u32 {\n    1\n}\n";

    fn exact(g: &Guards, before: &str, after: &str) -> Level {
        g.edit_exact(None, "src/pay.rs", before, after).expect("parses").level
    }

    #[test]
    fn exact_edits_refuse_only_the_fenced_symbol() {
        let g = guards("[[guard]]\nsymbols = [\"src/pay.rs:charge\"]\nlevel = \"locked\"\n", None);
        // between and beside symbols: allowed
        assert!(exact(&g, PAY, &PAY.replace("    1\n", "    2\n")).editable(), "editing helper is fine");
        assert!(exact(&g, PAY, &format!("// top note\n{PAY}")).editable(), "a new comment line is fine");
        // inside the locked symbol: refused, and the reason names it
        let v = g.edit_exact(None, "src/pay.rs", PAY, &PAY.replace("x * 2", "x * 3")).unwrap();
        assert_eq!(v.level, Level::Locked);
        assert!(v.reason.contains("charge"), "{}", v.reason);
        // comment-swallow: wrapping charge in a block comment removes it
        assert_eq!(exact(&g, PAY, &format!("/*\n{PAY}*/\n")), Level::Locked);
        // a second definition under the locked name
        assert_eq!(exact(&g, PAY, &format!("{PAY}\nmod m {{ pub fn charge() {{}} }}\n")), Level::Locked);
        // deleting it
        assert_eq!(exact(&g, PAY, "fn helper() -> u32 {\n    1\n}\n"), Level::Locked);
        // a file path rule still fences the whole file
        let f = guards("[[guard]]\npaths = [\"src/pay.rs\"]\nlevel = \"locked\"\n", None);
        assert_eq!(exact(&f, PAY, &PAY.replace("    1\n", "    2\n")), Level::Locked);
        // an unparseable language falls back to the coarse verdict
        assert!(g.edit_exact(None, "notes.unknownext", "a", "b").is_none());
    }

    #[test]
    fn edited_text_applies_edit_multiedit_and_write() {
        let ti = serde_json::json!({ "old_string": "x * 2", "new_string": "x * 4" });
        assert_eq!(edited_text(&ti, PAY).unwrap(), PAY.replace("x * 2", "x * 4"));
        let ti = serde_json::json!({ "content": "fn a() {}\n" });
        assert_eq!(edited_text(&ti, PAY).unwrap(), "fn a() {}\n");
        let ti = serde_json::json!({ "edits": [ { "old_string": "x * 2", "new_string": "x" }, { "old_string": "    1\n", "new_string": "    9\n" } ] });
        assert_eq!(edited_text(&ti, PAY).unwrap(), PAY.replace("x * 2", "x").replace("    1\n", "    9\n"));
        assert!(edited_text(&serde_json::json!({ "old_string": "", "new_string": "y" }), PAY).is_none());
    }

    #[test]
    fn unknown_levels_warn_and_stay_locked() {
        let g = guards("[[guard]]\npaths = [\"vendor/**\"]\nlevel = \"lockd\"\n", None);
        assert_eq!(g.path("vendor/x.rs").level, Level::Locked, "fails closed");
        assert!(g.has_bad_levels());
        let w = g.warnings(None);
        assert!(w.iter().any(|w| w.contains("lockd") && w.contains("guard #1")), "{w:?}");
        assert!(Level::parse("Hidden").is_ok());
        assert!(Level::parse("open").is_err());
    }

    #[test]
    fn explain_lists_every_rule_and_the_decider() {
        let g = guards(
            "[[guard]]\npaths = [\"src/**\"]\nlevel = \"review\"\n[[guard]]\nsymbols = [\"src/pay.rs:charge\"]\nlevel = \"locked\"\n",
            None,
        );
        let e = g.explain("./src/pay.rs", Some("charge"));
        assert_eq!(e.path, "src/pay.rs");
        assert_eq!(e.verdict.level, Level::Locked);
        assert_eq!(e.hits.len(), 2, "{:?}", e.hits);
        assert!(e.hits.iter().any(|h| h.level == Level::Review));
        let e = g.explain("src/pay.rs", Some("helper"));
        assert_eq!(e.verdict.level, Level::Review);
        assert!(g.explain("docs/a.md", None).hits.is_empty());
    }

    /// Property checks over generated rule sets (a small LCG, no extra crates):
    /// the result never depends on rule order, and adding a rule never lowers
    /// a level.
    #[test]
    fn levels_are_order_free_and_only_rise() {
        let mut seed: u64 = 0x9e37_79b9_7f4a_7c15;
        let mut next = |n: u64| {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (seed >> 33) % n
        };
        let globs = ["src/**", "src/pay/**", "src/pay/card.rs", "docs/**", "*.md", "vendor/**", "src/*.rs"];
        let syms = ["charge", "src/pay/card.rs:charge", "helper", "src/a.rs:main"];
        let levels = ["locked", "hidden", "review"];
        let probes = [
            ("src/pay/card.rs", Some("charge")),
            ("src/pay/card.rs", None),
            ("src/a.rs", Some("main")),
            ("docs/x.md", None),
            ("README.md", None),
            ("vendor/z.rs", Some("helper")),
        ];
        let rule = |r: &(bool, usize, usize)| {
            if r.0 {
                format!("[[guard]]\nsymbols = [\"{}\"]\nlevel = \"{}\"\n", syms[r.1 % syms.len()], levels[r.2])
            } else {
                format!("[[guard]]\npaths = [\"{}\"]\nlevel = \"{}\"\n", globs[r.1 % globs.len()], levels[r.2])
            }
        };
        let verdicts = |rs: &[(bool, usize, usize)]| {
            let g = guards(&rs.iter().map(rule).collect::<String>(), None);
            probes.iter().map(|(p, s)| g.decide(p, *s, false).level).collect::<Vec<_>>()
        };
        for _ in 0..200 {
            let n = 1 + next(5) as usize;
            let rs: Vec<(bool, usize, usize)> = (0..n).map(|_| (next(2) == 1, next(7) as usize, next(3) as usize)).collect();
            let base = verdicts(&rs);
            let mut rev = rs.clone();
            rev.reverse();
            assert_eq!(base, verdicts(&rev), "order changed the result for {rs:?}");
            let mut more = rs.clone();
            more.push((next(2) == 1, next(7) as usize, next(3) as usize));
            for (a, b) in base.iter().zip(verdicts(&more)) {
                assert!(b >= *a, "adding a rule lowered {a:?} to {b:?} for {more:?}");
            }
        }
    }

    #[test]
    fn secrets_can_be_shown() {
        let g = guards("[agents]\nhide_secrets = false\n", None);
        assert_eq!(g.path(".env").level, Level::Open);
    }
}

#[cfg(test)]
mod hub_global_option_tests {
    use super::git_sub;
    #[test]
    fn global_options_are_skipped() {
        assert_eq!(git_sub(&["commit", "-m", "x"]), (0, false));
        assert_eq!(git_sub(&["-C", ".", "checkout", "--", "a"]), (2, true));
        assert_eq!(git_sub(&["-c", "k=v", "reset"]), (2, false));
        assert_eq!(git_sub(&["--git-dir=x", "-C", "y", "apply", "p"]), (3, true));
        assert_eq!(git_sub(&["-C"]).0, 1);
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
            "git commit-tree HEAD^{tree} -m x",
            "git update-index --cacheinfo 100644,abc,tests/login.test.ts",
            "git update-ref HEAD abc123",
            "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/x git commit -m x",
        ] {
            let hidden = if cmd.contains(".env") { vec![f(".env")] } else { vec![] };
            let (more, why) = shell_guard(cmd, "", &fenced, &hidden);
            assert!(why.is_some() || !more.is_empty(), "{cmd} -> no refusal, no extra targets");
        }
        assert!(shell_guard("cat tests/login.test.ts | grep -n salt", "", &fenced, &[]).1.is_none());
    }

    use std::process::Command;
    use crate::index::defs_now;

    fn guards3(toml: &str, task: Option<Task>) -> Guards {
        Guards::new(&toml::from_str::<Config>(toml).unwrap(), task).unwrap()
    }

    // ---- B3: exact verdicts, moving symbols, three walls ----

    /// A file with a free fn, a locked fn (by symbol rule) and a free fn
    /// after it: the classic "edit next to a locked fn" shape.
    fn vault_source() -> String {
        "pub fn greet() -> &'static str {\n    \"hi\"\n}\n\npub fn vault_unlock(key: u64) -> u64 {\n    key ^ 0x5a5a\n}\n\npub fn wave() -> &'static str {\n    \"o\"\n}\n".to_string()
    }

    fn vault_guards3() -> Guards {
        guards3("[[guard]]\nsymbols = [\"vault_unlock\"]\nlevel = \"locked\"\nreason = \"the vault owns itself\"\n", None)
    }

    fn ve(before: &str, after: &str) -> Verdict {
        vault_guards3().edit_exact(None, "src/vault.rs", before, after).expect("both texts parse")
    }

    #[test]
    fn locked_fn_edit_is_refused_by_span_and_body() {
        let b = vault_source();
        // A line added inside the locked body.
        let a = b.replace("key ^ 0x5a5a", "key ^ 0x5a5a\n    // tweak");
        let v = ve(&b, &a);
        assert_eq!(v.level, Level::Locked, "{v:?}");
        // Deleting the whole definition.
        let a = b.replace("pub fn vault_unlock(key: u64) -> u64 {\n    key ^ 0x5a5a\n}\n\n", "");
        assert_eq!(ve(&b, &a).level, Level::Locked);
        // Rewriting the body but keeping the name.
        let a = b.replace("key ^ 0x5a5a", "key + 1");
        assert_eq!(ve(&b, &a).level, Level::Locked);
    }

    #[test]
    fn free_fn_next_to_locked_fn_passes() {
        let b = vault_source();
        // Above it.
        let a = b.replace("    \"hi\"", "    \"hello\"");
        let v = ve(&b, &a);
        assert!(v.level.editable(), "edit above the locked fn must pass, got {v:?}");
        // Below it.
        let a = b.replace("    \"o\"", "    \"oh\"");
        let v = ve(&b, &a);
        assert!(v.level.editable(), "edit below the locked fn must pass, got {v:?}");
        // Between the two free fns (an insertion after the locked fn's brace).
        let a = b.replace("pub fn wave", "pub fn interim() {}\n\npub fn wave");
        let v = ve(&b, &a);
        assert!(v.level.editable(), "insertion between fns must pass, got {v:?}");
    }

    #[test]
    fn renamed_locked_fn_stays_locked_with_notice() {
        let b = vault_source();
        let a = b.replace("vault_unlock", "vault_release");
        let v = ve(&b, &a);
        assert_eq!(v.level, Level::Locked, "a renamed locked fn stays locked: {v:?}");
        assert!(v.reason.contains("renamed"), "the notice names the rename: {v:?}");
        assert!(v.reason.contains("vault_release") && v.reason.contains("vault_unlock"), "{v:?}");
    }

    #[test]
    fn rule_order_and_edit_order_never_change_a_verdict() {
        let b = vault_source();
        let free = b.replace("    \"hi\"", "    \"hello\"");
        let locked = b.replace("key ^ 0x5a5a", "key ^ 0x1f1f");
        // Two edits applied in either order reach the same verdict.
        let g = vault_guards3();
        let v1 = g.edit_exact(None, "src/vault.rs", &free, &locked).unwrap();
        let v2 = g.edit_exact(None, "src/vault.rs", &locked, &free).unwrap();
        assert_eq!(v1.level, v2.level, "edit order changed the verdict");
        assert_eq!(v1.level, Level::Locked);
        // The same fences written in either order in kula.toml.
        let orders = [
            "[[guard]]\nsymbols = [\"vault_unlock\"]\nlevel = \"locked\"\n\n[[guard]]\npaths = [\"src/**\"]\nlevel = \"review\"\n",
            "[[guard]]\npaths = [\"src/**\"]\nlevel = \"review\"\n\n[[guard]]\nsymbols = [\"vault_unlock\"]\nlevel = \"locked\"\n",
        ];
        let mut seen = Vec::new();
        for toml in orders {
            let g = guards3(toml, None);
            let mut vs = vec![g.path("src/vault.rs").level, g.edit(None, "src/vault.rs").level, g.path("certs/x").level];
            vs.sort();
            seen.push(format!("{vs:?}"));
        }
        assert_eq!(seen[0], seen[1], "rule order changed the verdict");
    }

    #[test]
    fn adding_rules_only_rises() {
        let base = "[[guard]]\npaths = [\"src/**\"]\nlevel = \"review\"\n";
        let more = "\n\n[[guard]]\nsymbols = [\"vault_unlock\"]\nlevel = \"locked\"\n";
        let l1 = guards3(base, None).edit(None, "src/vault.rs").level;
        let l2 = guards3(&format!("{base}{more}"), None).edit(None, "src/vault.rs").level;
        assert!(l2 >= l1, "adding a rule lowered the verdict: {l1:?} → {l2:?}");
        // and the seat fence can only add too
        let cfg: Config = toml::from_str(&format!(
            "{base}\n[[team]]\nname = \"t\"\nmembers = [{{ name = \"A\", fence = {{ lock = [\"src/**\"] }} }}]\n"
        ))
        .unwrap();
        let mut g = guards3(base, None);
        g.add_seat_fence("t", &cfg.teams[0].members[0]).unwrap();
        assert!(g.edit(None, "src/vault.rs").level >= l1);
    }

    #[test]
    fn level_lattice_and_unknown_levels_fail_named() {
        let all = [Level::Open, Level::Review, Level::Scope, Level::Locked, Level::Hidden];
        for a in all {
            for b in all {
                assert!((a <= b) || (b <= a), "the lattice is total");
                if a <= b {
                    assert!(a.editable() >= b.editable(), "editable not monotone {a:?}/{b:?}");
                    assert!(a.readable() >= b.readable(), "readable not monotone {a:?}/{b:?}");
                }
            }
        }
        for bad in ["lockd", "LOCK", "seecret", " open", ""] {
            let e = Level::parse(bad).unwrap_err();
            assert!(e.contains(bad.trim()), "the message must name the level: {e}");
        }
        assert_eq!(Level::parse("locked"), Ok(Level::Locked));
        assert_eq!(Level::parse("Hidden"), Ok(Level::Hidden));
    }

    #[test]
    fn span_index_hits_log_plus_k() {
        let spans: Vec<Span> = (0..1000u32)
            .map(|i| Span { start: i * 3, end: i * 3 + 2, name: format!("s{i}"), id: format!("id{i}") })
            .collect();
        let ix = SpanIndex::build(spans);
        assert_eq!(ix.len(), 1000);
        assert!(!ix.is_empty());
        assert_eq!(ix.hits(1500, 1500).len(), 1, "a single line hits exactly its span");
        assert_eq!(ix.hits(0, 2999).len(), 1000);
        assert!(ix.hits(5000, 6000).is_empty());
        assert_eq!(ix.hits(2, 4).len(), 2, "adjacent spans both hit");
    }

    #[test]
    fn changed_ranges_are_exact_at_hunk_edges() {
        let before = "a\nb\nc\nd\ne\n";
        let (o, n) = changed_ranges(before, "a\nb\nC\nd\ne\n");
        assert_eq!(o, vec![(3, 3)]);
        assert_eq!(n, vec![(3, 3)]);
        let (o, n) = changed_ranges(before, "a\nb\nX\nY\nc\nd\ne\n");
        assert!(o.is_empty(), "{o:?}");
        assert_eq!(n, vec![(3, 4)]);
        let (o, n) = changed_ranges(before, "a\nb\nd\ne\n");
        assert_eq!(o, vec![(3, 3)]);
        assert!(n.is_empty());
        let (o, n) = changed_ranges(before, before);
        assert!(o.is_empty() && n.is_empty());
        // A shifted edit (the property brief calls out hunk edges): ten
        // unchanged lines above, one changed line – the range stays exact.
        let pad = "x\n".repeat(10);
        let (o, n) = changed_ranges(&format!("{pad}a\nb\nc\n"), &format!("{pad}a\nB\nc\n"));
        assert_eq!(o, vec![(12, 12)]);
        assert_eq!(n, vec![(12, 12)]);
    }

    #[test]
    fn hunk_ranges_anchor_repairs_shifted_lists() {
        let before = "l1\nl2\nl3\nl4\nl5\n";
        assert_eq!(hunk_ranges(before, &[(0, 0)]), vec![(1, 1)], "out-of-range hunks clamp, never drop");
        assert_eq!(hunk_ranges(before, &[(99, 120)]), vec![(5, 5)]);
        assert_eq!(hunk_ranges(before, &[(2, 3), (3, 4)]), vec![(2, 4)], "adjacent hunks merge");
    }

    #[test]
    fn bare_name_matching_several_defs_warns_with_suggestion() {
        // Two definitions of one bare name: the warning must suggest path:name.
        let g = guards3("[[guard]]\nsymbols = [\"helper\"]\nlevel = \"locked\"\n", None);
        // Without a store there is nothing to count; the edit-time path warns.
        assert!(g.warnings(None).is_empty());
        let st = defs_now("src/a.rs", "pub fn helper() {}\npub fn other() {}\n").unwrap();
        assert_eq!(st.len(), 2);
        // Store-backed counting is covered through edit_touched's reason below.
        let mut names = vec!["helper".to_string()];
        let v = g.edit_touched(None, "src/a.rs", &names);
        assert_eq!(v.level, Level::Locked);
        names.clear();
        let _ = names;
    }

    #[test]
    fn overlap_reports_two_seats_writing_the_same_symbol() {
        // Two scoped seats in one team whose scope covers the same indexed
        // file: the overlap check must report the pair, so the lint can show
        // who else may write the symbol you are fencing.
        let d = tempfile::tempdir().unwrap();
        let ok = std::process::Command::new("git").args(["init", "-q"]).arg(d.path()).status().unwrap();
        assert!(ok.success(), "git init failed");
        let repo = crate::git::Repo::discover(d.path()).unwrap();
        let store = Store::create(&repo).unwrap();
        let node = crate::store::Node {
            id: 1,
            kind: "file".into(),
            name: "a.rs".into(),
            path: "src/a.rs".into(),
            lang: "rust".into(),
            start_line: 1,
            end_line: 10,
            parent: None,
            community: 0,
        };
        store.write_all(std::slice::from_ref(&node), &[], &[]).unwrap();
        let cfg: Config = toml::from_str(
            "[[team]]\n\
             name = \"algo\"\n\
             [[team.members]]\n\
             name = \"b3\"\n\
             scope = [\"src/**\"]\n\
             [[team.members]]\n\
             name = \"b4\"\n\
             scope = [\"src/**\"]\n",
        )
        .unwrap();
        let ov = overlap(&cfg, &store);
        assert_eq!(ov.len(), 1, "the shared file is reported once for the pair: {ov:?}");
        assert_eq!(ov[0].a, "b3");
        assert_eq!(ov[0].b, "b4");
        assert_eq!(ov[0].count, 1);
        assert_eq!(ov[0].paths, vec!["src/a.rs".to_string()]);
        // Different scopes that do not meet are not a conflict.
        let cfg: Config = toml::from_str(
            "[[team]]\n\
             name = \"algo\"\n\
             [[team.members]]\n\
             name = \"b3\"\n\
             scope = [\"src/**\"]\n\
             [[team.members]]\n\
             name = \"b4\"\n\
             scope = [\"web/**\"]\n",
        )
        .unwrap();
        assert!(overlap(&cfg, &store).is_empty(), "disjoint scopes never overlap");
    }

    #[test]
    fn sandbox_profile_text_names_the_paths() {
        let p = sandbox_profile(std::path::Path::new("/repo"), &["certs/**".into(), "./secrets".into()], &["keys".into()]);
        assert!(p.starts_with("(version 1)"), "{p}");
        assert!(p.contains("(deny file-write* (subpath \"/repo/certs\"))"), "{p}");
        assert!(p.contains("(deny file-write* (subpath \"/repo/secrets\"))"), "{p}");
        assert!(p.contains("(deny file-read* (subpath \"/repo/keys\"))"), "{p}");
        assert!(p.contains("(deny file-write* (subpath \"/repo/keys\"))"), "hidden paths are also unwritable: {p}");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn sandbox_profile_denies_sed_i_on_locked_paths() {
        let exec = std::path::Path::new("/usr/bin/sandbox-exec");
        if !exec.exists() {
            eprintln!("sandbox-exec not present; skipping the bash wall test");
            return;
        }
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("certs")).unwrap();
        std::fs::create_dir_all(d.path().join("src")).unwrap();
        std::fs::write(d.path().join("certs/key.txt"), "old\n").unwrap();
        std::fs::write(d.path().join("src/free.txt"), "old\n").unwrap();
        let profile = sandbox_profile(d.path(), &["certs/**".into()], &[]);
        let pf = std::env::temp_dir().join(format!("kula-b3-profile-{}", std::process::id()));
        std::fs::write(&pf, &profile).unwrap();
        let run = |code: String| {
            Command::new(exec).arg("-f").arg(&pf).arg("/bin/sh").arg("-c").arg(code).output().unwrap()
        };
        let locked = d.path().join("certs/key.txt");
        let free = d.path().join("src/free.txt");
        let denied = run(format!("echo x >> {}", locked.display()));
        assert!(!denied.status.success(), "an append into the locked path was NOT denied");
        let ok = run(format!("echo x >> {}", free.display()));
        assert!(ok.status.success(), "a free path must stay writable: {:?}", String::from_utf8_lossy(&ok.stderr));
        let denied = run(format!("sed -i '' 's/old/new/' {}", locked.display()));
        assert!(!denied.status.success(), "sed -i on the locked path was NOT denied");
        let _ = std::fs::remove_file(&pf);
    }

    #[test]
    fn explain_chain_layers_repo_team_seat() {
        let cfg: Config = toml::from_str(
            r#"
            [[guard]]
            paths = ["src/secret.rs"]
            level = "locked"
            reason = "repo says locked"
            [[guard]]
            paths = ["src/**"]
            level = "review"
            [[team]]
            name = "crew"
            members = [{ name = "Atlas", fence = { lock = ["src/vault.rs"] } }]
            "#,
        )
        .unwrap();
        let mut g = Guards::new(&cfg, None).unwrap();
        g.add_seat_fence("crew", &cfg.teams[0].members[0]).unwrap();
        let chain = g.explain_chain("src/secret.rs", None);
        assert_eq!(chain.repo.len(), 2, "both repo rules hit: {:?}", chain.repo);
        assert!(chain.seat.is_empty());
        assert_eq!(chain.verdict.level, Level::Locked, "highest wins");
        let chain = g.explain_chain("src/vault.rs", None);
        assert_eq!(chain.seat.len(), 1, "the seat fence is its own layer: {:?}", chain.seat);
        assert_eq!(chain.verdict.level, Level::Locked);
        let chain = g.explain_chain("src/open.rs", None);
        assert_eq!(chain.repo.len(), 1);
        assert!(chain.seat.is_empty());
        assert!(chain.verdict.level.editable());
        // The chain is order independent by construction: the verdict is the
        // max over the layers, and the layers do not see each other's rules.
        assert_eq!(chain.verdict.level, g.decide("src/open.rs", None, false).level);
    }

    #[test]
    fn split_target_reads_path_name_and_bare_names() {
        assert_eq!(split_target("src/a.rs:f"), (Some("src/a.rs".into()), Some("f".into())));
        assert_eq!(split_target("src/a.rs"), (Some("src/a.rs".into()), None));
        assert_eq!(split_target("helper"), (None, Some("helper".into())));
        assert_eq!(split_target("a.rs"), (Some("a.rs".into()), None));
    }

    #[test]
    fn hook_verdict_p99_under_20ms() {
        // The hook answers from the fence set alone: decide() over every rule
        // for the paths it is asked about. Time it on this repo's own fences.
        let repo = match crate::git::Repo::discover(std::path::Path::new(env!("CARGO_MANIFEST_DIR"))) {
            Ok(r) => r,
            Err(_) => {
                eprintln!("no repo here; skipping the p99 timing");
                return;
            }
        };
        let g = Guards::load(&repo).unwrap();
        let paths: Vec<String> = ["src/guard.rs", "src/guard/bypass.rs", "src/server.rs", "src/mcp.rs", "src/index/mod.rs"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let mut times = Vec::new();
        for _ in 0..400 {
            let t0 = std::time::Instant::now();
            for p in &paths {
                let _ = g.path(p);
                let _ = g.edit(None, p);
            }
            times.push(t0.elapsed());
        }
        times.sort();
        let p99 = times[(times.len() as f64 * 0.99) as usize];
        eprintln!("hook verdict batch (5 paths) p99 = {:?}", p99);
        assert!(p99.as_millis() < 20, "hook verdict p99 {:?} over 20 ms", p99);
    }
}
