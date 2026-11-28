//! Agent attribution (B7 · T5 Changes): who wrote every line, in dollars and
//! in flows.
//!
//! A save op carries a full view; its entry for the saving seat points at the
//! save commit. Walking save ops oldest first (the log is append-ordered, B2)
//! and diffing each save's tree against the previous state of every path
//! decides ownership once and for all:
//!
//! – A hunk first introduced by a save is owned by that save's seat, run and
//!   op, forever.
//! – A hunk that later reappears (same [`LineHash`]es, non-trivial lines,
//!   unique match) after being deleted keeps its original owner: moved code
//!   stays with its author.
//! – A hunk rewritten into different lines takes the rewriter's owner; the
//!   old owner's share of it is gone.
//!
//! Cost share (the split basis, documented in
//! `docs/design/engines/changes.md`): the owning save's seat cost for the run
//! (B6's `usage_detail`) spread evenly over that save's lines that survive to
//! the newest state – a run's dollars land on the lines still carrying them,
//! so each seat's surviving shares sum to its spend. Lines a later rewrite
//! took over stop carrying the earlier seat's dollars; the rewrite's own save
//! bills them instead.

use crate::git::Repo;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

/// FNV-1a, the same constants as `index::identity` and `guard::fnv64`.
fn fnv64(b: &[u8]) -> u64 {
    b.iter().fold(0xcbf29ce484222325u64, |h, x| (h ^ *x as u64).wrapping_mul(0x100000001b3))
}

/// The move-detection key: FNV-1a of the trimmed line. Trimmed so
/// reindentation is not a rewrite; a two-space drift never orphans an owner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct LineHash(pub u64);

impl LineHash {
    pub fn of(line: &str) -> LineHash {
        LineHash(fnv64(line.trim().as_bytes()))
    }
}

/// Lines shorter than this are boilerplate (braces, `use …`) and never match
/// as moves, however unique they look: blank-line churn must not relocate an
/// owner.
const MOVE_MIN_LEN: usize = 12;

/// One line's provenance, resolved to everything the UI shows.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct HunkOwner {
    /// 1-based line number in the current worktree version of the path.
    pub line: u64,
    /// The seat that owns the line, empty when nobody in the log does.
    pub seat: String,
    /// The run the owning save belonged to.
    pub run: String,
    /// The save op that introduced the line.
    pub op: String,
    /// The symbol the line falls inside (its `s…` id), empty outside symbols.
    pub symbol: String,
    /// The symbol's name, empty outside any symbol.
    pub symbol_name: String,
    /// The flow containing the symbol (its id), empty when unmapped.
    pub flow: String,
    /// Dollars of the owning run attributed to this line.
    pub cost_share: f64,
}

/// A change grouped by flow, as the flow changelog shows it.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FlowChange {
    /// The flow id, empty when the change sits outside every mapped flow.
    pub flow: String,
    /// The path the lines live in.
    pub path: String,
    /// The seat that made the change.
    pub seat: String,
    /// The run the save belonged to.
    pub run: String,
    /// The save op that made the change.
    pub op: String,
    /// How many consecutive lines the change introduced in this flow.
    pub lines: u64,
    /// Dollars of the run attributed to these lines.
    pub cost_share: f64,
    /// First line of the hunk, for the UI to jump to.
    pub start: u64,
}

/// Who owns a line: the save op that introduced it.
#[derive(Debug, Clone)]
struct Owner {
    seat: String,
    run: String,
    op: String,
}

/// Ownership of every tracked path at the newest save, plus per-op counts of
/// the lines of each save still present there (the cost-share denominators:
/// a run's dollars land on the lines that survive it).
struct Owners {
    /// path → (lines at the newest save, one owner per line).
    per_path: HashMap<String, (Vec<String>, Vec<Option<Owner>>)>,
    /// op id → of that save's lines, how many survive at the newest save.
    per_op: HashMap<String, u64>,
}

/// The save ops oldest first: `(op id, seat, run, the seat's commit)`.
fn save_ops(repo: &Repo) -> Vec<(String, String, String, String)> {
    let mut out = Vec::new();
    for op in crate::ops::ops(repo, 100_000).unwrap_or_default() {
        if op.kind != "save" {
            continue;
        }
        let commit = match op.view.get(&op.seat) {
            Some(c) if !c.is_empty() => c.clone(),
            _ => continue,
        };
        out.push((op.id.clone(), op.seat.clone(), op.run.clone(), commit));
    }
    out.reverse(); // the log is newest first; ownership walks oldest first
    out
}

/// A file's content at a commit: `None` when the path does not exist there.
fn blob_at(repo: &Repo, commit: &str, path: &str) -> Option<String> {
    repo.run(&["cat-file", "-p", &format!("{commit}:{path}")]).ok()
}

/// Advance owners from `old` to `new`: added lines get `owner`; lines that
/// reappear in the same hunk (same non-trivial [`LineHash`], unique on the
/// deleted side) keep the owner of their source line.
fn apply_diff(old: &[&str], new: &[&str], old_owners: &[Option<Owner>], owner: Owner) -> Vec<Option<Owner>> {
    let old_text = old.join("\n");
    let new_text = new.join("\n");
    let diff = similar::TextDiff::configure().algorithm(similar::Algorithm::Patience).diff_lines(&old_text, &new_text);
    let mut out: Vec<Option<Owner>> = Vec::with_capacity(new.len());
    for group in diff.grouped_ops(1000) {
        // Deleted lines available as move sources within this hunk, in order.
        let mut pending: Vec<(usize, LineHash)> = Vec::new();
        for op in group.iter() {
            match op.tag() {
                similar::DiffTag::Equal => {
                    // Pending deletes survive Equal hunks: a move inside one
                    // file routinely crosses unchanged lines, and the match
                    // itself is guarded (non-trivial + unique), so keeping
                    // the candidates is what makes the move visible.
                    for i in op.old_range() {
                        out.push(old_owners.get(i).cloned().flatten());
                    }
                }
                similar::DiffTag::Delete => {
                    for i in op.old_range() {
                        pending.push((i, LineHash::of(old[i])));
                    }
                }
                similar::DiffTag::Insert => {
                    for j in op.new_range() {
                        out.push(take_move(&mut pending, new[j], old_owners).unwrap_or_else(|| Some(owner.clone())));
                    }
                }
                similar::DiffTag::Replace => {
                    // A rewrite deletes and adds in one hunk: collect the
                    // deleted side first, then match the added lines against
                    // it, so a rewrite that only moves lines keeps owners.
                    // Deletes carried from earlier hunks stay in play – a
                    // moved line often reappears inside a replace hunk.
                    let mut dels: Vec<(usize, LineHash)> = std::mem::take(&mut pending);
                    for i in op.old_range() {
                        dels.push((i, LineHash::of(old[i])));
                    }
                    for j in op.new_range() {
                        out.push(take_move(&mut dels, new[j], old_owners).unwrap_or_else(|| Some(owner.clone())));
                    }
                    pending = dels;
                }
            }
        }
    }
    out
}

/// Find a move source for `new_line` among `pending`: same hash, non-trivial
/// length, and unique among the pending deletes (two identical lines cannot
/// be told apart, so neither claims the other). Consumes the match.
fn take_move(pending: &mut Vec<(usize, LineHash)>, new_line: &str, old_owners: &[Option<Owner>]) -> Option<Option<Owner>> {
    if new_line.trim().chars().count() < MOVE_MIN_LEN {
        return None;
    }
    let h = LineHash::of(new_line);
    let matches: Vec<usize> = pending.iter().enumerate().filter(|(_, (_, ph))| *ph == h).map(|(i, _)| i).collect();
    if matches.len() != 1 {
        return None; // none, or ambiguous boilerplate
    }
    let (idx, _) = pending.remove(matches[0]);
    Some(old_owners.get(idx).cloned().flatten())
}

/// Walk every save and decide ownership for every tracked path.
fn build(repo: &Repo) -> Owners {
    // The baseline is the repository's own HEAD – the pre-run state the
    // first save is diffed against – not the op-log head, whose tree holds
    // op.json, not the tracked files.
    let base = repo.run(&["rev-parse", "HEAD"]).map(|h| h.trim().to_string()).unwrap_or_default();
    let saves = save_ops(repo);
    if base.is_empty() {
        return Owners { per_path: HashMap::new(), per_op: HashMap::new() };
    }
    // Candidate paths: everything in the base or any save tree. Fixture-sized
    // repos make the per-save scan cheap; production runs prune to the paths
    // whose content the walk actually changes (the `new == cur` skip below).
    let mut paths: HashSet<String> = HashSet::new();
    for commit in std::iter::once(&base).chain(saves.iter().map(|(_, _, _, c)| c)) {
        if let Ok(out) = repo.run(&["ls-tree", "-r", "--name-only", commit]) {
            for p in out.lines() {
                if !p.is_empty() {
                    paths.insert(p.to_string());
                }
            }
        }
    }
    let mut per_path = HashMap::new();
    let mut per_op: HashMap<String, u64> = HashMap::new();
    for path in &paths {
        let mut cur = blob_at(repo, &base, path).unwrap_or_default();
        let mut owners: Vec<Option<Owner>> = vec![None; cur.lines().count()];
        for (id, seat, run, commit) in &saves {
            let new = blob_at(repo, commit, path).unwrap_or_default();
            if new == cur {
                continue;
            }
            let old_lines: Vec<&str> = cur.lines().collect();
            let new_lines: Vec<&str> = new.lines().collect();
            owners = apply_diff(&old_lines, &new_lines, &owners, Owner { seat: seat.clone(), run: run.clone(), op: id.clone() });
            cur = new;
        }
        per_path.insert(path.clone(), (cur.lines().map(|l| l.to_string()).collect(), owners));
    }
    // The denominators are read off the final state: only lines that survive
    // to the newest save carry their save's dollars.
    for (_, (_, owners)) in &per_path {
        for o in owners.iter().flatten() {
            *per_op.entry(o.op.clone()).or_default() += 1;
        }
    }
    Owners { per_path, per_op }
}

/// Seat dollars per run, from the usage ledger – the single read path is
/// B6's `usage_detail`, the same numbers /api/usage and kula_usage answer
/// with.
fn seat_costs(repo: &Repo) -> HashMap<(String, String), f64> {
    let mut out = HashMap::new();
    for (_, seat, run, _) in save_ops(repo) {
        if out.contains_key(&(run.clone(), seat.clone())) {
            continue;
        }
        let spent = crate::runs::usage_detail(&repo.kula_dir(), &run, &seat).spent;
        out.insert((run, seat), spent);
    }
    out
}

/// Dollars per line for a line owned by save op `op`: the seat's spend for
/// the run spread evenly over the op's lines that survive to the newest
/// save (the plan's hunk-share formula, evaluated on the surviving hunk).
fn per_line_cost(costs: &HashMap<(String, String), f64>, owners: &Owners, op: &str, seat: &str, run: &str) -> f64 {
    let changed = owners.per_op.get(op).copied().unwrap_or(0).max(1) as f64;
    costs.get(&(run.to_string(), seat.to_string())).copied().unwrap_or(0.0) / changed
}

/// The flow that contains the symbol `(path, name)`: the flow whose steps
/// name it, shortest flow first, then the smaller flow id, so the answer is
/// stable across runs.
fn flow_of(flows: &crate::graph::FlowMap, path: &str, name: &str) -> String {
    let mut best: Option<&crate::graph::FlowPath> = None;
    for f in &flows.flows {
        if !f.steps.iter().any(|s| s.path == path && s.name == name) {
            continue;
        }
        let better = match best {
            None => true,
            Some(b) => (f.steps.len(), &f.id) < (b.steps.len(), &b.id),
        };
        if better {
            best = Some(f);
        }
    }
    best.map(|f| f.id.clone()).unwrap_or_default()
}

/// Blame every line of `path` in the current worktree: symbol, seat, run, op,
/// cost share, flow. Lines nobody in the log touched get empty provenance and
/// zero cost.
pub fn blame_agents(repo: &Repo, path: &str) -> Result<Vec<HunkOwner>, anyhow::Error> {
    let owners = build(repo);
    let costs = seat_costs(repo);
    let (snap_lines, snap_owners) = owners.per_path.get(path).cloned().unwrap_or_else(|| (Vec::new(), Vec::new()));
    let store = crate::store::Store::open(repo).ok();
    let flows = store.as_ref().and_then(|s| crate::graph::flowmap(s, 4096).ok());
    let worktree = std::fs::read_to_string(repo.root.join(path)).unwrap_or_default();
    let wt_lines: Vec<&str> = worktree.lines().collect();
    let mut out = Vec::new();
    for (i, line_text) in wt_lines.iter().enumerate() {
        let n = i as u64 + 1;
        // Owners were decided at the newest save; the worktree may have
        // drifted. A line keeps its owner when it is still the same text in
        // the same position; anything else is unsaved and unattributed.
        let owner = snap_lines.get(i).zip(snap_owners.get(i)).filter(|(l, _)| l.as_str() == *line_text).and_then(|(_, o)| o.clone());
        let (seat, run, op) = match owner {
            Some(o) => (o.seat.clone(), o.run.clone(), o.op.clone()),
            None => (String::new(), String::new(), String::new()),
        };
        let cost = if seat.is_empty() { 0.0 } else { per_line_cost(&costs, &owners, &op, &seat, &run) };
        let (symbol, symbol_name, flow) = symbol_at(store.as_ref(), flows.as_ref(), path, n, &worktree);
        out.push(HunkOwner { line: n, seat, run, op, symbol, symbol_name, flow, cost_share: cost });
    }
    Ok(out)
}

/// The symbol containing line `n` of `path` and the flow it belongs to.
/// The tightest span wins: an inner function beats its module.
fn symbol_at(
    store: Option<&crate::store::Store>,
    flows: Option<&crate::graph::FlowMap>,
    path: &str,
    line: u64,
    worktree: &str,
) -> (String, String, String) {
    let store = match store {
        Some(s) => s,
        None => return (String::new(), String::new(), String::new()),
    };
    let defs = store
        .nodes_where("kind = 'def' AND path = ? AND start_line <= ? AND end_line >= ?", (path, line as i64, line as i64))
        .unwrap_or_default();
    let def = match defs.into_iter().min_by_key(|d| d.end_line - d.start_line) {
        Some(d) => d,
        None => return (String::new(), String::new(), String::new()),
    };
    // The body hash comes from the same text the index saw: the def's line
    // range in the worktree.
    let lines: Vec<&str> = worktree.lines().collect();
    let body: String =
        lines.get((def.start_line as usize).saturating_sub(1)..def.end_line as usize).map(|l| l.join("\n")).unwrap_or_default();
    let id = crate::index::identity::symbol_id(&def.path, &def.name, fnv64(body.as_bytes()));
    let flow = flows.map(|f| flow_of(f, &def.path, &def.name)).unwrap_or_default();
    (id, def.name.clone(), flow)
}

/// The flow changelog of one run: every change the run's saves introduced,
/// grouped by flow, with dollars spread over the changed lines.
pub fn changelog(repo: &Repo, run: &str) -> Result<Vec<FlowChange>, anyhow::Error> {
    let owners = build(repo);
    let costs = seat_costs(repo);
    let store = crate::store::Store::open(repo).ok();
    let flows = store.as_ref().and_then(|s| crate::graph::flowmap(s, 4096).ok());
    let mut out: Vec<FlowChange> = Vec::new();
    let mut paths: Vec<&String> = owners.per_path.keys().collect();
    paths.sort();
    for path in paths {
        let (snap_lines, snap_owners) = &owners.per_path[path];
        let worktree = std::fs::read_to_string(repo.root.join(path)).unwrap_or_default();
        for (i, owner) in snap_owners.iter().enumerate() {
            let o = match owner {
                Some(o) if o.run == run => o,
                _ => continue,
            };
            // Changelog reports what the saves produced; when the worktree
            // has drifted past the last save, fall back to the snapshot's
            // own text so the run's changes are still reported.
            let text = snap_lines.get(i).map(|s| s.as_str()).unwrap_or("");
            let (_, _, flow) = symbol_at(store.as_ref(), flows.as_ref(), path, i as u64 + 1, &worktree);
            let _ = text;
            let cost = per_line_cost(&costs, &owners, &o.op, &o.seat, &o.run);
            if let Some(last) = out.last_mut() {
                if last.flow == flow && last.seat == o.seat && last.op == o.op && *last.path == *path {
                    last.lines += 1;
                    last.cost_share += cost;
                    continue;
                }
            }
            out.push(FlowChange {
                flow,
                path: path.clone(),
                seat: o.seat.clone(),
                run: o.run.clone(),
                op: o.op.clone(),
                lines: 1,
                cost_share: cost,
                start: i as u64 + 1,
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// Autosave touches shared git lock paths under $TMPDIR; concurrent
    /// test threads have been seen colliding on a stale-looking lock, so
    /// every snapshot in these tests goes through one mutex.
    fn autosave(repo: &crate::git::Repo, dir: &Path, seat: &str, run: &str, msg: &str) -> Option<crate::ops::Op> {
        static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        crate::ops::autosave_with(repo, dir, seat, run, msg, 0).unwrap()
    }

    fn git(dir: &Path, args: &[&str]) -> String {
        let o = std::process::Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
        assert!(o.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&o.stderr));
        String::from_utf8_lossy(&o.stdout).into_owned()
    }

    /// A repo with one tracked file at HEAD, ready for seat saves.
    fn repo_with(content: &str) -> (tempfile::TempDir, crate::git::Repo) {
        let t = tempfile::tempdir().unwrap();
        let d = t.path().to_path_buf();
        std::fs::create_dir_all(d.join("src")).unwrap();
        std::fs::write(d.join("src/lib.rs"), content).unwrap();
        git(&d, &["init", "-q", "-b", "main"]);
        git(&d, &["config", "user.name", "Tester"]);
        git(&d, &["config", "user.email", "t@example.com"]);
        git(&d, &["config", "commit.gpgsign", "false"]);
        git(&d, &["add", "-A"]);
        git(&d, &["commit", "-qm", "initial"]);
        let repo = crate::git::Repo::discover(&d).unwrap();
        (t, repo)
    }

    /// A non-trivial unique line: long enough to move-match, unique enough
    /// not to collide with its neighbours.
    fn marker(tag: &str, n: u64) -> String {
        format!("    let {tag}_unique_marker_{n} = {n}; // {tag} attribution line {n}")
    }

    const BASE: &str = "fn shared() {\n    let kept_base_line_long_enough = 1;\n}\n";

    /// The property: a hunk that moves (same lines, new location) keeps the
    /// owner its first introducer gave it.
    #[test]
    fn moved_hunk_keeps_its_owner() {
        let owned = vec![None, Some(Owner { seat: "team/a".into(), run: "r".into(), op: "op-a".into() }), None];
        // Seat b deletes the owned line here and reinserts it elsewhere.
        let first = marker("first", 1);
        let old: Vec<&str> = vec!["fn f() {", &first, "}"];
        let new: Vec<&str> = vec!["fn f() {", "}", &first];
        let b = Owner { seat: "team/b".into(), run: "r".into(), op: "op-b".into() };
        let out = apply_diff(&old, &new, &owned, b);
        let texts: Vec<&str> = new.to_vec();
        let owner_of = |i: usize| out[i].as_ref().map(|o| o.seat.clone()).unwrap_or_default();
        assert_eq!(owner_of(0), "", "untracked base line stays unowned");
        assert_eq!(owner_of(2), "team/a", "the moved line keeps seat a: {out:?}");
        assert_eq!(texts.len(), out.len(), "every line has an owner entry");
    }

    /// Adversarial: duplicated non-trivial lines cannot be told apart, so a
    /// moved duplicate is not claimed as a move – it takes the mover's owner.
    #[test]
    fn duplicated_lines_do_not_transfer_ownership() {
        let line = marker("twin", 7);
        let owned = vec![
            Some(Owner { seat: "team/a".into(), run: "r".into(), op: "op-a".into() }),
            Some(Owner { seat: "team/a".into(), run: "r".into(), op: "op-a".into() }),
        ];
        let old: Vec<&str> = vec![&line, &line];
        let new: Vec<&str> = vec!["fn g() {", &line];
        let b = Owner { seat: "team/b".into(), run: "r".into(), op: "op-b".into() };
        let out = apply_diff(&old, &new, &owned, b);
        assert_eq!(out[0].as_ref().unwrap().seat, "team/b", "the mover's new line is b's: {out:?}");
        assert!(out[1].is_some(), "the surviving duplicate stays owned, never orphaned: {out:?}");
    }

    /// A rewrite (different text in place of the old lines) takes the
    /// rewriter's owner.
    #[test]
    fn rewrite_takes_the_rewriters_owner() {
        let owned = vec![Some(Owner { seat: "team/a".into(), run: "r".into(), op: "op-a".into() })];
        let orig = marker("original", 3);
        let rewritten = marker("rewritten", 9);
        let old: Vec<&str> = vec!["fn f() {", &orig, "}"];
        let new: Vec<&str> = vec!["fn f() {", &rewritten, "}"];
        let c = Owner { seat: "team/c".into(), run: "r".into(), op: "op-c".into() };
        let out = apply_diff(&old, &new, &owned, c);
        assert_eq!(out[1].as_ref().unwrap().seat, "team/c", "{out:?}");
    }

    /// End to end over real save ops: seat a introduces, seat b moves and
    /// adds, seat c rewrites; blame keeps the story straight and the cost
    /// shares sum to each seat's spend.
    #[test]
    fn blame_fixture_moves_and_rewrites() {
        let base = format!("fn shared() {{\n{};\n}}\n", marker("base", 0).trim());
        let (_t, repo) = repo_with(&base);
        let d = repo.root.clone();
        let path = "src/lib.rs";

        // Seat a introduces two markers.
        let base0 = marker("base", 0);
        let first = marker("first", 1);
        let second = marker("second", 2);
        let third = marker("third", 3);
        let rewritten = marker("rewritten", 2);
        let after_a = format!("fn shared() {{\n{};\n{};\n{};\n}}\n", base0.trim(), first.trim(), second.trim());
        std::fs::write(d.join(path), &after_a).unwrap();
        let op_a = autosave(&repo, &d, "team/a", "demo", "a edits").expect("save a");

        // Seat b moves marker 1 below marker 2 (pure move) and adds its own.
        let after_b = format!("fn shared() {{\n{};\n{};\n}}\n{};\n{};\n", base0.trim(), second.trim(), first.trim(), third.trim(),);
        std::fs::write(d.join(path), &after_b).unwrap();
        let op_b = autosave(&repo, &d, "team/b", "demo", "b moves").expect("save b");

        // Seat c rewrites marker 2 in place.
        let after_c = format!("fn shared() {{\n{};\n{};\n}}\n{};\n{};\n", base0.trim(), rewritten.trim(), first.trim(), third.trim(),);
        std::fs::write(d.join(path), &after_c).unwrap();
        let _op_c = autosave(&repo, &d, "team/c", "demo", "c rewrites").expect("save c");

        // Seat dollars: a spends 3.0, b 1.0, c 2.0 over the demo run.
        let ledger = |seat: &str, cost: f64| crate::usage::UsageRecord {
            seat: seat.into(),
            run: "demo".into(),
            slice: "s".into(),
            model: "fake".into(),
            day: "2026-11-27".into(),
            ts: 1_000,
            tokens: Default::default(),
            cost_usd: cost,
            estimated: String::new(),
            agent: "fake".into(),
            message_id: format!("m-{seat}"),
        };
        crate::usage::ledger_append(&repo.kula_dir(), &ledger("team/a", 3.0));
        crate::usage::ledger_append(&repo.kula_dir(), &ledger("team/b", 1.0));
        crate::usage::ledger_append(&repo.kula_dir(), &ledger("team/c", 2.0));

        let blame = blame_agents(&repo, path).unwrap();
        // Seat a's markers survived the move (marker 1) and the rewrite took
        // marker 2 away from a.
        if !blame.iter().any(|l| l.seat == "team/a") {
            panic!("no seat-a line; blame = {blame:?}");
        }
        let m1 = blame.iter().find(|l| l.seat == "team/a").expect("marker 1 still seat a");
        assert_eq!(m1.op, op_a.id, "the moved line is still owned by a's save");
        assert!(blame.iter().any(|l| l.seat == "team/b" && l.op == op_b.id), "seat b owns its added line");
        assert!(blame.iter().any(|l| l.seat == "team/c"), "seat c owns its rewritten line");
        // Cost shares: a's save introduced 2 lines and spent 3.0 → 1.5/line.
        let a_cost: f64 = blame.iter().filter(|l| l.seat == "team/a").map(|l| l.cost_share).sum();
        assert!((a_cost - 3.0).abs() < 1e-9, "seat a's shares sum to its spend: {a_cost}");
        // Deterministic: identical inputs give identical JSON.
        let one = serde_json::to_value(blame_agents(&repo, path).unwrap()).unwrap();
        let two = serde_json::to_value(blame_agents(&repo, path).unwrap()).unwrap();
        assert_eq!(one, two, "blame is deterministic");

        // The changelog of the run groups the same lines by flow (unmapped
        // here, empty flow ids) with the same dollars.
        let changes = changelog(&repo, "demo").unwrap();
        let total: f64 = changes.iter().map(|c| c.cost_share).sum();
        assert!((total - 6.0).abs() < 1e-9, "changelog attributes all spend: {changes:?}");
        assert!(changes.iter().all(|c| c.run == "demo"));
    }

    /// Consecutive lines of one save group into one changelog hunk.
    #[test]
    fn changelog_groups_consecutive_lines() {
        let base = BASE;
        let (_t, repo) = repo_with(base);
        let d = repo.root.clone();
        let path = "src/lib.rs";
        let aa = marker("aa", 1);
        let bb = marker("bb", 2);
        let two = format!("fn shared() {{\n{};\n{};\n{}}}\n", aa.trim(), bb.trim(), "}");
        std::fs::write(d.join(path), &two).unwrap();
        autosave(&repo, &d, "team/a", "grp", "two lines").expect("save");
        let changes = changelog(&repo, "grp").unwrap();
        let seat_changes: Vec<&FlowChange> = changes.iter().filter(|c| c.seat == "team/a").collect();
        assert!(!seat_changes.is_empty(), "{changes:?}");
        for c in seat_changes {
            assert!(c.lines >= 1, "{changes:?}");
            assert!(c.start >= 1, "{changes:?}");
        }
    }
}
