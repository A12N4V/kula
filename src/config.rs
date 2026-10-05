//! `kula.toml` – the project's own settings, committed next to the code.
//!
//! Everything has a default, so a repo without the file behaves exactly as
//! before; `kula init` writes one so a team shares the same graph, hooks and
//! CI gate.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const FILE: &str = "kula.toml";

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Config {
    pub project: Project,
    pub index: Index,
    pub hooks: Hooks,
    pub check: Check,
    pub agents: Agents,
    /// `[[guard]]` rules: code agents may not touch, or may not even see.
    #[serde(rename = "guard")]
    pub guards: Vec<GuardRule>,
}

/// What kula tells and allows AI agents (MCP, hooks).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Agents {
    /// Keep likely secrets (.env, keys, certificates) out of every agent answer.
    pub hide_secrets: bool,
    /// Let agents keep memories anchored to symbols (`remember` / `recall`).
    pub memory: bool,
}

impl Default for Agents {
    fn default() -> Self {
        Agents { hide_secrets: true, memory: true }
    }
}

/// One fence around part of the codebase.
///
/// ```toml
/// [[guard]]
/// paths = ["migrations/**"]
/// symbols = ["charge_card"]
/// level = "locked"          # locked | hidden | review
/// reason = "schema changes go through the DBA"
/// ```
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct GuardRule {
    /// gitignore-style globs, relative to the repository root.
    pub paths: Vec<String>,
    /// Symbol names, or `path:name` to pin one.
    pub symbols: Vec<String>,
    /// locked: read, never edit. hidden: never read or edit. review: edit, flagged for a human.
    pub level: String,
    pub reason: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Project {
    /// Display name; the directory name when empty.
    pub name: String,
    /// The branch proposals and `kula check` compare against; detected when empty.
    pub default_branch: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Index {
    /// Extra gitignore-style globs to leave out of the graph (on top of .gitignore).
    pub exclude: Vec<String>,
    /// Skip source files larger than this (generated bundles, vendored blobs).
    pub max_file_kb: u64,
}

impl Default for Index {
    fn default() -> Self {
        Index { exclude: vec![], max_file_kb: 1024 }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Hooks {
    /// Reindex in the background after commit, checkout and merge.
    pub reindex: bool,
}

impl Default for Hooks {
    fn default() -> Self {
        Hooks { reindex: true }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Check {
    /// `kula check` fails when a change's risk is above this: none | low | medium | high.
    pub max_risk: String,
}

impl Default for Check {
    fn default() -> Self {
        Check { max_risk: "medium".into() }
    }
}

impl Config {
    /// The repo's `kula.toml`, or defaults when there is none.
    pub fn load(root: &Path) -> Result<Config> {
        let p = root.join(FILE);
        match std::fs::read_to_string(&p) {
            Ok(s) => toml::from_str(&s).with_context(|| format!("reading {}", p.display())),
            Err(_) => Ok(Config::default()),
        }
    }

    pub fn exists(root: &Path) -> bool {
        root.join(FILE).exists()
    }

    /// The commented file `kula init` writes.
    pub fn render(&self) -> String {
        let q = |s: &str| format!("{s:?}");
        let excl = self.index.exclude.iter().map(|e| q(e)).collect::<Vec<_>>().join(", ");
        format!(
            "# kula.toml – shared settings for this repository's graph. Commit it.\n\
             # Docs: https://github.com/A12N4V/kula#configuration\n\n\
             [project]\n\
             name = {}\n\
             default_branch = {}   # what proposals and `kula check` compare against\n\n\
             [index]\n\
             exclude = [{}]   # gitignore-style globs, on top of .gitignore\n\
             max_file_kb = {}\n\n\
             [hooks]\n\
             reindex = {}   # keep the graph current after commit / checkout / merge\n\n\
             [check]\n\
             max_risk = {}   # CI gate: none | low | medium | high\n\n\
             [agents]\n\
             hide_secrets = {}   # keep .env, keys and certificates out of every agent answer\n\
             memory = {}         # let agents remember facts about the code (`kula memory`)\n\n\
             # Fence code off from AI agents. locked: read, never edit · hidden: never shown ·\n\
             # review: editable, flagged in `kula check`. Paths are globs; symbols are names.\n\
             # [[guard]]\n\
             # paths = [\"migrations/**\"]\n\
             # level = \"locked\"\n\
             # reason = \"schema changes go through the DBA\"\n",
            q(&self.project.name),
            q(&self.project.default_branch),
            excl,
            self.index.max_file_kb,
            self.hooks.reindex,
            q(&self.check.max_risk),
            self.agents.hide_secrets,
            self.agents.memory,
        )
    }
}

pub fn risk_rank(r: &str) -> u8 {
    match r {
        "none" => 0,
        "low" => 1,
        "medium" => 2,
        "high" => 3,
        _ => 4,
    }
}
