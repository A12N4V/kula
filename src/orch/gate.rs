//! `kula gate <slice>`: judge a slice's tree. Scope and fences reject; dangling
//! callers, failing tests and new module cycles send it back to be fixed.

use super::blast;
use super::task::{in_scope, Plan, Slice};
use crate::git::Repo;
use crate::map::{arch, tree};
use crate::store::Store;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Pass,
    Fix,
    Reject,
}

impl Outcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Pass => "pass",
            Outcome::Fix => "fix",
            Outcome::Reject => "reject",
        }
    }
    pub fn code(self) -> i32 {
        match self {
            Outcome::Pass => 0,
            Outcome::Fix => 1,
            Outcome::Reject => 2,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Verdict {
    pub verdict: Outcome,
    pub reasons: Vec<String>,
    /// Files the slice changed or added.
    pub changed: Vec<String>,
    /// Worth a look but not blocking: the change reaching past its blast radius.
    #[serde(default)]
    pub notes: Vec<String>,
}

/// Files changed against `base` plus untracked ones git does not ignore,
/// leaving out kula's own state.
pub fn changed_files(repo: &Repo, base: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut add = |s: String| {
        for l in s.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with(".kula/")) {
            if !out.iter().any(|o| o == l) {
                out.push(l.to_string());
            }
        }
    };
    let base = if base.is_empty() { "HEAD" } else { base };
    add(repo.run(&["diff", "--name-only", base]).unwrap_or_default());
    add(repo.run(&["ls-files", "--others", "--exclude-standard"]).unwrap_or_default());
    out.sort();
    out
}

fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// The last `n` lines of some output.
pub fn tail(s: &str, n: usize) -> String {
    let lines: Vec<&str> = s.lines().collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

/// Runs the plan's test command for this slice. `None` when skipped.
fn run_tests(plan: &Plan, slice: &Slice, dir: &Path) -> Option<(bool, String)> {
    let cmd = plan.test_cmd.as_deref()?.trim();
    if cmd.is_empty() {
        return None;
    }
    let cmd = if cmd.contains("{tests}") {
        if slice.tests.is_empty() {
            return None;
        }
        cmd.replace("{tests}", &slice.tests.iter().map(|t| sh_quote(t)).collect::<Vec<_>>().join(" "))
    } else {
        cmd.to_string()
    };
    let out = Command::new("sh").arg("-c").arg(&cmd).current_dir(dir).env("KULA_SLICE", &slice.id).output();
    match out {
        Ok(o) => {
            let text = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
            Some((o.status.success(), tail(&text, 20)))
        }
        Err(e) => Some((false, format!("could not run `{cmd}`: {e}"))),
    }
}

/// The tree's graph, freshly indexed.
fn fresh_store(repo: &Repo) -> Option<Store> {
    crate::index::run(repo, true).ok()?;
    Store::open(repo).ok()
}

/// Module cycles in the tree that were not there when the plan was made.
fn new_cycles(plan: &Plan, repo: &Repo, st: &Store) -> Vec<Vec<String>> {
    let mt = tree::module_tree(&repo.root, st);
    arch::check(&mt, st)
        .cycles
        .into_iter()
        .map(|mut c| {
            c.sort();
            c.dedup();
            c
        })
        .filter(|c| !plan.baseline_cycles.contains(c))
        .collect()
}

pub fn gate(plan: &Plan, slice: &Slice, dir: &Path) -> Result<Verdict> {
    let repo = Repo::discover(dir)?;
    let changed = changed_files(&repo, &slice.base_ref);
    let mut reject = Vec::new();
    let mut fix = Vec::new();
    let mut notes = Vec::new();

    for f in &changed {
        if !in_scope(f, &slice.scope) && !slice.tests.contains(f) {
            reject.push(format!("{f} is outside this slice's scope ({})", slice.scope.join(", ")));
        }
    }
    if let Ok(v) = crate::agent::verify_edit(&repo, Some(&slice.agent)) {
        for (p, why) in &v.guard_violations {
            reject.push(format!("{p} is fenced: {}", why.reason));
        }
        for d in &v.dangling {
            fix.push(format!("dangling caller: {d}"));
        }
    }
    if reject.is_empty() {
        if let Some((ok, out)) = run_tests(plan, slice, dir) {
            if !ok {
                fix.push(format!("tests failed:\n{out}"));
            }
        }
        if let Some(st) = fresh_store(&repo) {
            for c in new_cycles(plan, &repo, &st) {
                fix.push(format!("new module cycle: {}", c.join(" ↔ ")));
            }
            if !changed.is_empty() {
                let mut expected = slice.blast.clone();
                expected.extend(slice.tests.iter().cloned());
                let far = blast::beyond(&blast::radius(&st, &changed), &expected, &slice.scope);
                if !far.is_empty() {
                    let shown: Vec<&str> = far.iter().take(5).map(String::as_str).collect();
                    let more = if far.len() > 5 { format!(" and {} more", far.len() - 5) } else { String::new() };
                    notes.push(format!("reaches past the planned blast radius: {}{more}", shown.join(", ")));
                }
            }
        }
    }

    let (verdict, reasons) = if !reject.is_empty() {
        (Outcome::Reject, reject)
    } else if !fix.is_empty() {
        (Outcome::Fix, fix)
    } else {
        (Outcome::Pass, vec![])
    };
    Ok(Verdict { verdict, reasons, changed, notes })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outcome_order_and_tail() {
        assert!(Outcome::Reject > Outcome::Fix && Outcome::Fix > Outcome::Pass);
        assert_eq!(tail("a\nb\nc", 2), "b\nc");
        assert_eq!(sh_quote("it's"), "'it'\\''s'");
    }
}
