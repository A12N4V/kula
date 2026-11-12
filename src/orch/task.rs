//! The task model: a plan is a goal split into slices, one per module.

use crate::git::Repo;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SliceState {
    #[default]
    Queued,
    Running,
    Gating,
    Passed,
    Failed,
    Rejected,
}

impl SliceState {
    pub fn done(self) -> bool {
        matches!(self, SliceState::Passed | SliceState::Failed | SliceState::Rejected)
    }
    pub fn active(self) -> bool {
        matches!(self, SliceState::Running | SliceState::Gating)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Slice {
    pub id: String,
    /// The module this slice owns, as `kula map` names it.
    pub module: String,
    /// Paths (directories or files) the slice may change.
    pub scope: Vec<String>,
    /// Test files for this slice; also in scope.
    #[serde(default)]
    pub tests: Vec<String>,
    pub agent: String,
    pub base_ref: String,
    /// Slice ids that must pass first.
    #[serde(default)]
    pub deps: Vec<String>,
    #[serde(default)]
    pub state: SliceState,
    #[serde(default)]
    pub attempts: u32,
    /// Retries ran out: a person should look.
    #[serde(default)]
    pub escalate: bool,
    /// The last gate's reasons.
    #[serde(default)]
    pub reasons: Vec<String>,
    /// Files outside the scope expected to feel the change (its blast radius).
    #[serde(default)]
    pub blast: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Plan {
    pub schema: u32,
    pub id: String,
    pub goal: String,
    /// low | medium | high
    pub risk: String,
    pub base_ref: String,
    pub max_parallel: usize,
    pub max_retries: u32,
    /// Shell command run in the slice's tree; `{tests}` becomes its test files.
    #[serde(default)]
    pub test_cmd: Option<String>,
    /// Module cycles present when the plan was made, each sorted.
    #[serde(default)]
    pub baseline_cycles: Vec<Vec<String>>,
    /// Command per agent id; `{prompt}` becomes the prompt.
    #[serde(default)]
    pub agents: BTreeMap<String, Vec<String>>,
    /// Shell command run before each slice starts; non zero means not enough
    /// memory. Falls back to `KULA_MEM_CHECK`.
    #[serde(default)]
    pub mem_check: Option<String>,
    pub slices: Vec<Slice>,
}

impl Plan {
    pub fn slice(&self, id: &str) -> Option<&Slice> {
        self.slices.iter().find(|s| s.id == id)
    }
    pub fn slice_mut(&mut self, id: &str) -> Option<&mut Slice> {
        self.slices.iter_mut().find(|s| s.id == id)
    }
    pub fn load(path: &Path) -> Result<Plan> {
        let s = std::fs::read_to_string(path).with_context(|| format!("no plan at {} – run `kula plan \"<goal>\"`", path.display()))?;
        serde_json::from_str(&s).with_context(|| format!("{} is not a kula plan", path.display()))
    }
    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(d) = path.parent() {
            std::fs::create_dir_all(d)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self)? + "\n")?;
        Ok(())
    }
    /// `.kula/runs/<plan>/`.
    pub fn run_dir(&self, repo: &Repo) -> PathBuf {
        repo.kula_dir().join("runs").join(&self.id)
    }
    /// `.kula/worktrees/<plan>/<slice>`.
    pub fn worktree(&self, repo: &Repo, slice: &str) -> PathBuf {
        repo.kula_dir().join("worktrees").join(&self.id).join(slice)
    }
    pub fn branch(&self, slice: &str) -> String {
        format!("kula/{}/{}", self.id, slice)
    }
}

pub fn default_path(repo: &Repo) -> PathBuf {
    repo.kula_dir().join("plan.json")
}

/// A short, path-safe slug: lowercase words joined by `-`, at most 40 chars.
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
    out.truncate(40);
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() {
        "plan".into()
    } else {
        out
    }
}

/// A path is in scope when it equals a scope entry or sits under one.
pub fn in_scope(path: &str, scope: &[String]) -> bool {
    scope.iter().any(|s| {
        let s = s.trim_end_matches('/');
        s == "." || path == s || path.starts_with(&format!("{s}/"))
    })
}

/// Records a plan in `refs/kula/meta`, replacing an earlier version with the same id.
pub fn record(repo: &Repo, plan: &Plan, message: &str) -> Result<()> {
    let mut m = crate::meta::load(repo)?;
    m.plans.retain(|v| v["id"] != plan.id.as_str());
    m.plans.push(serde_json::to_value(plan)?);
    crate::meta::save(repo, &m, message)
}

/// The newest plan in `refs/kula/meta`, or the one called `id`.
pub fn recorded(repo: &Repo, id: Option<&str>) -> Result<Option<Plan>> {
    let m = crate::meta::load(repo)?;
    let v = m.plans.iter().rev().find(|v| id.map_or(true, |id| v["id"] == id));
    Ok(match v {
        Some(v) => Some(serde_json::from_value(v.clone())?),
        None => None,
    })
}

/// The plan file to use: `given`, else `.kula/plan.json`, restored from
/// `refs/kula/meta` when it is missing (a fresh clone, a cleaned `.kula`).
pub fn resolve(repo: &Repo, given: Option<PathBuf>) -> Result<PathBuf> {
    if let Some(p) = given {
        return Ok(p);
    }
    let path = default_path(repo);
    if !path.exists() {
        if let Some(p) = recorded(repo, None)? {
            p.save(&path)?;
        }
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_and_scope() {
        assert_eq!(slug("Add retry to the HTTP client!"), "add-retry-to-the-http-client");
        assert_eq!(slug("  "), "plan");
        let scope = vec!["core/src/net".to_string(), "README.md".into()];
        assert!(in_scope("core/src/net/a.rs", &scope));
        assert!(in_scope("README.md", &scope));
        assert!(!in_scope("core/src/network.rs", &scope));
    }
}
