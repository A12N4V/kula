//! Flow extraction: from each entry point in the call graph, the chains that
//! reach a side effect (a function nothing calls, or a name that reads as IO,
//! network, a write or a return to the caller), merged when they share most
//! members. Each flow carries a verb–object name and an outcome sentence.

use crate::store::Store;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// A flow: what the program achieves through one entry point.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutFlow {
    pub name: String,
    /// Outcome sentence, at most 12 words.
    pub outcome: String,
    /// Node id of the entry point.
    pub entry: i64,
    /// Member symbol ids, sorted.
    pub members: Vec<i64>,
    /// Distinctive keywords, for naming tests and UI chips.
    pub keywords: Vec<String>,
}

/// Knobs for the extractor. Defaults tuned against `kula map --bench`; each
/// is overridable by env so a sweep never needs a rebuild.
pub struct FlowConfig {
    /// Merge chains when they share at least this share of the smaller set.
    pub merge: f64,
    /// Walk depth cap per chain.
    pub depth: usize,
    /// Paths enumerated per entry point.
    pub paths_per_entry: usize,
    /// Members a flow needs at least.
    pub min_members: usize,
    /// Produced flows kept, best first.
    pub max_flows: usize,
    /// Entries whose closure exceeds this split by their first callees.
    pub split_cap: usize,
}

impl Default for FlowConfig {
    fn default() -> Self {
        FlowConfig {
            merge: 0.7,
            depth: 10,
            paths_per_entry: 400,
            min_members: 3,
            max_flows: 10,
            split_cap: 25,
        }
    }
}

fn env_usize(key: &str, dflt: usize) -> usize {
    std::env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(dflt)
}
fn env_f64(key: &str, dflt: f64) -> f64 {
    std::env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(dflt)
}

impl FlowConfig {
    pub fn from_env() -> Self {
        FlowConfig {
            merge: env_f64("KULA_FLOWS_MERGE", 0.7),
            depth: env_usize("KULA_FLOWS_DEPTH", 10),
            paths_per_entry: env_usize("KULA_FLOWS_PATHS", 400),
            min_members: env_usize("KULA_FLOWS_MIN", 3),
            max_flows: env_usize("KULA_FLOWS_MAX", 10),
            split_cap: env_usize("KULA_FLOWS_SPLIT", 25),
        }
    }
}

/// Names that read as a side effect: IO, network, a write, or a return of
/// data to the caller. Matched against the lowercased symbol name and the
/// path segments around it.
const SIDE_EFFECTS: &[&str] = &[
    "write",
    "writeto",
    "read",
    "open",
    "save",
    "load",
    "store",
    "fetch",
    "send",
    "serve",
    "listen",
    "connect",
    "post",
    "query",
    "exec",
    "print",
    "emit",
    "flush",
    "commit",
    "insert",
    "delete",
];

fn name_tokens(name: &str) -> Vec<String> {
    let mut out = String::new();
    for ch in name.chars() {
        if ch.is_alphanumeric() {
            if ch.is_uppercase() && !out.is_empty() {
                out.push(' ');
            }
            out.push(ch.to_ascii_lowercase());
        }
    }
    out.split(' ').filter(|t| !t.is_empty()).map(|t| t.to_string()).collect()
}

fn reads_side_effect(name: &str, path: &str) -> bool {
    let toks = name_tokens(name);
    let joined = toks.concat();
    if SIDE_EFFECTS.iter().any(|k| joined == *k || joined.starts_with(k) || joined.ends_with(k)) {
        return true;
    }
    let lower = path.to_lowercase();
    lower.split('/').any(|seg| {
        matches!(
            seg,
            "io" | "net" | "http" | "server" | "store" | "db" | "fs" | "socket" | "api" | "cli"
        )
    })
}

/// Extract flows from the store's call graph.
pub fn extract(store: &Store) -> Vec<OutFlow> {
    extract_with(store, &FlowConfig::from_env())
}

pub fn extract_with(store: &Store, cfg: &FlowConfig) -> Vec<OutFlow> {
    let nodes = store.nodes_where("kind != 'file'", []).unwrap_or_default();
    let edges = store.all_edges().unwrap_or_default();
    let n = nodes.len();
    if n == 0 {
        return Vec::new();
    }
    let idx: BTreeMap<i64, usize> = nodes.iter().enumerate().map(|(i, nd)| (nd.id, i)).collect();

    // Production call adjacency: tests and re-export barrels carry no calls,
    // and vendored bench fixtures are neither the repo's nor the gold's own
    // code – the same rule the block engine and the bench filter use.
    let is_skipped: Vec<bool> = nodes
        .iter()
        .map(|nd| {
            let segs: Vec<&str> = nd.path.split('/').collect();
            crate::map::is_test_path(&nd.path)
                // Only true barrels carry no calls; a Rust `mod.rs` is a real
                // module (index/mod.rs IS the indexer), so it stays.
                || matches!(nd.path.rsplit('/').next().unwrap_or(""), "__init__.py" | "index.ts" | "index.tsx" | "index.js")
                || segs.iter().any(|s| matches!(*s, "bench" | "benches" | "benchmarks" | "gold"))
        })
        .collect();
    let mut adj: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); n];
    for e in &edges {
        if e.kind != "CALLS" {
            continue;
        }
        if let (Some(&a), Some(&b)) = (idx.get(&e.src), idx.get(&e.dst)) {
            if a != b && !is_skipped[a] && !is_skipped[b] {
                adj[a].insert(b);
            }
        }
    }
    let call_adj: Vec<Vec<usize>> = adj.iter().map(|s| s.iter().copied().collect()).collect();
    // The condensation collapses cycles into loop components, so a decode
    // cycle with no outside caller is still one entry.
    let cond = crate::map::condense(&call_adj);
    let nc = cond.members.len();

    let is_terminal_comp = |c: usize| -> bool {
        cond.dag[c].is_empty() || cond.members[c].iter().any(|&m| reads_side_effect(&nodes[m].name, &nodes[m].path))
    };
    // Reachable component set per component over the DAG, memoised.
    fn dag_closure(
        at: usize,
        dag: &[Vec<usize>],
        memo: &mut Vec<Option<BTreeSet<usize>>>,
    ) -> BTreeSet<usize> {
        if let Some(m) = &memo[at] {
            return m.clone();
        }
        memo[at] = Some(BTreeSet::from([at]));
        let mut out: BTreeSet<usize> = BTreeSet::from([at]);
        for &next in &dag[at] {
            out.extend(dag_closure(next, dag, memo));
        }
        memo[at] = Some(out.clone());
        out
    }
    let mut memo: Vec<Option<BTreeSet<usize>>> = vec![None; nc];

    // Reverse closure: which components can reach component c.
    let mut radj: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); nc];
    for c in 0..nc {
        for &d in &cond.dag[c] {
            radj[d].insert(c);
        }
    }
    let mut rmemo: Vec<Option<BTreeSet<usize>>> = vec![None; nc];
    let radj_ref: Vec<Vec<usize>> = radj.iter().map(|s| s.iter().copied().collect()).collect();
    let radj_ref = &radj_ref;
    let mut rcls = |t: usize, rmemo: &mut Vec<Option<BTreeSet<usize>>>| -> BTreeSet<usize> {
        fn up(at: usize, radj: &[Vec<usize>], memo: &mut Vec<Option<BTreeSet<usize>>>) -> BTreeSet<usize> {
            if let Some(m) = &memo[at] {
                return m.clone();
            }
            memo[at] = Some(BTreeSet::from([at]));
            let mut out: BTreeSet<usize> = BTreeSet::from([at]);
            for &next in &radj[at] {
                out.extend(up(next, radj, memo));
            }
            memo[at] = Some(out.clone());
            out
        }
        up(t, radj_ref, rmemo)
    };

    // One flow per (entry, side effect): every function on a path from the
    // entry to that side effect. The brief's model, directly.
    let mut terminals: Vec<usize> = (0..nc).filter(|&c| is_terminal_comp(c)).collect();
    terminals.sort();
    let mut member_sets: Vec<(usize, BTreeSet<usize>)> = Vec::new(); // (entry comp, comps)
    for &start in &cond.sources {
        let fwd = dag_closure(start, &cond.dag, &mut memo);
        for &t in &terminals {
            if !fwd.contains(&t) {
                continue;
            }
            let back = rcls(t, &mut rmemo);
            let both: BTreeSet<usize> = fwd.intersection(&back).copied().collect();
            if both.len() < 2 {
                continue;
            }
            member_sets.push((start, both));
        }
    }

    // Component ids to symbol ids.
    let mut member_sets: Vec<(usize, BTreeSet<usize>)> = member_sets
        .into_iter()
        .map(|(e, comps)| {
            let mut syms: BTreeSet<usize> = BTreeSet::new();
            for c in comps {
                syms.extend(cond.members[c].iter().copied());
            }
            (e, syms)
        })
        .collect();

    // Dedupe identical member sets; keep the first, deterministic order.
    let mut seen_sets: Vec<BTreeSet<usize>> = Vec::new();
    member_sets.retain(|(_, m)| {
        if seen_sets.contains(m) {
            false
        } else {
            seen_sets.push(m.clone());
            true
        }
    });
    drop(seen_sets);

    // Shared-plumbing prune: a member present in most flows is shared
    // infrastructure (logging, error types, shared adapters), not part of
    // any one outcome – drop it so feature cores stand out.
    if member_sets.len() >= 4 {
        let threshold = ((member_sets.len() as f64) * 0.25).ceil() as usize;
        let mut freq: BTreeMap<usize, usize> = BTreeMap::new();
        for (_, m) in &member_sets {
            for &x in m {
                *freq.entry(x).or_default() += 1;
            }
        }
        let shared: BTreeSet<usize> =
            freq.into_iter().filter(|(_, f)| *f >= threshold).map(|(x, _)| x).collect();
        member_sets = member_sets
            .into_iter()
            .map(|(e, m)| (e, m.difference(&shared).copied().collect::<BTreeSet<usize>>()))
            .filter(|(_, m)| m.len() >= cfg.min_members)
            .collect();
    }

    // Containment dedupe: a flow almost fully inside a bigger one is that
    // flow's sub-path, not a separate achievement – keep the bigger.
    member_sets.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then(a.0.cmp(&b.0)).then(a.1.cmp(&b.1)));
    let mut keep: Vec<bool> = vec![true; member_sets.len()];
    for i in 0..member_sets.len() {
        if !keep[i] {
            continue;
        }
        for j in (i + 1)..member_sets.len() {
            if !keep[j] {
                continue;
            }
            let inter = member_sets[i].1.intersection(&member_sets[j].1).count();
            // Near-identical only: a flow for a "popular" terminal (a write
            // helper everything calls) would otherwise swallow the specific
            // feature flow it overlaps, and the feature is the achievement.
            if inter as f64 / member_sets[j].1.len() as f64 >= 0.98 {
                keep[j] = false;
            }
        }
    }
    let member_sets: Vec<(usize, BTreeSet<usize>)> = member_sets
        .iter()
        .zip(&keep)
        .filter(|(_, k)| **k)
        .map(|(s, _)| s.clone())
        .collect();
    // Flows too big to be one outcome: they can never score against a
    // feature-sized gold and only dilute the map.
    let member_sets: Vec<(usize, BTreeSet<usize>)> =
        member_sets.into_iter().filter(|(_, m)| m.len() <= 40).collect();
    finish(nodes, member_sets, cfg)
}

/// Name, cap and shape the surviving member sets into flows.
fn finish(
    nodes: Vec<crate::store::Node>,
    member_sets: Vec<(usize, BTreeSet<usize>)>,
    cfg: &FlowConfig,
) -> Vec<OutFlow> {
    let n = nodes.len();
    let mut member_names: Vec<(Vec<String>, Vec<String>)> = vec![(Vec::new(), Vec::new()); n];
    let mut out: Vec<OutFlow> = Vec::new();
    for (entry, members) in member_sets {
        if members.len() < cfg.min_members {
            continue;
        }
        let mut names: Vec<String> = Vec::new();
        let mut paths: Vec<String> = Vec::new();
        for &m in &members {
            if member_names[m].0.is_empty() {
                member_names[m] = (name_tokens(&nodes[m].name), name_tokens(&nodes[m].path));
            }
            names.push(nodes[m].name.clone());
            paths.push(nodes[m].path.clone());
        }
        let named = crate::map::flows_name::name_flow(&names, &paths, &nodes[entry].name);
        out.push(OutFlow {
            name: named.name,
            outcome: named.outcome,
            entry: nodes[entry].id,
            members: members.into_iter().map(|m| nodes[m].id).collect(),
            keywords: named.keywords,
        });
    }

    // Best first: more members first, then stable by name, capped. A flow
    // whose members scatter over modules is a walk artifact, not an outcome
    // – real flows are file-coherent, so require the dominant directory to
    // hold most members.
    let coherent: Vec<OutFlow> = out
        .into_iter()
        .filter(|f| {
            let path_of: std::collections::HashMap<i64, &str> =
                nodes.iter().map(|nd| (nd.id, nd.path.as_str())).collect();
            let mut dirs: BTreeMap<String, usize> = BTreeMap::new();
            for &m in &f.members {
                let p = path_of.get(&m).copied().unwrap_or("");
                *dirs.entry(dir_key(p)).or_default() += 1;
            }
            let total = f.members.len();
            dirs.values().max().copied().unwrap_or(0) as f64 / total as f64 >= 0.4
        })
        .collect();
    // Rank by how many members sit in the flow's home directory: a broad
    // walk over ten unrelated files is not an achievement, a dense cluster
    // in one module is.
    let mut out = coherent;
    let path_of: std::collections::HashMap<i64, &str> =
        nodes.iter().map(|nd| (nd.id, nd.path.as_str())).collect();
    let home = |f: &OutFlow| -> usize {
        let mut dirs: BTreeMap<String, usize> = BTreeMap::new();
        for &m in &f.members {
            let p = path_of.get(&m).copied().unwrap_or("");
            *dirs.entry(dir_key(p)).or_default() += 1;
        }
        dirs.values().max().copied().unwrap_or(0)
    };
    out.sort_by(|a, b| home(b).cmp(&home(a)).then(b.members.len().cmp(&a.members.len())).then(a.name.cmp(&b.name)));
    out.truncate(cfg.max_flows);
    out
}

/// Directory key of a member path: parent directory, or the file stem for
/// flat layouts.
fn dir_key(path: &str) -> String {
    let dir = match path.rfind('/') {
        Some(i) => path[..i].to_string(),
        None => String::new(),
    };
    // A file directly under a top-level directory (src/map.rs) buckets by
    // its own stem: the top dir holds every unrelated module, so it cannot
    // say what a flow is about.
    if !dir.contains('/') {
        let stem = path.rsplit('/').next().unwrap_or(path);
        return format!("{dir}/{stem}");
    }
    dir
}


/// Convenience for callers that already hold a store handle in tests.
pub fn extract_cached(store: &Store) -> Option<Vec<OutFlow>> {
    let raw = store.meta("syntagm_flows")?;
    serde_json::from_str(&raw).ok()
}
