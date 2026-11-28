//! The swarm operation log on `refs/kula/ops`: one commit per operation, each
//! recording a VIEW – the head of every seat in the run at that moment – plus
//! the run id and the parent op. Everything is append only: undo is a new op
//! whose view equals an earlier op's view; nothing is ever deleted or rewritten.
//!
//! An op id is the op's own commit oid (content addressed, unique, ordered by
//! the ref log), so it survives reflog trims like any other commit.

use crate::git::Repo;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The ref the op log lives on; its head is the latest op.
pub const OPS_REF: &str = "refs/kula/ops";
/// Saves live under `refs/kula/saves/<seat>/<n>`.
pub const SAVES_PREFIX: &str = "refs/kula/saves";
/// File inside an op commit holding the op document.
const OP_FILE: &str = "op.json";
/// Minimum seconds between autosaves of the same seat.
const MIN_SAVE_SECS: u64 = 30;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OpKind {
    /// A run started; the view is every seat at its base.
    Launch,
    /// An autosave of one seat's worktree.
    Save,
    /// A slice's work was committed to its branch.
    Commit,
    /// A hand-off between seats was recorded.
    Handoff,
    /// A gate verdict was recorded.
    Gate,
    /// A slice's branch was merged into the plan's base.
    Merge,
    /// Undo: the view equals an earlier op's view.
    Undo,
}

impl OpKind {
    pub fn as_str(self) -> &'static str {
        match self {
            OpKind::Launch => "launch",
            OpKind::Save => "save",
            OpKind::Commit => "commit",
            OpKind::Handoff => "handoff",
            OpKind::Gate => "gate",
            OpKind::Merge => "merge",
            OpKind::Undo => "undo",
        }
    }
}

/// One operation in the swarm log.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Op {
    /// The op commit's own oid – the op id.
    pub id: String,
    pub kind: String,
    /// The run this op belongs to (`<plan>-<started>`).
    #[serde(default)]
    pub run: String,
    /// The parent op's id, empty for the first op.
    #[serde(default)]
    pub parent: String,
    /// The view: seat id (team seat or slice id) → commit at this moment.
    #[serde(default)]
    pub view: BTreeMap<String, String>,
    /// Seat this op concerns (save/commit/gate ops).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub seat: String,
    /// What the op says, one line.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub message: String,
    /// Unix seconds when the op was appended.
    #[serde(default)]
    pub time: i64,
    /// For undo ops: the op (or save ref) the view was restored from.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub undo_of: String,
}

impl Op {
    pub fn kind(&self) -> Result<OpKind> {
        match self.kind.as_str() {
            "launch" => Ok(OpKind::Launch),
            "save" => Ok(OpKind::Save),
            "commit" => Ok(OpKind::Commit),
            "handoff" => Ok(OpKind::Handoff),
            "gate" => Ok(OpKind::Gate),
            "merge" => Ok(OpKind::Merge),
            "undo" => Ok(OpKind::Undo),
            other => bail!("unknown op kind {other:?}"),
        }
    }
}

fn commit_tree(repo: &Repo, tree: &str, parents: &[&str], message: &str) -> Result<String> {
    let mut args: Vec<String> = vec!["commit-tree".into(), tree.to_string(), "-m".into(), message.to_string()];
    for p in parents {
        args.push("-p".into());
        args.push(p.to_string());
    }
    // Inline identity: op commits must not depend on the repo's git config.
    let mut all: Vec<String> = vec!["-c".into(), "user.name=kula".into(), "-c".into(), "user.email=kula@localhost".into()];
    all.extend(args);
    let refs: Vec<&str> = all.iter().map(String::as_str).collect();
    Ok(repo.run(&refs)?.trim().to_string())
}

/// Append an op: one commit on `refs/kula/ops`, ref updated in one atomic
/// `git update-ref` so concurrent readers never see a torn log.
pub fn append_op(repo: &Repo, kind: OpKind, run: &str, view: BTreeMap<String, String>, message: &str) -> Result<Op> {
    append_op_seat(repo, kind, run, "", view, message)
}

/// Like `append_op`, for ops that concern one seat.
pub fn append_op_seat(repo: &Repo, kind: OpKind, run: &str, seat: &str, view: BTreeMap<String, String>, message: &str) -> Result<Op> {
    let parent = head(repo);
    let op = Op {
        id: String::new(),
        kind: kind.as_str().into(),
        run: run.into(),
        seat: seat.into(),
        parent: parent.clone().unwrap_or_default(),
        view,
        message: message.into(),
        time: crate::meta::now(),
        ..Default::default()
    };
    let json = serde_json::to_vec_pretty(&op)?;
    let blob = repo.run_stdin(&["hash-object", "-w", "--stdin"], &json)?.trim().to_string();
    let tree = repo.run_stdin(&["mktree"], format!("100644 blob {blob}\t{OP_FILE}\n").as_bytes())?.trim().to_string();
    let parents: Vec<&str> = parent.iter().map(String::as_str).collect();
    let msg = format!("kula op: {} {message}", kind.as_str());
    let id = commit_tree(repo, &tree, &parents, &msg)?;
    repo.run(&["update-ref", OPS_REF, &id])?;
    Ok(Op { id, ..op })
}

/// The current head op id, if the log exists.
pub fn head(repo: &Repo) -> Option<String> {
    repo.run(&["rev-parse", "--verify", "--quiet", OPS_REF]).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Read one op document out of its commit.
fn read_op(repo: &Repo, id: &str) -> Result<Op> {
    let s = repo.run(&["show", &format!("{id}:{OP_FILE}")])?;
    let mut op: Op = serde_json::from_str(&s)?;
    op.id = id.to_string();
    Ok(op)
}

/// The log, newest first. `rev` defaults to the ref head.
pub fn ops(repo: &Repo, limit: usize) -> Result<Vec<Op>> {
    ops_from(repo, OPS_REF, limit)
}

fn ops_from(repo: &Repo, rev: &str, limit: usize) -> Result<Vec<Op>> {
    let n = format!("-n{limit}");
    let fmt = "--format=%H%x1f%at%x1e";
    let text = match repo.run(&["log", &n, fmt, "--topo-order", rev]) {
        Ok(t) => t,
        Err(_) => return Ok(vec![]), // no log yet
    };
    let mut out = vec![];
    for rec in text.split('\x1e').filter(|r| !r.trim().is_empty()) {
        let f: Vec<&str> = rec.trim_start_matches('\n').split('\x1f').collect();
        if f.len() < 2 {
            continue;
        }
        out.push(read_op(repo, f[0])?);
    }
    Ok(out)
}

/// One op by id (any commit reachable from the log, so undo targets work).
pub fn op(repo: &Repo, id: &str) -> Result<Op> {
    crate::git::validate_rev(id)?;
    let oid = repo.run(&["rev-parse", "--verify", &format!("{id}^{{commit}}")])?.trim().to_string();
    read_op(repo, &oid)
}

/// The view recorded at op `id`.
pub fn view_at(repo: &Repo, id: &str) -> Result<BTreeMap<String, String>> {
    Ok(op(repo, id)?.view)
}

/// The latest save ref for a seat, with its tree id.
pub fn last_save(repo: &Repo, seat: &str) -> Option<(String, String)> {
    let (refname, commit, _, _) = saves(repo, seat, 1).into_iter().next()?;
    let tree = repo.run(&["rev-parse", &format!("{commit}^{{tree}}")]).ok()?.trim().to_string();
    Some((refname, tree))
}

/// A seat's autosaves, newest first: `(ref, commit, tree, time)`.
pub fn saves(repo: &Repo, seat: &str, limit: usize) -> Vec<(String, String, String, i64)> {
    let r = format!("{SAVES_PREFIX}/{seat}");
    // for-each-ref does not expand %xNN hex escapes, so the fields are joined
    // with a literal bar – save refnames never contain one.
    let fmt = "--format=%(refname)|%(objectname)|%at";
    let Ok(text) = repo.run(&["for-each-ref", "--sort=-refname", fmt, &format!("{r}/*")]) else {
        return vec![];
    };
    let mut out = vec![];
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let f: Vec<&str> = line.split('|').collect();
        if f.len() < 3 {
            continue;
        }
        let tree = repo.run(&["rev-parse", &format!("{}^{{tree}}", f[1])]).unwrap_or_default();
        out.push((f[0].trim().to_string(), f[1].trim().to_string(), tree.trim().to_string(), f[2].trim().parse().unwrap_or(0)));
    }
    // refname sort is lexical, so save 10 sorts before save 2 – order by number.
    out.sort_by_key(|(r, _, _, _)| std::cmp::Reverse(save_n(r)));
    out.truncate(limit);
    out
}

/// The `<n>` in `refs/kula/saves/<seat>/<n>`.
pub fn save_n(refname: &str) -> u64 {
    refname.rsplit('/').next().and_then(|s| s.parse().ok()).unwrap_or(0)
}

/// Next save number for a seat: one past the highest, so saves only append.
fn next_save_n(repo: &Repo, seat: &str) -> u64 {
    saves(repo, seat, 1).first().map(|(r, _, _, _)| save_n(r) + 1).unwrap_or(1)
}

/// Seconds since a seat's last save op (0 if it never saved).
fn secs_since_last_save(repo: &Repo, seat: &str) -> u64 {
    if let Ok(list) = ops_from(repo, OPS_REF, 200) {
        if let Some(t) = list.iter().find(|o| o.kind == "save" && o.seat == seat).map(|o| o.time) {
            let now = crate::meta::now();
            return now.saturating_sub(t) as u64;
        }
    }
    u64::MAX
}

/// Snapshot one seat's worktree without touching its branch or HEAD: a
/// temporary index + `git commit-tree`, stored under `refs/kula/saves/<seat>/<n>`.
/// Dedupes on the tree id, throttled to one save per seat per 30 s
/// (`KULA_SAVE_MIN_SECS` overrides it). Returns the save op, if one was made.
pub fn autosave(repo: &Repo, wt: &std::path::Path, seat: &str, run: &str, message: &str) -> Result<Option<Op>> {
    let min = std::env::var("KULA_SAVE_MIN_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(MIN_SAVE_SECS);
    autosave_with(repo, wt, seat, run, message, min)
}

/// `autosave` with an explicit throttle, so tests never race over env vars.
pub fn autosave_with(repo: &Repo, wt: &std::path::Path, seat: &str, run: &str, message: &str, min_secs: u64) -> Result<Option<Op>> {
    let min = min_secs;
    if secs_since_last_save(repo, seat) < min {
        return Ok(None); // throttled
    }
    let tree = match crate::git::commit_tree_temp_index(repo, wt) {
        Ok(t) => t,
        Err(e) => {
            // An unreadable worktree is not fatal to a run: note it and move on.
            eprintln!("kula: could not snapshot seat {seat}: {e:#}");
            return Ok(None);
        }
    };
    if let Some((_, last_tree)) = last_save(repo, seat) {
        if last_tree == tree {
            return Ok(None); // nothing changed since the last save
        }
    }
    let n = next_save_n(repo, seat);
    let msg = format!("kula save: seat {seat} ({message})");
    let commit = crate::git::save_commit(repo, &tree, &msg)?;
    let r = format!("{SAVES_PREFIX}/{seat}/{n}");
    repo.run(&["update-ref", &r, &commit])?;
    let mut view = BTreeMap::new();
    view.insert(seat.to_string(), commit.clone());
    Ok(Some(append_op_seat(repo, OpKind::Save, run, seat, view, &msg)?))
}

/// Restore a seat's worktree to a save's commit (branch untouched).
pub fn restore_save(repo: &Repo, wt: &std::path::Path, seat: &str, n: u64, run: &str) -> Result<Op> {
    let r = format!("{SAVES_PREFIX}/{seat}/{n}");
    let commit = repo.run(&["rev-parse", "--verify", &r])?.trim().to_string();
    crate::git::reset_worktree_to(wt, &commit)?;
    let mut view = BTreeMap::new();
    view.insert(seat.to_string(), commit.clone());
    Ok(append_op(repo, OpKind::Save, run, view, &format!("restored seat {seat} to save {n}"))?)
}

/// Fork a seat's work into a new branch from any commit (an op view entry or a
/// save). The original branch is never touched; a new worktree is created.
pub fn fork_from(repo: &Repo, commit: &str, seat: &str, name: &str) -> Result<(String, std::path::PathBuf)> {
    crate::git::validate_rev(commit)?;
    let c = repo.run(&["rev-parse", "--verify", &format!("{commit}^{{commit}}")])?.trim().to_string();
    let branch = format!("kula/fork/{seat}/{name}");
    let wt = repo.kula_dir().join("worktrees").join("forks").join(format!("{seat}-{name}"));
    if wt.exists() {
        let _ = repo.run(&["worktree", "remove", "--force", &wt.to_string_lossy()]);
    }
    let _ = repo.run(&["worktree", "prune"]);
    std::fs::create_dir_all(wt.parent().unwrap())?;
    repo.run(&["worktree", "add", "-q", "-b", &branch, &wt.to_string_lossy(), &c])?;
    Ok((branch, wt))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    pub(super) fn repo() -> (TempDir, Repo) {
        let t = tempfile::tempdir().unwrap();
        let d = t.path();
        let git = |args: &[&str]| {
            let o = std::process::Command::new("git").arg("-C").arg(d).args(args).output().unwrap();
            assert!(o.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&o.stderr));
            String::from_utf8_lossy(&o.stdout).into_owned()
        };
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.name", "Tester"]);
        git(&["config", "user.email", "t@example.com"]);
        std::fs::write(d.join("f.txt"), "one\n").unwrap();
        git(&["add", "-A"]);
        git(&["commit", "-qm", "initial"]);
        let repo = Repo { root: d.to_path_buf() };
        (t, repo)
    }

    pub(super) fn view_of(repo: &Repo) -> BTreeMap<String, String> {
        BTreeMap::from([("seat/a".into(), repo.run(&["rev-parse", "HEAD"]).unwrap().trim().to_string())])
    }

    #[test]
    fn op_ids_are_unique_and_ordered() {
        let (_t, r) = repo();
        let mut ids = vec![];
        for i in 0..5 {
            let op = append_op(&r, OpKind::Commit, "run-1", view_of(&r), &format!("op {i}")).unwrap();
            assert_eq!(op.parent, ids.last().cloned().unwrap_or_default(), "each op chains to the previous");
            ids.push(op.id);
        }
        assert_eq!(ids.len(), std::collections::HashSet::<String>::from_iter(ids.iter().cloned()).len(), "op ids unique");
        let list = ops(&r, 10).unwrap();
        let list_ids: Vec<String> = list.iter().map(|o| o.id.clone()).collect();
        assert_eq!(list_ids, ids.iter().rev().cloned().collect::<Vec<_>>(), "log is ordered, newest first");
        assert!(list.windows(2).all(|w| w[0].time >= w[1].time), "times are monotonic");
    }

    #[test]
    fn view_at_reads_back_the_recorded_view() {
        let (_t, r) = repo();
        let mut v = view_of(&r);
        v.insert("seat/b".into(), "0123456789abcdef0123456789abcdef01234567".into());
        let launch = append_op(&r, OpKind::Launch, "run-1", v.clone(), "launch").unwrap();
        assert_eq!(view_at(&r, &launch.id).unwrap(), v);
        assert_eq!(op(&r, &launch.id).unwrap().kind().unwrap(), OpKind::Launch);
        assert_eq!(head(&r).unwrap(), launch.id);
    }

    #[test]
    fn autosave_dedupes_and_throttles() {
        let (_t, r) = repo();
        let wt = r.root.clone();
        std::fs::write(wt.join("f.txt"), "two\n").unwrap();
        let s1 = autosave_with(&r, &wt, "a", "run-1", "test", 0).unwrap().unwrap();
        assert_eq!(save_n(&format!("{SAVES_PREFIX}/a/1")), 1);
        let s2 = autosave_with(&r, &wt, "a", "run-1", "test", 0).unwrap();
        assert!(s2.is_none(), "unchanged tree must dedupe");
        std::fs::write(wt.join("f.txt"), "three\n").unwrap();
        let s3 = autosave_with(&r, &wt, "a", "run-1", "test", 0).unwrap().unwrap();
        assert_ne!(s1.id, s3.id);
        assert_eq!(saves(&r, "a", 10).len(), 2);
        let s4 = autosave_with(&r, &wt, "a", "run-1", "test", 30).unwrap();
        assert!(s4.is_none(), "throttled within 30 s of the last save");
    }

    #[test]
    fn restore_and_fork_leave_the_branch_alone() {
        let (_t, r) = repo();
        let wt = r.root.clone();
        let base = r.run(&["rev-parse", "HEAD"]).unwrap().trim().to_string();
        std::fs::write(wt.join("f.txt"), "saved\n").unwrap();
        autosave_with(&r, &wt, "a", "run-1", "test", 0).unwrap();
        std::fs::write(wt.join("f.txt"), "lost\n").unwrap();
        restore_save(&r, &wt, "a", 1, "run-1").unwrap();
        assert_eq!(std::fs::read_to_string(wt.join("f.txt")).unwrap(), "saved\n");
        assert_eq!(r.run(&["rev-parse", "HEAD"]).unwrap().trim(), base, "HEAD must not move");
        let (branch, fwt) = fork_from(&r, &base, "a", "retry").unwrap();
        assert_eq!(r.run(&["rev-parse", &branch]).unwrap().trim(), base);
        assert!(fwt.join("f.txt").exists());
    }
}

/// Undo: a new op whose view equals an earlier op's (or save's) view. Every
/// seat's worktree is reset to its entry in that view; branches, the log and
/// all earlier ops are left untouched. `target` is an op id (or short sha) or
/// a save ref `refs/kula/saves/<seat>/<n>`.
pub fn undo_to(repo: &Repo, target: &str, run: &str) -> Result<Op> {
    let (view, undo_of) = if let Some(rest) = target.strip_prefix(SAVES_PREFIX).filter(|r| r.starts_with('/')) {
        let seat = rest.trim_start_matches('/').rsplit_once('/').map(|(s, _)| s.to_string()).ok_or_else(|| anyhow::anyhow!("bad save ref"))?;
        let commit = repo.run(&["rev-parse", "--verify", target])?.trim().to_string();
        let mut v = BTreeMap::new();
        v.insert(seat, commit);
        (v, target.to_string())
    } else {
        let o = op(repo, target)?;
        (o.view.clone(), o.id.clone())
    };
    if view.is_empty() {
        bail!("the target records an empty view – nothing to undo to");
    }
    // Load the plan so seat entries map back to their worktrees.
    let plan_path = crate::orch::task::default_path(repo);
    match crate::orch::task::Plan::load(&plan_path) {
        Ok(plan) => {
            let n = crate::orch::run::apply_view(repo, &plan, &view)?;
            let _ = n;
        }
        Err(e) => eprintln!("kula: could not reset worktrees (view recorded anyway): {e:#}"),
    }
    let msg = format!("undo to {undo_of}");
    let mut o = append_op(repo, OpKind::Undo, run, view, &msg)?;
    o.undo_of = undo_of;
    Ok(o)
}

#[cfg(test)]
mod property_tests {
    use super::tests::*;
    use super::*;
    use tempfile::TempDir;

    /// Deterministic LCG so the "property" is reproducible without a dep.
    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            self.0 >> 33
        }
    }

    /// Property: undo of undo restores the earlier view; op ids stay unique and
    /// ordered no matter how the undo/save/commit churn interleaves.
    #[test]
    fn undo_of_undo_restores_the_view() {
        let (t, r): (TempDir, crate::git::Repo) = repo();
        let wt = r.root.clone();
        let mut rng = Lcg(0xC0FFEE);
        let mut seen_ids = std::collections::HashSet::new();
        let mut last_parent = String::new();
        let mut marker_at_view: Vec<(usize, String)> = vec![]; // (marker, undo target)

        for i in 0..24u64 {
            // Evolve the worktree with a pseudo-random change.
            let marker = format!("change-{i}-{}", rng.next() % 1000);
            std::fs::write(wt.join("f.txt"), format!("{marker}\n")).unwrap();
            let op = match rng.next() % 3 {
                0 => autosave_with(&r, &wt, "a", "run-1", &marker, 0).unwrap().expect("new tree must save"),
                1 => append_op(&r, OpKind::Commit, "run-1", view_of(&r), &marker).unwrap(),
                _ => append_op(&r, OpKind::Gate, "run-1", view_of(&r), &marker).unwrap(),
            };
            assert!(!seen_ids.contains(&op.id), "op ids must be unique");
            assert_eq!(op.parent, last_parent, "each op chains to the previous");
            seen_ids.insert(op.id.clone());
            last_parent = op.id.clone();
            if rng.next() % 4 == 0 {
                marker_at_view.push((marker.len(), op.id.clone()));
            }
            // Every few ops, undo to an earlier view and undo the undo.
            if i % 7 == 6 && !marker_at_view.is_empty() {
                let (_, target) = marker_at_view[(i as usize) % marker_at_view.len()].clone();
                let u1 = undo_to(&r, &target, "run-1").unwrap();
                assert_eq!(u1.view, op_at(&r, &target).view, "undo op records the target's view");
                let u2 = undo_to(&r, &u1.id, "run-1").unwrap();
                assert_eq!(u2.view, u1.view, "undo of undo restores the same view");
                seen_ids.insert(u1.id.clone());
                seen_ids.insert(u2.id.clone());
                last_parent = u2.id.clone();
            }
        }
        let log = ops(&r, 100).unwrap();
        let ids: Vec<&String> = log.iter().map(|o| &o.id).collect();
        assert_eq!(ids.len(), std::collections::HashSet::<&String>::from_iter(ids.iter().copied()).len(), "final log has unique ids");
        for w in log.windows(2) {
            assert_eq!(w[1].id, w[0].parent, "the log chain is intact, newest first");
        }
    }

    fn op_at(r: &crate::git::Repo, id: &str) -> Op {
        op(r, id).unwrap()
    }
}
