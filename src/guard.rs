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
    globset(&scope.iter().filter(|s| looks_like_path(s)).cloned().collect::<Vec<_>>())?;
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

impl Guards {
    pub fn load(repo: &Repo) -> Result<Guards> {
        let cfg = Config::load(&repo.root)?;
        Guards::new(&cfg, task(repo))
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
                let (paths, syms): (Vec<String>, Vec<String>) = t.scope.iter().cloned().partition(|s| looks_like_path(s));
                let g = globset(&paths)?;
                Some((t, g, syms))
            }
            Some(t) => Some((t, GlobSet::empty(), vec![])),
            None => None,
        };
        Ok(Guards { rules, secrets, task, workflow: wf })
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
    pub fn edit(&self, store: Option<&Store>, path: &str) -> Verdict {
        let holds = match (&self.task, store) {
            (Some((_, _, syms)), Some(st)) if !syms.is_empty() => syms
                .iter()
                .any(|s| st.nodes_where("name = ?1 AND path = ?2", rusqlite::params![s, path]).map(|h| !h.is_empty()).unwrap_or(false)),
            _ => false,
        };
        self.decide(path, None, holds)
    }
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

/// Check paths for an agent edit: those whose verdict forbids editing.
pub fn violations(repo: &Repo, store: Option<&Store>, paths: &[String]) -> Result<Vec<(String, Verdict)>> {
    let g = Guards::load(repo)?;
    Ok(paths.iter().map(|p| (p.clone(), g.edit(store, p))).filter(|(_, v)| !v.level.editable()).collect())
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
    fn secrets_can_be_shown() {
        let g = guards("[agents]\nhide_secrets = false\n", None);
        assert_eq!(g.path(".env").level, Level::Open);
    }
}
