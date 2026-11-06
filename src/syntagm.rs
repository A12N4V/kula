//! Syntagm – blocks and chains built from the graph alone.
//!
//! Blocks: a hierarchical partition of the symbol graph (weighted Leiden-style
//! label propagation over CALLS / IMPORTS / INHERITS edges with a directory
//! prior), applied recursively per level. Hubs are down-weighted by degree and
//! test code is kept in its own section, so fixture re-export files and
//! `__init__` barrels cannot glue a whole repository into one giant cluster.
//! Chains: maximal call paths from entry points, each listing the blocks it
//! crosses. Everything is deterministic: fixed iteration order, ties broken by
//! symbol id. Incremental: the rebuild key is a hash over every indexed file's
//! symbols and edges – unchanged files are not recomputed.

use crate::git::Repo;
use crate::store::Store;
use anyhow::Result;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};

/// Maximum leaves a leaf-bearing block may hold. Containers hold none directly.
pub const MAX_LEAVES: usize = 40;
/// Maximum children per node; larger child sets are merged.
pub const MAX_CHILDREN: usize = 12;
/// Maximum chain depth. Cycles are cut on the path, not globally.
pub const MAX_CHAIN_DEPTH: usize = 12;
/// Entry points considered per rebuild, ranked by fan-out.
pub const MAX_ENTRIES: usize = 256;
/// Depth-0 sections aim for 5–15; the cap stays generous so domain boundaries
/// are never broken to satisfy the count.
pub const MAX_SECTIONS: usize = 30;
/// Sections smaller than this may be merged into a neighbour of the same kind.
const MIN_SECTION: usize = 8;
/// Branching cap when walking the call graph, so chains stay finite.
const MAX_BRANCH: usize = 6;
/// Paths kept per entry point.
const MAX_PATHS_PER_ENTRY: usize = 24;

// ----------------------------------------------------------------– model

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Block {
    pub id: String,
    pub parent: Option<String>,
    pub depth: usize,
    pub name: String,
    pub summary: String,
    pub kind: String, // section | block | sub
    pub symbols: Vec<i64>,
    pub children: Vec<String>,
    pub files: usize,
    pub cohesion: f64,
    pub source: String, // graph | embed
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Chain {
    pub id: String,
    pub entry: i64,
    pub steps: Vec<i64>,
    pub blocks: Vec<String>,
    pub len: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyntagmStats {
    pub ms: u128,
    pub batches: usize,
    pub threads: usize,
    pub embed: String, // off | on | stale
}

#[derive(Debug, Clone, Serialize)]
pub struct Syntagm {
    pub blocks: Vec<Block>,
    pub chains: Vec<Chain>,
    pub stats: SyntagmStats,
}

/// Optional semantic similarity between two symbols, 0..1. The embedding
/// module plugs an implementation in; with none, the graph alone decides.
pub trait Similarity: Send + Sync {
    fn similarity(&self, a: i64, b: i64) -> f64;
}

// ----------------------------------------------------------------– tables

const SYNTAGM_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS syntagm_blocks (
  id TEXT PRIMARY KEY, parent TEXT, depth INTEGER, kind TEXT, name TEXT, summary TEXT,
  symbols TEXT, children TEXT, files INTEGER, cohesion REAL, source TEXT, idx INTEGER
);
CREATE TABLE IF NOT EXISTS syntagm_chains (
  id TEXT PRIMARY KEY, entry INTEGER, steps TEXT, blocks TEXT, len INTEGER, idx INTEGER
);
"#;

// ----------------------------------------------------------------– builder

pub struct Builder<'a> {
    pub similarity: Option<&'a dyn Similarity>,
    pub threads: usize,
    /// Stats chip: off | on | stale – what the similarity provider promised.
    pub embed_state: String,
}

impl Default for Builder<'_> {
    fn default() -> Self {
        Builder { similarity: None, threads: default_threads(), embed_state: "off".into() }
    }
}

/// Bounded pool size: min(cores − 2, 6), overridable by `[syntagm] threads` in kula.toml.
pub fn default_threads() -> usize {
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    (cores.saturating_sub(2)).clamp(1, 6)
}

/// Drop the process priority (nice 10) so block building never competes with
/// the user's foreground work. Best effort – failure to renice is not fatal.
fn lower_priority() {
    let pid = std::process::id().to_string();
    let _ = std::process::Command::new("renice")
        .args(["10", "-p", &pid])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

fn config_threads(repo: &Repo) -> usize {
    if let Ok(src) = std::fs::read_to_string(repo.root.join("kula.toml")) {
        if let Ok(t) = src.parse::<toml::Table>() {
            if let Some(v) = t.get("syntagm").and_then(|s| s.get("threads")).and_then(|v| v.as_integer()) {
                return v.clamp(1, 64) as usize;
            }
        }
    }
    default_threads()
}

/// The bounded pool all syntagm work runs on: never more than `threads` workers,
/// so a huge repository cannot saturate the machine.
fn pool(threads: usize) -> rayon::ThreadPool {
    rayon::ThreadPoolBuilder::new().num_threads(threads).thread_name(|i| format!("syntagm-{i}")).build().expect("rayon pool")
}

/// Build (or reuse) blocks and chains for the repository, store them, return them.
pub fn build(repo: &Repo, store: &Store) -> Result<Syntagm> {
    build_with(repo, store, None, "off")
}

pub fn build_with(repo: &Repo, store: &Store, sim: Option<&dyn Similarity>, embed_state: &str) -> Result<Syntagm> {
    let b = Builder { similarity: sim, threads: config_threads(repo), embed_state: embed_state.to_string() };
    b.run(repo, store)
}

impl Builder<'_> {
    pub fn run(&self, _repo: &Repo, store: &Store) -> Result<Syntagm> {
        let t0 = std::time::Instant::now();
        lower_priority();
        let rev = file_rev(store)?;
        let mut s = if store.meta("syntagm_rev").is_some_and(|r| r == rev) {
            load_stored(store, &self.embed_state)?.unwrap_or_else(|| self.compute(store))
        } else {
            let s = self.compute(store);
            let _ = store_stored(store, &s, &rev);
            s
        };
        s.stats.ms = t0.elapsed().as_millis();
        Ok(s)
    }

    fn compute(&self, store: &Store) -> Syntagm {
        let nodes = store.nodes_where("kind != 'file'", []).unwrap_or_default();
        let edges = store.all_edges().unwrap_or_default();
        let idx: HashMap<i64, usize> = nodes.iter().enumerate().map(|(i, n)| (n.id, i)).collect();
        let n = nodes.len();

        // Re-export barrels (`__init__`, `index.ts`, `mod.rs`) and test code
        // carry no CALLS weight for grouping or chains – they are kept as their
        // own small sections instead of gluing the graph together.
        let is_test: Vec<bool> = {
            let p = pool(self.threads);
            p.install(|| nodes.par_iter().map(|x| is_test_path(&x.path)).collect::<Vec<_>>())
        };
        // One work batch per parallel pass or ≤64-item chunk actually executed.
        let mut batches = 1usize;
        let is_hub_file: Vec<bool> = nodes.iter().map(|x| is_reexport(&x.path)).collect();

        // Call-graph degrees: hub down-weighting and chain entries. Entry
        // degrees count production callers only.
        let mut out_deg = vec![0usize; n];
        let mut in_deg = vec![0usize; n];
        let mut prod_in = vec![0usize; n];
        let mut prod_out = vec![0usize; n];
        let mut call_adj: Vec<Vec<usize>> = vec![Vec::new(); n];
        for e in &edges {
            if e.kind == "CALLS" {
                if let (Some(&a), Some(&b)) = (idx.get(&e.src), idx.get(&e.dst)) {
                    if a != b {
                        out_deg[a] += 1;
                        in_deg[b] += 1;
                        if !is_test[a] && !is_test[b] && !is_hub_file[a] && !is_hub_file[b] {
                            prod_out[a] += 1;
                            prod_in[b] += 1;
                            call_adj[a].push(b);
                        }
                    }
                }
            }
        }
        for row in &mut call_adj {
            row.sort();
            row.dedup();
        }

        // Weighted undirected adjacency with hub down-weighting.
        let mut adj: Vec<BTreeMap<usize, f64>> = vec![BTreeMap::new(); n];
        for e in &edges {
            let (Some(&a), Some(&b)) = (idx.get(&e.src), idx.get(&e.dst)) else { continue };
            if a == b || is_test[a] || is_test[b] || is_hub_file[a] || is_hub_file[b] {
                continue;
            }
            let mut w = match e.kind.as_str() {
                "CALLS" => e.weight.max(0.25),
                "INHERITS" => 0.9,
                "IMPORTS" => 0.6,
                // Symbol→symbol CONTAINS (nested definitions) adds mild
                // file-internal cohesion; file→symbol CONTAINS is skipped
                // naturally because file nodes are not in the symbol index.
                "CONTAINS" => 0.3,
                _ => 0.0,
            };
            if w == 0.0 {
                continue;
            }
            w *= hub_factor(in_deg[a] + out_deg[a]) * hub_factor(in_deg[b] + out_deg[b]);
            *adj[a].entry(b).or_default() += w;
            *adj[b].entry(a).or_default() += w;
        }
        // Optional similarity provider: fills only where the graph is silent,
        // so embeddings refine blocks without overriding graph structure.
        if let Some(sim) = self.similarity {
            let mut dirs: BTreeMap<String, Vec<usize>> = BTreeMap::new();
            for (i, node) in nodes.iter().enumerate() {
                dirs.entry(dir_of(&node.path)).or_default().push(i);
            }
            for group in dirs.into_values() {
                for chunk in group.chunks(64) {
                    batches += 1;
                    for (x, &i) in chunk.iter().enumerate() {
                        for &j in &chunk[x + 1..] {
                            let s = sim.similarity(nodes[i].id, nodes[j].id);
                            if s > 0.72 && !adj[i].contains_key(&j) {
                                *adj[i].entry(j).or_default() += 0.5 * s;
                                *adj[j].entry(i).or_default() += 0.5 * s;
                            }
                        }
                    }
                }
            }
        }

        // Hierarchy: sections from the top partition, then recursive splits.
        let all: Vec<usize> = (0..n).collect();
        let mut secs = build_level(&nodes, &adj, &all, &is_test, 0, true, 0.35, 0.2);
        if secs.len() > MAX_SECTIONS {
            secs = merge_smallest(secs, MAX_SECTIONS, &nodes, &is_test);
        }
        // Emit blocks depth-first with stable deterministic ids.
        let mut blocks: Vec<Block> = Vec::new();
        let mut counter = 0usize;
        for sec in &secs {
            emit_tree(sec, &nodes, &adj, &in_deg, &mut blocks, None, 0, &mut counter);
        }

        let chains = build_chains(&nodes, &call_adj, &prod_in, &prod_out, &is_test, &is_hub_file, &blocks);
        let stats = SyntagmStats { ms: 0, batches, threads: self.threads, embed: self.embed_state.clone() };
        let _ = store.set_meta("syntagm_embed", &self.embed_state);
        Syntagm { blocks, chains, stats }
    }
}

// ----------------------------------------------------------------– partition

#[derive(Debug, Clone)]
struct TreeNode {
    members: Vec<usize>,
    children: Vec<TreeNode>,
}

/// Partition one level. Returns the tree nodes of this level; oversized parts
/// recurse with a weakened directory prior so a tight directory cannot stall
/// the split.
#[allow(clippy::too_many_arguments)] // the slices are all distinct graph views
fn build_level(
    nodes: &[crate::store::Node],
    adj: &[BTreeMap<usize, f64>],
    members: &[usize],
    is_test: &[bool],
    depth: usize,
    split_tests: bool,
    prior: f64,
    cross: f64,
) -> Vec<TreeNode> {
    if members.len() <= MAX_LEAVES && depth > 0 {
        return vec![TreeNode { members: members.to_vec(), children: vec![] }];
    }

    // Test code never merges into production groups: the top-level grouping
    // keeps test files in their own sections (module grouping already
    // separates them; a test file inside a source module is split out here).
    let (tests, rest): (Vec<usize>, Vec<usize>) =
        if depth == 0 && split_tests { members.iter().copied().partition(|&m| is_test[m]) } else { (vec![], members.to_vec()) };

    // The top level is grouped by module, not by label propagation: a wide
    // call net across module boundaries percolates under label propagation and
    // resurrects the giant-cluster failure. Modules are the directory prior
    // made structural; the weighted graph partition then drives every level
    // below.
    let mut parts = if depth == 0 {
        let mut mods: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        for &m in &rest {
            mods.entry(module_key(&nodes[m].path)).or_default().push(m);
        }
        mods.into_values().collect()
    } else {
        partition(nodes, adj, &rest, prior, cross, 24, false)
    };
    if depth == 0 {
        // Test files that share a module with production code split off.
        let mut split: Vec<Vec<usize>> = Vec::new();
        for p in parts.drain(..) {
            let (t, r): (Vec<usize>, Vec<usize>) = p.iter().copied().partition(|&m| is_test[m]);
            if !r.is_empty() {
                split.push(r);
            }
            if !t.is_empty() {
                split.push(t);
            }
        }
        parts = split;
    }
    let sub_prior = (prior * 0.5).max(0.05);
    let sub_cross = (cross * 2.5).min(1.0);
    let mut out: Vec<TreeNode> = Vec::new();
    for p in parts {
        out.extend(part_tree(nodes, adj, &p, is_test, depth, sub_prior, sub_cross));
    }
    if !tests.is_empty() {
        // The tests group splits into its own sections per test module, not
        // one wrapper: reuse the same top-level grouping on the test members.
        let mut mods: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        for &m in &tests {
            mods.entry(module_key(&nodes[m].path)).or_default().push(m);
        }
        for g in mods.into_values() {
            out.extend(part_tree(nodes, adj, &g, is_test, 1, sub_prior, sub_cross));
        }
    }
    out
}

/// One member set as a tree node: leaf when small enough, container otherwise.
#[allow(clippy::too_many_arguments)]
fn part_tree(
    nodes: &[crate::store::Node],
    adj: &[BTreeMap<usize, f64>],
    p: &[usize],
    is_test: &[bool],
    depth: usize,
    prior: f64,
    cross: f64,
) -> Vec<TreeNode> {
    if p.len() <= MAX_LEAVES {
        return vec![TreeNode { members: p.to_vec(), children: vec![] }];
    }
    if depth > 6 {
        // Refuses to split by structure – cut by directory, then by chunks.
        return cut_by_dir(nodes, p, is_test);
    }
    let children = build_level(nodes, adj, p, is_test, depth + 1, false, prior, cross);
    if children.len() == 1 {
        return children; // skip a pointless single-child wrapper
    }
    let children = merge_smallest(children, MAX_CHILDREN, nodes, is_test);
    vec![TreeNode { members: p.to_vec(), children }]
}

/// A member set that refuses to split by structure is cut by file, then chunked.
fn cut_by_dir(nodes: &[crate::store::Node], members: &[usize], is_test: &[bool]) -> Vec<TreeNode> {
    let mut files: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for &m in members {
        files.entry(nodes[m].path.clone()).or_default().push(m);
    }
    let parts: Vec<Vec<usize>> = files.into_values().collect();
    if parts.len() <= 1 {
        return members.chunks(MAX_LEAVES).map(|c| TreeNode { members: c.to_vec(), children: vec![] }).collect();
    }
    // A single huge file is still chunked so no leaf block exceeds the cap.
    let mut out: Vec<TreeNode> = Vec::new();
    for p in parts {
        for chunk in p.chunks(MAX_LEAVES) {
            out.push(TreeNode { members: chunk.to_vec(), children: vec![] });
        }
    }
    merge_smallest(std::mem::take(&mut out), MAX_CHILDREN, nodes, is_test)
}

/// Merge the smallest groups until at most `max` remain. Container children
/// are preserved so no subtree is dropped. Test groups are never merged into
/// production groups – test code keeps its own sections. Deterministic.
fn merge_smallest(mut groups: Vec<TreeNode>, max: usize, _nodes: &[crate::store::Node], is_test: &[bool]) -> Vec<TreeNode> {
    while groups.len() > max {
        groups.sort_by_key(|c| c.members.len());
        let a = groups.remove(0);
        // Only tiny fragments merge, and only into a group of the same kind
        // (test with test, code with code); otherwise stop – more sections are
        // better than breaking domains or mixing test code in.
        if a.members.len() > MIN_SECTION {
            groups.push(a);
            break;
        }
        let flag = is_test[a.members[0]];
        let match_at = groups.iter().position(|g| is_test[g.members[0]] == flag);
        let Some(at) = match_at else {
            groups.push(a);
            break;
        };
        let b = groups.remove(at);
        let (a, b) = if is_test[a.members[0]] == is_test[b.members[0]] { (a, b) } else { (b, a) };
        let children = [a.children, b.children].concat();
        let members = [a.members.clone(), b.members.clone()].concat();
        // Two leaves that together exceed the cap must become a container, not
        // one oversized leaf.
        if children.is_empty() && members.len() > MAX_LEAVES {
            groups.push(TreeNode {
                members,
                children: vec![TreeNode { members: a.members, children: vec![] }, TreeNode { members: b.members, children: vec![] }],
            });
        } else {
            groups.push(TreeNode { members, children });
        }
    }
    groups.sort_by_key(|c| c.members.first().copied().unwrap_or(usize::MAX));
    groups
}

/// Weighted label propagation with a directory prior. Deterministic: fixed
/// order, ties broken by the smaller label.
fn partition(
    nodes: &[crate::store::Node],
    adj: &[BTreeMap<usize, f64>],
    members: &[usize],
    prior: f64,
    cross: f64,
    rounds: usize,
    coarse: bool,
) -> Vec<Vec<usize>> {
    let n = members.len();
    if n <= 1 {
        return vec![members.to_vec()];
    }
    let local: HashMap<usize, usize> = members.iter().enumerate().map(|(i, &m)| (m, i)).collect();

    // Cross-directory edges are scaled by `cross`: at the top level long-range
    // calls count for much less than local ones, so wide call nets cannot glue
    // every module into one section. The penalty relaxes with depth.
    let mut edges: Vec<Vec<(usize, f64)>> = vec![Vec::new(); n];
    for (i, &m) in members.iter().enumerate() {
        let dm = dir_of(&nodes[m].path);
        for (&o, &w) in &adj[m] {
            if let Some(&j) = local.get(&o) {
                let w = if dir_of(&nodes[o].path) == dm { w } else { w * cross };
                edges[i].push((j, w));
            }
        }
    }
    // Directory prior: same-directory leaves get a mild affinity so files stick
    // to their module before anything else. The top level groups by module.
    let mut dirs: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, &m) in members.iter().enumerate() {
        let key = if coarse { module_key(&nodes[m].path) } else { dir_of(&nodes[m].path) };
        dirs.entry(key).or_default().push(i);
    }
    for g in dirs.into_values() {
        for (x, &i) in g.iter().enumerate() {
            for &j in &g[x + 1..] {
                edges[i].push((j, prior));
                edges[j].push((i, prior));
            }
        }
    }

    // Few rounds at the top level: label propagation percolates across a whole
    // repository if left running, and the giant-cluster failure returns. Local
    // rounds keep sections anchored to their directories; recursion refines.
    let mut label: Vec<usize> = (0..n).collect();
    for _round in 0..rounds {
        let mut changed = 0;
        for i in 0..n {
            if edges[i].is_empty() {
                continue;
            }
            let mut score: BTreeMap<usize, f64> = BTreeMap::new();
            for &(j, w) in &edges[i] {
                *score.entry(label[j]).or_default() += w;
            }
            *score.entry(label[i]).or_default() += 0.05; // mild self-affinity
            let best = score.into_iter().max_by(|a, b| a.1.partial_cmp(&b.1).unwrap().then(b.0.cmp(&a.0))).map(|x| x.0).unwrap();
            if best != label[i] {
                label[i] = best;
                changed += 1;
            }
        }
        if changed == 0 {
            break;
        }
    }

    let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (i, l) in label.iter().enumerate() {
        groups.entry(*l).or_default().push(members[i]);
    }
    groups.into_values().collect()
}

// ----------------------------------------------------------------– naming

fn dir_of(path: &str) -> String {
    path.rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_else(|| ".".into())
}

/// Coarse top-level grouping key: the module a file belongs to. Tests group by
/// their domain (`tests/unit/genomic`), source by its domain under the crate
/// root (`src/homonin/genomic`), everything else by its first two segments.
/// Used as the directory prior at the top level so sections line up with
/// modules instead of single directories.
fn module_key(path: &str) -> String {
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if segs.first().is_some_and(|s| *s == "tests" || *s == "test" || *s == "spec") {
        return segs.iter().take(3).cloned().collect::<Vec<_>>().join("/");
    }
    let generic = ["src", "lib", "internal", "app", "core"];
    let start = if segs.len() > 2 && generic.contains(&segs[0]) { 1 } else { 0 };
    segs.iter().take(start + 2).cloned().collect::<Vec<_>>().join("/")
}

/// Generic directory names carry no meaning; prefer the next one up.
fn meaningful_dir(path: &str) -> String {
    let generic = ["src", "lib", "pkg", "internal", "app", "core", "utils", "helpers", "common", "tests", "test", "."];
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    for seg in segs.iter().rev().skip(1) {
        if !generic.contains(seg) && !seg.starts_with('.') {
            return (*seg).to_string();
        }
    }
    segs.first().map(|s| s.to_string()).unwrap_or_else(|| "repo".into())
}

pub fn is_test_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    let file = lower.rsplit('/').next().unwrap_or("");
    path.split('/').any(|s| matches!(s, "tests" | "test" | "__tests__" | "spec" | "specs"))
        || file.starts_with("test_")
        || file.ends_with("_test.py")
        || file.ends_with("_test.go")
        || file.ends_with(".test.ts")
        || file.ends_with(".test.tsx")
        || file.ends_with(".spec.ts")
        || file.ends_with(".spec.tsx")
        || file.ends_with(".spec.js")
        || file.ends_with("_test.rs")
        || file == "conftest.py"
}

fn is_reexport(path: &str) -> bool {
    matches!(path.rsplit('/').next().unwrap_or(""), "__init__.py" | "index.ts" | "index.tsx" | "index.js" | "mod.rs")
}

/// Hubs are down-weighted by degree, log-scaled above 50, so re-export and
/// fixture hubs cannot glue the graph together.
fn hub_factor(degree: usize) -> f64 {
    if degree <= 50 {
        1.0
    } else {
        1.0 / (1.0 + ((degree as f64) / 50.0).ln())
    }
}

const STOP_TOKENS: &[&str] = &[
    "get",
    "set",
    "new",
    "test",
    "tests",
    "init",
    "from",
    "into",
    "with",
    "the",
    "and",
    "for",
    "data",
    "value",
    "name",
    "item",
    "items",
    "self",
    "this",
    "impl",
    "make",
    "build",
    "run",
    "pub",
    "func",
    "const",
    "let",
    "var",
    "type",
    "class",
    "struct",
    "enum",
    "trait",
    "interface",
    "module",
    "string",
    "error",
    "result",
    "option",
    "vector",
];

/// Split camelCase / snake_case / kebab-case identifiers into lowercase tokens.
fn tokens(name: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for ch in name.chars() {
        if ch.is_alphanumeric() {
            if ch.is_uppercase() && !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            cur.extend(ch.to_lowercase());
        } else if !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out.into_iter().filter(|t| t.len() > 2 && !STOP_TOKENS.contains(&t.as_str())).collect()
}

/// Deterministic name: dominant path segment · most-called symbol, with the
/// top identifier token as fallback. One-line summary, counts only.
fn name_block(nodes: &[crate::store::Node], in_deg: &[usize], members: &[usize], parent_name: &str) -> (String, String) {
    let mut segs: BTreeMap<String, usize> = BTreeMap::new();
    let mut toks: BTreeMap<String, usize> = BTreeMap::new();
    let mut hub: Option<(usize, String)> = None;
    for &m in members {
        *segs.entry(meaningful_dir(&nodes[m].path)).or_default() += 1;
        for t in tokens(&nodes[m].name) {
            *toks.entry(t).or_default() += 1;
        }
        if nodes[m].kind == "function" || nodes[m].kind == "method" {
            let d = in_deg[m];
            let name = nodes[m].name.clone();
            let better = match &hub {
                Some((hd, hn)) => d > *hd || (d == *hd && name < *hn),
                None => true,
            };
            if better {
                hub = Some((d, name));
            }
        }
    }
    let seg = segs.into_iter().max_by_key(|(k, v)| (*v, std::cmp::Reverse(k.clone()))).map(|(k, _)| k).unwrap_or_else(|| "code".into());
    let short = |s: &str| s.rsplit("::").next().unwrap_or(s).split('.').next().unwrap_or(s).to_lowercase();
    let hub_short = hub.as_ref().map(|(_, n)| short(n));
    let tail = hub_short
        .clone()
        .filter(|t| t.len() >= 4)
        .or_else(|| toks.into_iter().max_by_key(|(k, v)| (*v, std::cmp::Reverse(k.clone()))).map(|(k, _)| k))
        .or(hub_short);
    let mut name = match tail {
        Some(t) => format!("{seg} · {t}"),
        None => seg.clone(),
    };
    if name == parent_name {
        name = format!("{name} · inner");
    }
    let files: HashSet<&str> = members.iter().map(|&m| nodes[m].path.as_str()).collect();
    let nf = files.len();
    let summary = format!("{} · {} symbols", if nf == 1 { "1 file".to_string() } else { format!("{nf} files") }, members.len());
    (name, summary)
}

/// Emit one tree node and its descendants as blocks. Leaves carry the symbols;
/// containers carry none directly. Cohesion is internal edge weight over all
/// edge weight touching the members, 1.0 when isolated.
#[allow(clippy::too_many_arguments)] // the slices are all distinct graph views
fn emit_tree(
    tree: &TreeNode,
    nodes: &[crate::store::Node],
    adj: &[BTreeMap<usize, f64>],
    in_deg: &[usize],
    out: &mut Vec<Block>,
    parent: Option<&Block>,
    depth: usize,
    counter: &mut usize,
) -> Block {
    let id = format!("b{}", *counter);
    *counter += 1;
    let kind = if depth == 0 {
        "section"
    } else if tree.children.is_empty() {
        "block"
    } else {
        "sub"
    };
    let (name, summary) = name_block(nodes, in_deg, &tree.members, parent.map(|p| p.name.as_str()).unwrap_or(""));
    let files: HashSet<&str> = tree.members.iter().map(|&m| nodes[m].path.as_str()).collect();
    let set: HashSet<usize> = tree.members.iter().copied().collect();
    let (mut inner_w, mut outer_w) = (0.0, 0.0);
    for &m in &tree.members {
        for (&o, &w) in &adj[m] {
            if set.contains(&o) {
                inner_w += w;
            } else {
                outer_w += w;
            }
        }
    }
    let cohesion = if inner_w + outer_w == 0.0 { 1.0 } else { (inner_w / (inner_w + outer_w) * 100.0).round() / 100.0 };

    // Children first so the parent can list their ids.
    let base = Block {
        id: id.clone(),
        parent: parent.map(|p| p.id.clone()),
        depth,
        name,
        summary,
        kind: kind.into(),
        symbols: vec![],
        children: vec![],
        files: files.len(),
        cohesion,
        source: "graph".into(),
    };
    // Children emit first (post-order) so the parent can list their real ids.
    let children: Vec<Block> =
        tree.children.iter().map(|c| emit_tree(c, nodes, adj, in_deg, out, Some(&base), depth + 1, counter)).collect();
    let mut block = base;
    block.children = children.iter().map(|c| c.id.clone()).collect();
    if block.children.is_empty() {
        block.symbols = tree.members.iter().map(|&m| nodes[m].id).collect();
    }
    out.push(block.clone());
    block
}

// ----------------------------------------------------------------– chains

/// Maximal call paths from entry points (nothing calls them, they call things;
/// barrels and test code are not entries). Prefix chains are dropped. Each
/// chain lists the deepest blocks it crosses, in order.
#[allow(clippy::too_many_arguments)] // the slices are all distinct graph views
fn build_chains(
    nodes: &[crate::store::Node],
    call_adj: &[Vec<usize>],
    prod_in: &[usize],
    prod_out: &[usize],
    is_test: &[bool],
    is_hub_file: &[bool],
    blocks: &[Block],
) -> Vec<Chain> {
    let mut entries: Vec<usize> = (0..nodes.len())
        .filter(|&i| {
            (nodes[i].kind == "function" || nodes[i].kind == "method")
                && prod_in[i] == 0
                && prod_out[i] > 0
                && !is_test[i]
                && !is_hub_file[i]
        })
        .collect();
    entries.sort_by(|a, b| prod_out[*b].cmp(&prod_out[*a]).then(nodes[*a].name.cmp(&nodes[*b].name)).then(a.cmp(b)));
    entries.truncate(MAX_ENTRIES);

    // Deepest block containing each symbol; symbols with no leaf block fall
    // back to their shallowest container.
    let mut deep_of: HashMap<i64, &Block> = HashMap::new();
    let mut any_of: HashMap<i64, &Block> = HashMap::new();
    for b in blocks {
        for &s in &b.symbols {
            any_of.entry(s).or_insert(b);
            if b.children.is_empty() {
                deep_of.insert(s, b);
            }
        }
    }
    let block_of = |i: usize| deep_of.get(&nodes[i].id).or_else(|| any_of.get(&nodes[i].id)).map(|b| b.id.clone());

    let mut chains: Vec<Chain> = Vec::new();
    for &e in &entries {
        let mut paths: Vec<Vec<usize>> = Vec::new();
        let mut stack = vec![(e, vec![e], HashSet::from([e]))];
        while let Some((node, path, on_path)) = stack.pop() {
            let callees: Vec<usize> = call_adj[node].iter().copied().filter(|c| !on_path.contains(c)).take(MAX_BRANCH).collect();
            if callees.is_empty() || path.len() >= MAX_CHAIN_DEPTH {
                paths.push(path);
                continue;
            }
            for c in callees {
                let mut p2 = path.clone();
                let mut op2 = on_path.clone();
                p2.push(c);
                op2.insert(c);
                stack.push((c, p2, op2));
            }
            if stack.len() > MAX_PATHS_PER_ENTRY * 8 {
                paths.push(path);
            }
        }
        paths.truncate(MAX_PATHS_PER_ENTRY);
        for p in paths {
            if p.len() < 2 {
                continue;
            }
            let mut crossed: Vec<String> = Vec::new();
            for &s in &p {
                if let Some(id) = block_of(s) {
                    if !crossed.contains(&id) {
                        crossed.push(id);
                    }
                }
            }
            chains.push(Chain {
                id: String::new(),
                entry: nodes[e].id,
                steps: p.iter().map(|&s| nodes[s].id).collect(),
                blocks: crossed,
                len: p.len(),
            });
        }
    }
    // Drop chains that are a strict prefix of another chain.
    chains.sort_by(|a, b| b.steps.len().cmp(&a.steps.len()).then(a.steps.cmp(&b.steps)));
    let mut kept: Vec<Vec<i64>> = Vec::new();
    chains.retain(|c| {
        if kept.iter().any(|k| k.starts_with(&c.steps)) {
            return false;
        }
        kept.push(c.steps.clone());
        true
    });
    chains.sort_by(|a, b| b.len.cmp(&a.len).then(a.steps.cmp(&b.steps)));
    for (i, c) in chains.iter_mut().enumerate() {
        c.id = format!("c{i}");
    }
    chains
}

// ----------------------------------------------------------------– storage

/// Hash of every indexed file's symbols and touching edges – the incremental
/// rebuild key. Unchanged files produce the same hash, so the stored tree is
/// reused instead of recomputed.
pub fn file_rev(store: &Store) -> Result<String> {
    let nodes = store.nodes_where("kind != 'file'", [])?;
    let edges = store.all_edges()?;
    let mut h = Sha256::new();
    let mut per_file: BTreeMap<String, Vec<i64>> = BTreeMap::new();
    for n in &nodes {
        per_file.entry(n.path.clone()).or_default().push(n.id);
    }
    let mut touched: HashMap<i64, Vec<String>> = HashMap::new();
    for e in &edges {
        touched.entry(e.src).or_default().push(format!(">{}/{}:{}", e.dst, e.kind, e.weight));
        touched.entry(e.dst).or_default().push(format!("<{}/{}:{}", e.src, e.kind, e.weight));
    }
    for (path, mut ids) in per_file {
        ids.sort();
        let mut parts: Vec<String> = Vec::new();
        for id in ids {
            if let Some(n) = store.node(id)? {
                let mut es = touched.remove(&id).unwrap_or_default();
                es.sort();
                parts.push(format!("{}:{}:{}|{}", n.name, n.kind, n.start_line, es.join(",")));
            }
        }
        parts.sort();
        h.update(format!("{path}\n{}\n", parts.join("\n")));
    }
    Ok(format!("{:x}", h.finalize()))
}

fn store_stored(store: &Store, s: &Syntagm, rev: &str) -> Result<()> {
    store.conn.execute_batch(SYNTAGM_SCHEMA)?;
    store.conn.execute("DELETE FROM syntagm_blocks", [])?;
    store.conn.execute("DELETE FROM syntagm_chains", [])?;
    for (i, b) in s.blocks.iter().enumerate() {
        store.conn.execute(
            "INSERT OR REPLACE INTO syntagm_blocks VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            rusqlite::params![
                b.id,
                b.parent,
                b.depth as i64,
                b.kind,
                b.name,
                b.summary,
                serde_json::to_string(&b.symbols)?,
                serde_json::to_string(&b.children)?,
                b.files as i64,
                b.cohesion,
                b.source,
                i as i64
            ],
        )?;
    }
    for (i, c) in s.chains.iter().enumerate() {
        store.conn.execute(
            "INSERT OR REPLACE INTO syntagm_chains VALUES (?1,?2,?3,?4,?5,?6)",
            rusqlite::params![c.id, c.entry, serde_json::to_string(&c.steps)?, serde_json::to_string(&c.blocks)?, c.len as i64, i as i64],
        )?;
    }
    store.set_meta("syntagm_rev", rev)?;
    Ok(())
}

fn load_stored(store: &Store, embed_state: &str) -> Result<Option<Syntagm>> {
    let has =
        store.conn.query_row("SELECT count(*) FROM sqlite_master WHERE name = 'syntagm_blocks'", [], |r| r.get::<_, i64>(0)).unwrap_or(0);
    if has == 0 {
        return Ok(None);
    }
    let mut blocks = Vec::new();
    {
        let mut st = store.conn.prepare(
            "SELECT id, parent, depth, kind, name, summary, symbols, children, files, cohesion, source FROM syntagm_blocks ORDER BY idx",
        )?;
        let rows = st.query_map([], |r| {
            Ok(Block {
                id: r.get(0)?,
                parent: r.get(1)?,
                depth: r.get::<_, i64>(2)? as usize,
                kind: r.get(3)?,
                name: r.get(4)?,
                summary: r.get(5)?,
                symbols: serde_json::from_str(&r.get::<_, String>(6)?).unwrap_or_default(),
                children: serde_json::from_str(&r.get::<_, String>(7)?).unwrap_or_default(),
                files: r.get::<_, i64>(8)? as usize,
                cohesion: r.get(9)?,
                source: r.get(10)?,
            })
        })?;
        for b in rows {
            blocks.push(b?);
        }
    }
    if blocks.is_empty() {
        return Ok(None);
    }
    let mut chains = Vec::new();
    {
        let mut st = store.conn.prepare("SELECT id, entry, steps, blocks, len FROM syntagm_chains ORDER BY idx")?;
        let rows = st.query_map([], |r| {
            Ok(Chain {
                id: r.get(0)?,
                entry: r.get(1)?,
                steps: serde_json::from_str(&r.get::<_, String>(2)?).unwrap_or_default(),
                blocks: serde_json::from_str(&r.get::<_, String>(3)?).unwrap_or_default(),
                len: r.get::<_, i64>(4)? as usize,
            })
        })?;
        for c in rows {
            chains.push(c?);
        }
    }
    Ok(Some(Syntagm { blocks, chains, stats: SyntagmStats { ms: 0, batches: 0, threads: default_threads(), embed: embed_state.into() } }))
}

// ----------------------------------------------------------------– readout

#[derive(Serialize)]
pub struct LeafInfo {
    pub name: String,
    pub kind: String,
    pub path: String,
    pub line: i64,
}

/// `GET /api/syntagm` shape with an optional similarity provider (E1's
/// embedding cache) and its state for the stats chip (off | on | stale).
pub fn all_json_with(repo: &Repo, store: &Store, sim: Option<&dyn Similarity>, embed_state: &str) -> Result<serde_json::Value> {
    let s = build_with(repo, store, sim, embed_state)?;
    let mut leaves = serde_json::Map::new();
    for n in store.nodes_where("kind != 'file'", [])? {
        leaves.insert(n.id.to_string(), serde_json::json!({ "name": n.name, "kind": n.kind, "path": n.path, "line": n.start_line }));
    }
    Ok(serde_json::json!({ "blocks": s.blocks, "chains": s.chains, "leaves": leaves, "stats": s.stats }))
}

/// `GET /api/syntagm/block/:id` shape – the block, its children and its leaves.
pub fn block_json(repo: &Repo, store: &Store, id: &str) -> Result<serde_json::Value> {
    let s = build(repo, store)?;
    let b = s.blocks.iter().find(|b| b.id == id).ok_or_else(|| anyhow::anyhow!("no block {id}"))?;
    let children: Vec<&Block> = s.blocks.iter().filter(|c| c.parent.as_deref() == Some(id)).collect();
    let mut leaves = Vec::new();
    for sid in &b.symbols {
        if let Some(n) = store.node(*sid)? {
            leaves.push(LeafInfo { name: n.name, kind: n.kind, path: n.path, line: n.start_line });
        }
    }
    Ok(serde_json::json!({ "block": b, "children": children, "leaves": leaves }))
}

/// `GET /api/syntagm/chain/:id` shape – the chain and its resolved steps.
pub fn chain_json(repo: &Repo, store: &Store, id: &str) -> Result<serde_json::Value> {
    let s = build(repo, store)?;
    let c = s.chains.iter().find(|c| c.id == id).ok_or_else(|| anyhow::anyhow!("no chain {id}"))?;
    let mut steps = Vec::new();
    for sid in &c.steps {
        if let Some(n) = store.node(*sid)? {
            steps.push(serde_json::json!({ "id": n.id, "name": n.name, "kind": n.kind, "path": n.path, "line": n.start_line }));
        }
    }
    Ok(serde_json::json!({ "chain": c, "steps": steps }))
}

// ----------------------------------------------------------------– cli

#[derive(clap::Args, Debug)]
pub struct BlocksArgs {
    /// Show only blocks up to this depth.
    #[arg(long)]
    pub depth: Option<usize>,
}

#[derive(clap::Args, Debug)]
pub struct ChainsArgs {
    /// Chains starting at this symbol.
    #[arg(long)]
    pub from: Option<String>,
}

/// `kula blocks` human output.
pub fn print_blocks(s: &Syntagm, depth: Option<usize>) {
    let max = depth.unwrap_or(usize::MAX);
    println!("{} blocks · {} chains · {} ms\n", s.blocks.len(), s.chains.len(), s.stats.ms);
    for b in s.blocks.iter().filter(|b| b.depth <= max) {
        let indent = "  ".repeat(b.depth);
        println!("{}▪ {}  {}  cohesion {:.2}", indent, b.name, b.summary, b.cohesion);
    }
}

/// `kula chains` human output.
pub fn print_chains(store: &Store, s: &Syntagm, from: Option<&str>) -> Result<()> {
    let filtered: Vec<&Chain> = match from {
        Some(f) => {
            let ids: HashSet<i64> = store.resolve(f)?.into_iter().map(|n| n.id).collect();
            s.chains.iter().filter(|c| ids.contains(&c.entry)).collect()
        }
        None => s.chains.iter().collect(),
    };
    println!("{} chains\n", filtered.len());
    for c in filtered.iter().take(60) {
        let entry = store.node(c.entry)?.map(|n| n.name).unwrap_or_default();
        let names: Vec<String> = c.steps.iter().take(6).filter_map(|id| store.node(*id).ok().flatten().map(|n| n.name)).collect();
        println!("  ▶ {}  {} steps", entry, c.len);
        println!("      → {}", names.join(", "));
        println!("      blocks: {}", c.blocks.join(" › "));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
