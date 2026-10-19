//! Flow extraction: from each entry point in the call graph, the chains that
//! reach a side effect (a dead end, or a name that reads as IO, network, a
//! write or a return of data to the caller), merged when they share most
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
    /// Longest call chain merged into this flow, in components. Not part of
    /// the stored map – a ranking signal, not a UI fact.
    #[serde(skip)]
    pub depth_rank: usize,
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
}

impl Default for FlowConfig {
    fn default() -> Self {
        FlowConfig {
            merge: 0.5,
            depth: 30,
            paths_per_entry: 2000,
            min_members: 3,
            max_flows: 10,
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
            merge: env_f64("KULA_FLOWS_MERGE", 0.5),
            depth: env_usize("KULA_FLOWS_DEPTH", 30),
            paths_per_entry: env_usize("KULA_FLOWS_PATHS", 2000),
            min_members: env_usize("KULA_FLOWS_MIN", 3),
            max_flows: env_usize("KULA_FLOWS_MAX", 10),
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

/// The side-effect keyword a symbol's name carries, if any – used for
/// terminal detection and for the flow's outcome sentence.
pub fn side_effect_token(name: &str) -> Option<&'static str> {
    let toks = name_tokens(name);
    let joined = toks.concat();
    SIDE_EFFECTS.iter().find(|k| joined == **k || joined.starts_with(**k) || joined.ends_with(**k)).copied()
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

    // Chains: per entry component, enumerate capped component paths from the
    // entry to a terminal over the condensation DAG. The chain, not the whole
    // reachability closure, is the unit – a dispatch entry (kula's main::run)
    // fans into one chain per command, which per-(entry, terminal) closures
    // can never separate.
    let debug = std::env::var("KULA_FLOWS_DEBUG").is_ok();
    let mut chains: Vec<(usize, BTreeSet<usize>, usize)> = Vec::new(); // (entry comp, comps, len)
    // Entries: DAG sources, plus near-sources – components that almost
    // nothing reaches (a module's public decode/compute API called only by a
    // demo script or a generic dispatcher). Their own chains are the flow;
    // walking from the distant caller would drown them in unrelated members.
    let mut radj: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); nc];
    for c in 0..nc {
        for &d in &cond.dag[c] {
            radj[d].insert(c);
        }
    }
    fn up_closure(at: usize, radj: &[Vec<usize>], memo: &mut Vec<Option<BTreeSet<usize>>>) -> BTreeSet<usize> {
        if let Some(m) = &memo[at] {
            return m.clone();
        }
        memo[at] = Some(BTreeSet::new());
        let mut out = BTreeSet::from([at]);
        for &next in &radj[at] {
            out.extend(up_closure(next, radj, memo));
        }
        memo[at] = Some(out.clone());
        out
    }
    let radj_ref: Vec<Vec<usize>> = radj.iter().map(|s| s.iter().copied().collect()).collect();
    let mut rmemo: Vec<Option<BTreeSet<usize>>> = vec![None; nc];
    let mut entries: Vec<usize> = cond.sources.clone();
    for c in 0..nc {
        if !cond.sources.contains(&c) && up_closure(c, &radj_ref, &mut rmemo).len() <= 6 {
            entries.push(c);
        }
    }
    entries.sort();
    entries.dedup();
    for &start in &entries {
        let mut found: Vec<Vec<usize>> = Vec::new();
        // DFS with a shared in-progress marker; paths are capped per entry so
        // hubs cannot explode the build. Neighbours visited in sorted order
        // for determinism.
        fn walk(
            at: usize,
            path: &mut Vec<usize>,
            onpath: &mut Vec<bool>,
            dag: &[Vec<usize>],
            is_term: &dyn Fn(usize) -> bool,
            depth: usize,
            budget: &mut usize,
            found: &mut Vec<Vec<usize>>,
        ) {
            if found.len() >= *budget || found.len() >= 4000 || path.len() > depth {
                return;
            }
            let nexts: Vec<usize> = dag[at]
                .iter()
                .copied()
                .filter(|&d| !onpath[d])
                .collect();
            if nexts.is_empty() || is_term(at) {
                if path.len() >= 2 {
                    found.push(path.clone());
                }
                if is_term(at) && !nexts.is_empty() {
                    // A side-effect component can still call on – keep walking.
                } else {
                    return;
                }
            }
            for &d in &nexts {
                if found.len() >= 4000 {
                    return;
                }
                onpath[d] = true;
                path.push(d);
                walk(d, path, onpath, dag, is_term, depth, budget, found);
                path.pop();
                onpath[d] = false;
            }
        }
        let mut budget = cfg.paths_per_entry;
        let mut path = vec![start];
        let mut onpath = vec![false; nc];
        onpath[start] = true;
        walk(start, &mut path, &mut onpath, &cond.dag, &is_terminal_comp, cfg.depth, &mut budget, &mut found);
        for p in found {
            let set: BTreeSet<usize> = p.into_iter().collect();
            let len = set.len();
            chains.push((start, set, len));
        }
        if debug {
            let size = chains.iter().filter(|(e, _, _)| *e == start).map(|(_, s, _)| s.len()).max().unwrap_or(0);
            eprintln!(
                "ENTRY {} chains={} max={} members={}",
                nodes[cond.members[start][0]].name,
                chains.iter().filter(|(e, _, _)| *e == start).count(),
                size,
                cond.members[start].len()
            );
        }
    }

    // One bucket per (entry, terminal): every component on any enumerated
    // path from that entry to that terminal. This is what turns per-terminal
    // chains into one outcome-sized flow (all POD5 decoders, all map-build
    // steps) while keeping kula's dispatch entries as separate per-command
    // flows – different commands share only the dispatch spine, far below
    // the merge share.
    let mut buckets: BTreeMap<(usize, usize), (BTreeSet<usize>, usize)> = BTreeMap::new();
    for (entry, set, len) in &chains {
        let term = match set.iter().next_back() {
            Some(&t) => t,
            None => continue,
        };
        let b = buckets.entry((*entry, term)).or_default();
        b.0.extend(set.iter().copied());
        b.1 = b.1.max(*len);
    }
    // Buckets that swallowed a whole program walk (every command's members)
    // cannot be one outcome – drop them before merging.
    let mut buckets: Vec<(usize, BTreeSet<usize>, usize)> = buckets
        .into_iter()
        .filter(|(_, (m, _))| m.len() >= cfg.min_members && m.len() <= 45)
        .map(|((e, _), (m, l))| (e, m, l))
        .collect();

    // Merge buckets that share most of the smaller bucket's members: greedy,
    // bigger first, same entry only.
    buckets.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then(a.0.cmp(&b.0)).then(a.1.cmp(&b.1)));
    let mut flows: Vec<(usize, BTreeSet<usize>, usize)> = Vec::new(); // (entry comp, member comps, chain len)
    for (entry, set, len) in buckets {
        let mut placed = false;
        for f in flows.iter_mut() {
            if f.0 != entry {
                continue;
            }
            let inter = f.1.intersection(&set).count();
            if inter as f64 / set.len().max(1) as f64 >= cfg.merge {
                f.1.extend(set.iter().copied());
                f.2 = f.2.max(len);
                placed = true;
                break;
            }
        }
        if !placed {
            flows.push((entry, set, len));
        }
    }

    // Near-identical flows: one is a sub-walk of the other.
    flows.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then(a.0.cmp(&b.0)).then(a.1.cmp(&b.1)));
    let mut keep: Vec<bool> = vec![true; flows.len()];
    for i in 0..flows.len() {
        if !keep[i] {
            continue;
        }
        for j in (i + 1)..flows.len() {
            if !keep[j] {
                continue;
            }
            let inter = flows[i].1.intersection(&flows[j].1).count();
            if inter as f64 / flows[j].1.len() as f64 >= 0.85 {
                keep[j] = false;
            }
        }
    }
    let flows: Vec<(usize, BTreeSet<usize>, usize)> =
        flows.into_iter().zip(&keep).filter(|(_, k)| **k).map(|(s, _)| s).collect();

    // Size sanity: one outcome is a handful of functions, not a whole
    // program walk.
    let flows: Vec<(usize, BTreeSet<usize>, usize)> = flows
        .into_iter()
        .filter(|(_, m, _)| m.len() >= cfg.min_members && m.len() <= 45)
        .collect();

    // Component ids to symbol ids.
    let debug = std::env::var("KULA_FLOWS_DEBUG").is_ok();
    let _flow_depths: Vec<usize> = if debug { flows.iter().map(|(_, _, l)| *l).collect() } else { Vec::new() };
    let member_sets: Vec<(usize, BTreeSet<usize>, usize)> = flows
        .into_iter()
        .map(|(e, comps, len)| {
            let mut syms: BTreeSet<usize> = BTreeSet::new();
            for c in comps {
                syms.extend(cond.members[c].iter().copied());
            }
            (e, syms, len)
        })
        .collect();

    // Shared-plumbing prune: a member present in most flows is shared
    // infrastructure (the CLI dispatch, logging), not part of any one
    // outcome – drop it so feature cores stand out.
    let member_sets = prune_shared(member_sets, cfg);

    if debug {
        let brief: Vec<String> = member_sets
            .iter()
            .take(60)
            .map(|(e, m, l)| format!("{}[{}@{}]", nodes[cond.members[*e][0]].name, m.len(), l))
            .collect();
        eprintln!("STAGES chains={} flows={:?}", chains.len(), brief);
    }

    finish(nodes, member_sets, cfg)
}

/// Drop members that sit in at least a quarter of the flows when there are
/// enough flows for that to mean something; keep everything otherwise.
pub fn prune_shared(
    member_sets: Vec<(usize, BTreeSet<usize>, usize)>,
    cfg: &FlowConfig,
) -> Vec<(usize, BTreeSet<usize>, usize)> {
    if member_sets.len() < 4 {
        return member_sets;
    }
    let threshold = ((member_sets.len() as f64) * 0.5).ceil() as usize;
    let mut freq: BTreeMap<usize, usize> = BTreeMap::new();
    for (_, m, _) in &member_sets {
        for &x in m {
            *freq.entry(x).or_default() += 1;
        }
    }
    let shared: BTreeSet<usize> =
        freq.into_iter().filter(|(_, f)| *f >= threshold).map(|(x, _)| x).collect();
    member_sets
        .into_iter()
        .map(|(e, m, l)| (e, m.difference(&shared).copied().collect::<BTreeSet<usize>>(), l))
        .filter(|(_, m, _)| m.len() >= cfg.min_members)
        .collect()
}

/// Name, cap and shape the surviving member sets into flows.
fn finish(
    nodes: Vec<crate::store::Node>,
    member_sets: Vec<(usize, BTreeSet<usize>, usize)>,
    cfg: &FlowConfig,
) -> Vec<OutFlow> {
    let n = nodes.len();
    let mut member_names: Vec<(Vec<String>, Vec<String>)> = vec![(Vec::new(), Vec::new()); n];
    let mut out: Vec<OutFlow> = Vec::new();
    for (entry, members, depth) in member_sets {
        if members.len() < cfg.min_members || depth < 3 {
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
        // The outcome sentence names what the chain delivers: the strongest
        // side-effect terminal among the members, not a fixed template.
        let effect = members.iter().find_map(|&m| side_effect_token(&nodes[m].name));
        let named =
            crate::map::flows_name::name_flow(&names, &paths, &nodes[entry].name, effect);
        out.push(OutFlow {
            name: named.name,
            outcome: named.outcome,
            entry: nodes[entry].id,
            members: members.into_iter().map(|m| nodes[m].id).collect(),
            keywords: named.keywords,
            depth_rank: depth,
        });
    }

    // Rank: file-coherent flows first (a real outcome lives in a module or a
    // small family of them, a walk artifact scatters), then more members.
    // The coherence bar stays low because kula's serve flow honestly spans
    // server + api + map + store.
    let path_of: std::collections::HashMap<i64, &str> =
        nodes.iter().map(|nd| (nd.id, nd.path.as_str())).collect();
    let dom = |f: &OutFlow| -> f64 {
        let mut dirs: BTreeMap<String, usize> = BTreeMap::new();
        for &m in &f.members {
            let p = path_of.get(&m).copied().unwrap_or("");
            *dirs.entry(dir_key(p)).or_default() += 1;
        }
        let total = f.members.len();
        dirs.values().max().copied().unwrap_or(0) as f64 / total.max(1) as f64
    };
    let home = |f: &OutFlow| -> usize {
        let mut dirs: BTreeMap<String, usize> = BTreeMap::new();
        for &m in &f.members {
            let p = path_of.get(&m).copied().unwrap_or("");
            *dirs.entry(dir_key(p)).or_default() += 1;
        }
        dirs.values().max().copied().unwrap_or(0)
    };
    let coherent: Vec<OutFlow> = out.into_iter().filter(|f| dom(f) >= 0.25).collect();
    let mut out = coherent;
    out.sort_by(|a, b| {
        home(b).cmp(&home(a))
            .then(b.depth_rank.cmp(&a.depth_rank))
            .then(b.members.len().cmp(&a.members.len()))
            .then(a.name.cmp(&b.name))
    });
    // Disambiguate identical names: the bench produced "Parse the
    // Radiological Acquisition" three times for one repo – each occurrence
    // gains its home directory stem.
    let mut seen: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    for f in out.iter_mut() {
        let n = seen.entry(f.name.clone()).or_default();
        if *n > 0 {
            let dir = path_of
                .get(&f.members[0])
                .and_then(|p| p.rsplit('/').next())
                .unwrap_or("module")
                .rsplit_once('.')
                .map(|(stem, _)| stem)
                .unwrap_or("module");
            let stem = dir.split('_').next_back().unwrap_or(dir).to_string();
            f.name = format!("{} ({})", f.name, title_of(&stem));
        }
        *n += 1;
    }
    out.truncate(cfg.max_flows);
    // Stable order for the stored map: by name, not by score.
    out.sort_by(|a, b| a.name.cmp(&b.name).then(a.entry.cmp(&b.entry)));
    out
}

fn title_of(stem: &str) -> String {
    stem.split(['_', '-'])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
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