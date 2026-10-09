//! What agents need that grep can't give them: the right code for a task within
//! a token budget, and a check before and after they edit.
//!
//! - `context_pack`: seeds (symbols, files or a question) → the smallest set of
//!   definitions that explains them, ranked by graph distance and fitted to a
//!   budget; oversized bodies fall back to their signature.
//! - `pre_edit`: who depends on a symbol, which tests reach it, which files
//!   usually change with it, what humans noted, and the risk.
//! - `verify_edit`: the working tree against HEAD through the graph – what
//!   changed, what it ripples into, and callers left pointing at removed code.

use crate::git::Repo;
use crate::graph::{self, read_lines};
use crate::store::{Node, Store};
use anyhow::Result;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

// Contract: the structured `*_refs` ({name, path, line, detail}) are what the web UI
// reads. The row strings are for humans and agents reading JSON; their wording is free.

/// Rough token count for code: ~4 characters per token.
fn tokens(s: &str) -> usize {
    s.len().div_ceil(4)
}

pub fn is_test_path(p: &str) -> bool {
    let l = p.to_ascii_lowercase();
    l.starts_with("test/")
        || l.starts_with("tests/")
        || l.contains("/test/")
        || l.contains("/tests/")
        || l.contains("__tests__")
        || l.contains(".test.")
        || l.contains(".spec.")
        || l.contains("_test.")
        || l.rsplit('/').next().is_some_and(|f| f.starts_with("test_"))
        || l.starts_with("e2e/")
        || l.contains("/e2e/")
}

/// A structured row: the same thing the strings say, without parsing.
#[derive(Serialize, Clone)]
pub struct Ref {
    pub name: String,
    pub path: String,
    pub line: i64,
    /// verify: added | removed | modified; for dangling, the removed callee.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

fn r(n: &Node) -> Ref {
    Ref { name: n.name.clone(), path: n.path.clone(), line: n.start_line, detail: None }
}

// ------------------------------------------------------------------ context pack

#[derive(Serialize)]
pub struct PackItem {
    pub name: String,
    pub kind: String,
    pub path: String,
    pub lines: [i64; 2],
    /// Why it's in the pack: seed | uses | used by | container | 2nd-order | test.
    pub why: String,
    /// true when only the signature fitted the budget.
    pub signature_only: bool,
    pub code: String,
}

#[derive(Serialize)]
pub struct Pack {
    pub seeds: Vec<String>,
    pub budget: usize,
    pub used: usize,
    pub items: Vec<PackItem>,
    /// Relevant but left out for budget, most relevant first – ask for them by name.
    pub omitted: Vec<String>,
}

/// Resolve each target to nodes: an exact symbol/file reference first, otherwise
/// the best few search hits for it (so a plain-language question also works).
fn seeds(store: &Store, targets: &[String]) -> Result<Vec<Node>> {
    let mut out: Vec<Node> = Vec::new();
    for t in targets {
        let exact = store.resolve(t)?;
        let hits = if exact.is_empty() { store.search(t, 3)? } else { exact.into_iter().take(2).collect() };
        for n in hits.into_iter().filter(|n| n.kind != "package") {
            if !out.iter().any(|o| o.id == n.id) {
                out.push(n);
            }
        }
    }
    Ok(out)
}

pub fn context_pack(repo: &Repo, store: &Store, targets: &[String], budget: usize) -> Result<Pack> {
    let seeds = seeds(store, targets)?;
    // Candidates with a relevance score; highest wins when a node is reached twice.
    let mut cand: HashMap<i64, (f64, String, Node)> = HashMap::new();
    let mut put = |n: Node, score: f64, why: &str| {
        if n.kind == "package" {
            return;
        }
        let e = cand.entry(n.id).or_insert((0.0, String::new(), n));
        if score > e.0 {
            e.0 = score;
            e.1 = why.to_string();
        }
    };
    for s in &seeds {
        put(s.clone(), 1.0, "seed");
        // What it uses explains how it works; who uses it explains the contract.
        for (n, _) in store.neighbours(s.id, "CALLS", true)? {
            let id = n.id;
            put(n, 0.72, "uses");
            for (m, _) in store.neighbours(id, "CALLS", true)?.into_iter().take(6) {
                put(m, 0.34, "2nd-order");
            }
        }
        for (n, _) in store.neighbours(s.id, "CALLS", false)? {
            let why = if is_test_path(&n.path) { "test" } else { "used by" };
            put(n, if why == "test" { 0.5 } else { 0.6 }, why);
        }
        if let Some((c, _)) = store.neighbours(s.id, "CONTAINS", false)?.into_iter().find(|(c, _)| c.kind != "file") {
            put(c, 0.55, "container");
        }
        if s.kind == "file" {
            for (n, _) in store.neighbours(s.id, "IMPORTS", true)? {
                put(n, 0.4, "uses");
            }
        }
    }
    let mut ranked: Vec<(f64, String, Node)> = cand.into_values().collect();
    // Relevance first; among equals, smaller definitions first (more per token).
    ranked.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap().then((a.2.end_line - a.2.start_line).cmp(&(b.2.end_line - b.2.start_line))));

    let mut used = 0;
    let mut items = Vec::new();
    let mut omitted = Vec::new();
    for (_, why, n) in ranked {
        // Files are context, not code to paste whole: their head only.
        let (start, end) = if n.kind == "file" { (1, 40.min(n.end_line.max(1))) } else { (n.start_line, n.end_line) };
        let code = read_lines(repo, &n.path, start, end);
        let cost = tokens(&code) + 24;
        let (code, sig, end) = if used + cost <= budget {
            (code, false, end)
        } else {
            let sig: String = code.lines().take(3).collect::<Vec<_>>().join("\n");
            let c = tokens(&sig) + 24;
            if used + c > budget || why == "2nd-order" {
                omitted.push(format!("{} ({}:{})", n.name, n.path, n.start_line));
                continue;
            }
            (format!("{sig}\n  …"), true, (start + 2).min(end))
        };
        used += tokens(&code) + 24;
        items.push(PackItem { name: n.name, kind: n.kind, path: n.path, lines: [start, end], why, signature_only: sig, code });
    }
    Ok(Pack { seeds: seeds.iter().map(|s| format!("{}:{}", s.path, s.name)).collect(), budget, used, items, omitted })
}

// ------------------------------------------------------------------ pre-edit

#[derive(Serialize)]
pub struct PreEdit {
    pub symbol: Node,
    pub risk: String,
    pub dependents: usize,
    pub files: usize,
    pub direct_callers: Vec<String>,
    pub tests: Vec<String>,
    pub co_changes: Vec<(String, usize)>,
    pub notes: Vec<String>,
    pub advice: Vec<String>,
    /// Structured twins of direct_callers and tests.
    pub direct_caller_refs: Vec<Ref>,
    pub test_refs: Vec<Ref>,
    /// Whether agents may change it (kula.toml guards, the active task).
    pub guard: crate::guard::Verdict,
    /// Agent memories about it and its neighbours, freshest first.
    pub memories: Vec<crate::memory::Recalled>,
}

/// Files that historically change in the same commits as `path` (its last 150 commits).
pub fn co_changes(repo: &Repo, path: &str, limit: usize) -> Vec<(String, usize)> {
    // Two git calls: the commits that touched `path`, then every file in those commits.
    let Ok(shas) = repo.run(&["log", "-n", "150", "--format=%H", "--", path]) else { return vec![] };
    let shas: Vec<&str> = shas.lines().map(str::trim).filter(|s| !s.is_empty()).collect();
    if shas.is_empty() {
        return vec![];
    }
    let mut args = vec!["log", "--no-walk=unsorted", "--pretty=format:@@", "--name-only"];
    args.extend(shas.iter().copied());
    let Ok(log) = repo.run(&args) else { return vec![] };
    let mut n: HashMap<String, usize> = HashMap::new();
    for commit in log.split("@@") {
        let fs: Vec<&str> = commit.lines().map(str::trim).filter(|f| !f.is_empty()).collect();
        if fs.len() > 40 {
            continue; // sweeping commits (formatting, renames) say nothing about coupling
        }
        for f in fs.into_iter().filter(|f| *f != path) {
            *n.entry(f.to_string()).or_default() += 1;
        }
    }
    let mut v: Vec<(String, usize)> = n.into_iter().filter(|(_, c)| *c >= 2).collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    v.truncate(limit);
    v
}

pub fn pre_edit(repo: &Repo, store: &Store, symbol: &str) -> Result<PreEdit> {
    let n = graph::resolve_one(store, symbol)?;
    let up = graph::impact(store, n.id, true, 6)?;
    let direct: Vec<String> =
        up.hits.iter().filter(|h| h.depth == 1).map(|h| format!("{} ({}:{})", h.node.name, h.node.path, h.node.start_line)).collect();
    let mut tests: Vec<String> =
        up.hits.iter().filter(|h| is_test_path(&h.node.path)).map(|h| format!("{} ({})", h.node.name, h.node.path)).collect();
    tests.dedup();
    let co = co_changes(repo, &n.path, 6);
    let notes: Vec<String> = crate::meta::load(repo)
        .map(|m| {
            m.notes
                .into_iter()
                .filter(|x| x.target.ends_with(&format!(":{}", n.name)) || x.target == format!("file:{}", n.path))
                .map(|x| x.body)
                .collect()
        })
        .unwrap_or_default();
    let guards = crate::guard::Guards::load(repo)?;
    let guard = guards.node(&n);
    let memories = crate::memory::recall(repo, store, Some(&n.id.to_string()), None, 8).unwrap_or_default();
    let mut advice = Vec::new();
    if !guard.level.editable() {
        advice.push(format!("Do not edit: {} is {} for agents – {} ({}).", n.name, guard.level.as_str(), guard.reason, guard.rule));
    } else if guard.level == crate::guard::Level::Review {
        advice.push(format!("A person reviews changes here: {}.", guard.reason));
    }
    let locked_callees: Vec<String> =
        store.neighbours(n.id, "CALLS", true)?.into_iter().filter(|(c, _)| !guards.node(c).level.editable()).map(|(c, _)| c.name).collect();
    if !locked_callees.is_empty() {
        advice.push(format!("It calls guarded code ({}): keep those call sites as they are.", locked_callees.join(", ")));
    }
    if memories.iter().any(|m| m.stale) {
        advice.push(
            "Some memories about this code are stale: the code changed after they were written. Re-check before trusting them.".into(),
        );
    }
    if !direct.is_empty() {
        advice.push(format!("Keep the signature stable or update the {} direct caller(s) in the same change.", direct.len()));
    }
    if tests.is_empty() {
        advice.push("No test reaches this symbol through the call graph – add one, or verify by hand.".into());
    } else {
        advice.push(format!("Run the {} test(s) that reach it after editing.", tests.len()));
    }
    if let Some((f, c)) = co.first() {
        advice.push(format!("{f} changed alongside this file in {c} commits – check whether it needs the same change."));
    }
    if up.risk == "high" {
        advice.push("High blast radius: prefer an additive change (new function, then migrate callers).".into());
    }
    advice.push("After editing, call verify_edit to see what actually moved.".into());
    let direct_caller_refs: Vec<Ref> = up.hits.iter().filter(|h| h.depth == 1).map(|h| r(&h.node)).collect();
    let mut test_refs: Vec<Ref> = up.hits.iter().filter(|h| is_test_path(&h.node.path)).map(|h| r(&h.node)).collect();
    test_refs.dedup_by(|a, b| a.name == b.name && a.path == b.path);
    Ok(PreEdit {
        risk: up.risk.clone(),
        dependents: up.hits.len(),
        files: up.files,
        direct_callers: direct,
        tests,
        co_changes: co,
        notes,
        advice,
        direct_caller_refs,
        test_refs,
        guard,
        memories,
        symbol: n,
    })
}

// ------------------------------------------------------------------ verify

#[derive(Serialize)]
pub struct Verify {
    pub summary: graph::DiffSummary,
    pub changed: Vec<String>,
    /// Callers that still exist but lost their call to a removed or renamed symbol.
    pub dangling: Vec<String>,
    /// Existing callers of modified symbols, in other files: re-read them.
    pub recheck: Vec<String>,
    pub ok: bool,
    /// Structured twins of changed, dangling and recheck.
    pub changed_refs: Vec<Ref>,
    pub dangling_refs: Vec<Ref>,
    pub recheck_refs: Vec<Ref>,
    /// Changed files agents may not edit: path, verdict.
    pub guard_violations: Vec<(String, crate::guard::Verdict)>,
}

/// `agent`: whose fences to check against (a team gives each agent its own).
pub fn verify_edit(repo: &Repo, agent: Option<&str>) -> Result<Verify> {
    let base = crate::index::snapshot_any(repo, "HEAD")?;
    let head = crate::index::worktree(repo);
    let d = graph::graph_diff(&base, &head, "HEAD", "WORKTREE", Some(false));
    let by: HashMap<i64, &graph::DiffNode> = d.nodes.iter().map(|n| (n.id, n)).collect();
    let label = |n: &graph::DiffNode| format!("{} {} ({}:{})", n.status, n.name, n.path, n.start_line);
    let dref =
        |n: &graph::DiffNode, detail: String| Ref { name: n.name.clone(), path: n.path.clone(), line: n.start_line, detail: Some(detail) };
    let moved: Vec<&graph::DiffNode> = d.nodes.iter().filter(|n| n.status != "same" && n.kind != "file" && n.kind != "package").collect();
    let changed: Vec<String> = moved.iter().map(|n| label(n)).collect();
    let changed_refs: Vec<Ref> = moved.iter().map(|n| dref(n, n.status.to_string())).collect();
    let mut dangling = Vec::new();
    let mut dangling_refs = Vec::new();
    let mut recheck: HashSet<String> = HashSet::new();
    let mut recheck_refs: Vec<Ref> = Vec::new();
    for e in &d.edges {
        let (Some(a), Some(b)) = (by.get(&e.src), by.get(&e.dst)) else { continue };
        if e.kind != "CALLS" {
            continue;
        }
        if e.status == "removed" && b.status == "removed" && a.status != "removed" {
            dangling.push(format!("{} ({}:{}) called {} which is gone", a.name, a.path, a.start_line, b.name));
            dangling_refs.push(dref(a, b.name.clone()));
        }
        if b.status == "modified"
            && a.status == "same"
            && a.path != b.path
            && recheck.insert(format!("{} ({}:{}) calls modified {}", a.name, a.path, a.start_line, b.name))
        {
            recheck_refs.push(dref(a, b.name.clone()));
        }
    }
    let mut recheck: Vec<String> = recheck.into_iter().collect();
    recheck.sort();
    recheck_refs.sort_by(|x, y| (&x.name, &x.path, x.line).cmp(&(&y.name, &y.path, y.line)));
    let mut paths: Vec<String> = repo.status().map(|fs| fs.into_iter().map(|f| f.path).collect()).unwrap_or_default();
    paths.sort();
    paths.dedup();
    let store = Store::open(repo).ok();
    // kula's own config changes are a person's (agents can't write it: the hooks refuse, `kula run` puts it back).
    // Symbol fences are exact here: the worktree diff's hunks map to the
    // symbols whose spans they touch.
    let syms = store
        .as_ref()
        .map(|st| crate::guard::diff_symbols(repo, st, &["diff", "-U0", "--no-color", "--no-renames", "HEAD"]))
        .unwrap_or_default();
    let touched: Vec<(String, Vec<String>)> =
        paths.iter().map(|p| (p.clone(), syms.iter().find(|(fp, _)| fp == p).map(|(_, s)| s.clone()).unwrap_or_default())).collect();
    let guard_violations: Vec<_> = crate::guard::violations_with(repo, store.as_ref(), &touched, agent)
        .unwrap_or_default()
        .into_iter()
        .filter(|(_, v)| v.rule != "kula")
        .collect();
    Ok(Verify {
        ok: dangling.is_empty() && guard_violations.is_empty(),
        summary: d.summary,
        changed,
        dangling,
        recheck,
        changed_refs,
        dangling_refs,
        recheck_refs,
        guard_violations,
    })
}
