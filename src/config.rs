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
    /// Put external packages in the graph as `package` nodes.
    pub packages: bool,
}

impl Default for Index {
    fn default() -> Self {
        Index { exclude: vec![], max_file_kb: 1024, packages: true }
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
             max_file_kb = {}\n\
             packages = {}   # external dependencies as nodes on the graph's rim\n\n\
             [hooks]\n\
             reindex = {}   # keep the graph current after commit / checkout / merge\n\n\
             [check]\n\
             max_risk = {}   # CI gate: none | low | medium | high\n",
            q(&self.project.name),
            q(&self.project.default_branch),
            excl,
            self.index.max_file_kb,
            self.index.packages,
            self.hooks.reindex,
            q(&self.check.max_risk),
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
