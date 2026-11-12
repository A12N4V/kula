//! `kula merge-train`: passing slices merge, dependencies first, into
//! `kula/<plan>/integration`, made fresh from the plan's base. A slice that
//! conflicts is left out and comes back as a new queued slice that redoes it on
//! top of the integration branch. The merged result goes through the gate as one
//! slice covering every merged scope. Nothing is merged into any other branch.

use super::gate::{self, Outcome};
use super::task::{Plan, Slice, SliceState};
use crate::git::Repo;
use anyhow::{Context, Result};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize, Debug, Default)]
pub struct Train {
    pub branch: String,
    pub head: String,
    pub merged: Vec<String>,
    /// Slice id and the files that conflicted.
    pub conflicts: Vec<(String, Vec<String>)>,
    /// Slices that had not passed, or were redone as `<id>-merge`, so were not merged.
    pub skipped: Vec<String>,
    pub verdict: String,
    pub reasons: Vec<String>,
    pub notes: Vec<String>,
}

impl Train {
    pub fn ok(&self) -> bool {
        self.conflicts.is_empty() && self.verdict == Outcome::Pass.as_str()
    }
}

fn integration_dir(repo: &Repo, plan: &Plan) -> PathBuf {
    repo.kula_dir().join("worktrees").join(&plan.id).join("_integration")
}

/// Git, with kula's own identity when the repo has none.
fn git(w: &Repo, args: &[&str]) -> Result<String> {
    if w.run(&["config", "user.email"]).map(|s| !s.trim().is_empty()).unwrap_or(false) {
        return w.run(args);
    }
    let mut a = vec!["-c", "user.name=kula", "-c", "user.email=kula@localhost"];
    a.extend_from_slice(args);
    w.run(&a)
}

pub fn train(repo: &Repo, plan: &mut Plan) -> Result<Train> {
    let branch = plan.branch("integration");
    let wt = integration_dir(repo, plan);
    if wt.exists() {
        let _ = repo.run(&["worktree", "remove", "--force", &wt.to_string_lossy()]);
        let _ = std::fs::remove_dir_all(&wt);
    }
    let _ = repo.run(&["worktree", "prune"]);
    std::fs::create_dir_all(wt.parent().unwrap())?;
    let base = if plan.base_ref.is_empty() { "HEAD" } else { &plan.base_ref };
    repo.run(&["worktree", "add", "-q", "-B", &branch, &wt.to_string_lossy(), base]).context("could not make the integration worktree")?;
    let w = Repo::discover(&wt)?;

    let mut t = Train { branch: branch.clone(), ..Default::default() };
    let mut whole = Slice { id: "integration".into(), base_ref: base.to_string(), ..Default::default() };
    let mut redo: Vec<Slice> = Vec::new();
    for s in &plan.slices {
        // A slice redone after a conflict stands in for the one that conflicted.
        let superseded = plan.slice(&format!("{}-merge", s.id)).is_some();
        if s.state != SliceState::Passed || superseded {
            t.skipped.push(s.id.clone());
            continue;
        }
        let msg = format!("kula: merge slice {}", s.id);
        if git(&w, &["merge", "--no-ff", "-q", "-m", &msg, &plan.branch(&s.id)]).is_ok() {
            t.merged.push(s.id.clone());
            whole.agent = s.agent.clone();
            whole.scope.extend(s.scope.iter().cloned());
            whole.tests.extend(s.tests.iter().cloned());
            whole.blast.extend(s.blast.iter().cloned());
            continue;
        }
        let files: Vec<String> = w.run(&["diff", "--name-only", "--diff-filter=U"]).unwrap_or_default().lines().map(String::from).collect();
        let _ = w.run(&["merge", "--abort"]);
        redo.push(Slice {
            id: format!("{}-merge", s.id),
            module: s.module.clone(),
            scope: s.scope.clone(),
            tests: s.tests.clone(),
            blast: s.blast.clone(),
            agent: s.agent.clone(),
            base_ref: branch.clone(),
            state: SliceState::Queued,
            reasons: vec![format!("slice {} conflicted with the integration branch in {}; redo it on top", s.id, files.join(", "))],
            ..Default::default()
        });
        t.conflicts.push((s.id.clone(), files));
    }
    t.head = w.run(&["rev-parse", "HEAD"])?.trim().to_string();

    let v = gate::gate(plan, &whole, &wt)?;
    t.verdict = v.verdict.as_str().to_string();
    t.reasons = v.reasons;
    t.notes = v.notes;

    plan.slices.extend(redo);
    repo.run(&["worktree", "remove", "--force", &wt.to_string_lossy()])?;
    Ok(t)
}
