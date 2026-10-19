//! Map – blocks, chains and roles built from the graph alone.
//!
//! Chains: every path through the CALLS graph that starts at a source (a
//! symbol nothing in the repo calls) and ends at a terminal (a symbol that
//! calls nothing in the repo) – all of them, never materialised at once. The
//! structure that *is* the list is stored: a Tarjan condensation (iterative –
//! a cycle becomes one loop node), a topological order, two path-count DPs
//! (`into` / `out`, u128 with saturation), edge chain flow, and chain
//! families keyed by (source, terminal). A lazy enumeration cursor streams
//! every chain on demand; the legacy blocks/chains surfaces sample from it.
//!
//! Blocks: a hierarchical partition over chain-flow-weighted edges
//! (`ln(1 + into[u] · out[v])`), weighted label propagation with a directory
//! prior, utilities pulled out before partitioning, hubs down-weighted and
//! test code kept apart, applied recursively per level with today's limits.
//!
//! Roles: one role per symbol and a dominant role per block, graph-only,
//! deterministic, explainable. Everything ties broken by symbol id.

use crate::git::Repo;
use crate::store::Store;
use anyhow::Result;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};

/// Maximum leaves a leaf-bearing block may hold. Containers hold none directly.
pub const MAX_LEAVES: usize = 40;
/// Maximum children per node; larger child sets are merged.
pub const MAX_CHILDREN: usize = 12;
/// Sections smaller than this may be merged into a neighbour of the same kind.
const MIN_SECTION: usize = 8;
/// Depth-0 sections aim for 5–15; the cap stays generous so domain boundaries
/// are never broken to satisfy the count.
pub const MAX_SECTIONS: usize = 30;
/// Legacy surface cap: chains materialised for the old blocks/chains shape.
/// The full list is exponential – families carry the exact counts.
pub const MAX_SAMPLED_CHAINS: usize = 4096;
/// Chains enumerated per family to list the blocks it can cross.
const FAMILY_BLOCKS_SAMPLE: usize = 512;

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
    pub role: String,   // dominant symbol role
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Chain {
    pub id: String,
    pub source: i64,     // node id the chain starts at (nothing calls it)
    pub terminal: i64,   // node id the chain ends at (it calls nothing)
    pub steps: Vec<i64>, // symbol ids; a loop node contributes its members in id order
    pub blocks: Vec<String>,
    pub len: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LoopNode {
    pub id: String, // l{n}
    pub members: Vec<i64>,
}

/// Block-pair chain flow for `/api/map` (owner's fmap view).
#[derive(Debug, Clone, Serialize)]
pub struct FlowEdge {
    pub from: String,
    pub to: String,
    pub weight: f64,
}

/// One step of a map run, reported over the progress channel.
#[allow(dead_code)] // consumed by map_run at integration
pub static ENGINE_PHASE: AtomicUsize = AtomicUsize::new(0);
const PHASE_GRAPH: usize = 1;
const PHASE_FLOW: usize = 2;
const PHASE_BLOCKS: usize = 3;
#[allow(dead_code)] // reported at integration
const PHASE_FAMILIES: usize = 4;
const PHASE_ROLES: usize = 5;

/// Report a finer phase to the engine (graph | dp | blocks | families | roles).
pub fn report_phase(phase: usize) {
    ENGINE_PHASE.store(phase, Ordering::SeqCst);
}

/// Current finer phase as text, empty when none. `map_run` merges it with its
/// own coarse phase.
#[allow(dead_code)] // merged into map_run's phase at integration
pub fn engine_phase() -> String {
    match ENGINE_PHASE.load(Ordering::SeqCst) {
        PHASE_GRAPH => "graph".into(),
        PHASE_FLOW => "dp".into(),
        PHASE_BLOCKS => "blocks".into(),
        PHASE_FAMILIES => "families".into(),
        PHASE_ROLES => "roles".into(),
        _ => String::new(),
    }
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
    /// Chain families keyed by (source, terminal) – every one, nothing dropped.
    #[serde(skip)]
    pub families: Vec<ChainFamily>,
    /// Loop nodes: one per strongly connected component with a cycle.
    #[serde(skip)]
    pub loops: Vec<LoopNode>,
    /// One role per symbol id.
    #[serde(skip)]
    pub roles: BTreeMap<i64, String>,
    /// Edge chain flow between block pairs, sorted, for /api/map.
    #[serde(skip)]
    pub flows: Vec<FlowEdge>,
    /// Value flows: entry → side-effect chains, named (M2).
    #[serde(skip)]
    pub value_flows: Vec<flows::OutFlow>,
    /// Total chain count, exact unless saturated past u128.
    #[serde(skip)]
    pub total: u128,
    #[serde(skip)]
    pub exact: bool,
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
  symbols TEXT, children TEXT, files INTEGER, cohesion REAL, source TEXT, role TEXT, idx INTEGER
);
CREATE TABLE IF NOT EXISTS syntagm_chains (
  id TEXT PRIMARY KEY, entry INTEGER, terminal INTEGER, steps TEXT, blocks TEXT, len INTEGER, idx INTEGER
);
CREATE TABLE IF NOT EXISTS syntagm_families (
  id TEXT PRIMARY KEY, source INTEGER, terminal INTEGER, count TEXT, exact INTEGER,
  min_len INTEGER, max_len INTEGER, blocks TEXT, idx INTEGER
);
CREATE TABLE IF NOT EXISTS syntagm_loops (id TEXT PRIMARY KEY, members TEXT, idx INTEGER);
CREATE TABLE IF NOT EXISTS syntagm_roles (node INTEGER PRIMARY KEY, role TEXT);
"#;

/// Older stores created the tables without the role / terminal columns; the
/// data is always regenerated wholesale, so altering them in place is safe.
fn ensure_schema(store: &Store) -> Result<()> {
    store.conn.execute_batch(SYNTAGM_SCHEMA)?;
    let has_col = |table: &str, col: &str| -> bool {
        let mut st = match store.conn.prepare(&format!("PRAGMA table_info({table})")) {
            Ok(st) => st,
            Err(_) => return false,
        };
        let mut cols = st.query_map([], |r| r.get::<_, String>(1)).map(|rows| rows.filter_map(|c| c.ok()).collect::<Vec<String>>());
        matches!(cols.as_mut().map(|c| c.contains(&col.to_string())), Ok(true))
    };
    if !has_col("syntagm_blocks", "role") {
        store.conn.execute("ALTER TABLE syntagm_blocks ADD COLUMN role TEXT", [])?;
    }
    if !has_col("syntagm_chains", "terminal") {
        store.conn.execute("ALTER TABLE syntagm_chains ADD COLUMN terminal INTEGER", [])?;
    }
    Ok(())
}

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
    // When the caller brings no provider (no cached page-embedding index),
    // the local deterministic hash embeddings still refine same-directory
    // blocks – under their own state key so the stored Syntagm stays distinct.
    let local = if sim.is_none() { embed::HashEmbedder::new(repo, store) } else { None };
    let b = match local.as_ref() {
        Some(e) => Builder { similarity: Some(e), threads: config_threads(repo), embed_state: embed::STATE.to_string() },
        None => Builder { similarity: sim, threads: config_threads(repo), embed_state: embed_state.to_string() },
    };
    let s = b.run(repo, store);
    if let Some(e) = local.as_ref() {
        e.flush();
    }
    s
}

impl Builder<'_> {
    pub fn run(&self, _repo: &Repo, store: &Store) -> Result<Syntagm> {
        let t0 = std::time::Instant::now();
        lower_priority();
        let rev = file_rev(store)?;
        let mut s = if store.meta("syntagm_rev").is_some_and(|r| r == rev) {
            let mut stored = load_stored(store, &self.embed_state)?;
            if let Some(s) = &mut stored {
                if s.value_flows.is_empty() {
                    s.value_flows = flows::extract_cached(store).unwrap_or_else(|| flows::extract(store));
                }
            }
            stored.unwrap_or_else(|| self.compute(store))
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

        // Chain flow comes first: the condensation and its path-count DPs
        // weight every production CALLS edge by how many chains use it, so
        // blocks form around chains, not around single calls.
        report_phase(PHASE_GRAPH);
        let cond = condense(&call_adj);
        report_phase(PHASE_FLOW);
        let counts = path_counts(&cond);
        report_phase(PHASE_FLOW);

        // Weighted undirected adjacency with hub down-weighting.
        let mut adj: Vec<BTreeMap<usize, f64>> = vec![BTreeMap::new(); n];
        for e in &edges {
            let (Some(&a), Some(&b)) = (idx.get(&e.src), idx.get(&e.dst)) else { continue };
            if a == b || is_test[a] || is_test[b] || is_hub_file[a] || is_hub_file[b] {
                continue;
            }
            let mut w = match e.kind.as_str() {
                "CALLS" => {
                    let base = e.weight.max(0.25);
                    let fw = flow_weight(&cond, &counts, a, b);
                    if fw > 0.0 {
                        base * fw
                    } else {
                        base
                    }
                }
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

        // Roles: one role per symbol, graph-only. Computed before the
        // partition so utilities can be pulled out first – a shared helper
        // never drags two features into one block.
        report_phase(PHASE_ROLES);
        let roles = classify_all(&nodes, &call_adj, &prod_in, &prod_out, &is_test, &is_hub_file);
        report_phase(PHASE_BLOCKS);

        // Utility symbols leave the partition input; they form their own
        // top-level sections grouped by module, emitted first.
        let utilities: BTreeSet<usize> = (0..n).filter(|&i| !is_test[i] && !is_hub_file[i] && roles[i] == "utility").collect();
        let core_members: Vec<usize> = (0..n).filter(|i| !utilities.contains(i)).collect();

        // Hierarchy: sections from the top partition, then recursive splits.
        let mut secs = build_level(&nodes, &adj, &core_members, &is_test, 0, true, 0.35, 0.2);
        if !utilities.is_empty() {
            let mut util_mods: BTreeMap<String, Vec<usize>> = BTreeMap::new();
            for &u in &utilities {
                util_mods.entry(module_key(&nodes[u].path)).or_default().push(u);
            }
            for g in util_mods.into_values() {
                secs.insert(0, TreeNode { members: g, children: vec![] });
            }
        }
        if secs.len() > MAX_SECTIONS {
            secs = merge_smallest(secs, MAX_SECTIONS, &nodes, &is_test);
        }
        // Emit blocks depth-first with stable deterministic ids.
        let idx_of: HashMap<i64, usize> = nodes.iter().enumerate().map(|(i, node)| (node.id, i)).collect();
        let mut blocks: Vec<Block> = Vec::new();
        let mut counter = 0usize;
        for sec in &secs {
            emit_tree(sec, &nodes, &adj, &in_deg, &roles, &idx_of, &mut blocks, None, 0, &mut counter);
        }

        let stats = SyntagmStats { ms: 0, batches, threads: self.threads, embed: self.embed_state.clone() };

        // Chains: the legacy surface samples the enumeration cursor – the
        // exact structure lives in families, loops and the total.
        let mut node_ids = vec![0i64; nodes.len()];
        for (i, node) in nodes.iter().enumerate() {
            node_ids[i] = node.id;
        }
        let (deep, any) = block_maps(&blocks);
        let block_lookup = |s: i64| deep.get(&s).cloned().or_else(|| any.get(&s).cloned()).unwrap_or_default();
        let (chains, families, loops) = self.build_all_chains(&cond, &counts, &nodes, &node_ids, &block_lookup);
        let flows = Self::flow_edges(&cond, &counts, &edges, &idx, &block_lookup);
        let roles_map: BTreeMap<i64, String> = node_ids.iter().enumerate().map(|(i, id)| (*id, roles[i].clone())).collect();
        let _ = store.set_meta("syntagm_embed", &self.embed_state);
        // Value flows: extracted once per revision, cached in the store.
        let value_flows = flows::extract(store);
        let _ = store.set_meta("syntagm_flows", &serde_json::to_string(&value_flows).unwrap_or_default());
        Syntagm { blocks, chains, stats, families, loops, roles: roles_map, flows, value_flows, total: counts.total, exact: counts.exact }
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

// ---------------------------------------------------------------– roles

/// Every symbol gets exactly one role; every block a dominant one. Rules are
/// graph-only, deterministic and shown in the UI as one line each.
/// Thresholds, tuned on homonin-scripts and on kula itself:
/// – utility fan-in ≥ 6 with fan-out ≤ 2 (called widely, calls nothing), or
///   under utils/ helpers/ common/ lib/ with fan-in ≥ 3 ("called widely");
/// – orchestrator fan-out ≥ 3 with fan-in ≤ 1;
/// – adapter patterns match the outside world: files, network, process, DB,
///   environment – detected from the symbol's and its callees' names.
pub const ROLES: [&str; 9] = ["entry", "orchestrator", "core", "utility", "adapter", "model", "config", "test", "glue"];

/// The `utils/helpers/common/lib` directories the utility rule reads.
const UTIL_DIRS: [&str; 4] = ["utils", "helpers", "common", "lib"];

/// One-line rule for a role, shown in the UI as its explanation.
#[allow(dead_code)] // served with the role legend in the UI
pub fn role_rule(role: &str) -> &'static str {
    match role {
        "entry" => "Nothing in the repo calls it, and it calls into the repo.",
        "orchestrator" => "Calls three or more things, is called by at most one.",
        "core" => "Inside a block's chains, neither entry nor utility – the actual work.",
        "utility" => "Called widely from at least three blocks and calls little itself.",
        "adapter" => "Touches the outside world: file, network, process, DB or env.",
        "model" => "A type or constant that is read more than called.",
        "config" => "Settings, constants and loaders under config paths or named so.",
        "test" => "Test code and fixtures.",
        "glue" => "Re-export barrels: __init__, mod.rs, index.ts.",
        _ => "Unclassified.",
    }
}

fn is_utility_dir(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.split('/').any(|s| UTIL_DIRS.contains(&s))
}

/// Name patterns that mean a symbol touches the outside world.
const ADAPTER_TOKENS: [&str; 22] = [
    "file", "read", "write", "open", "fetch", "http", "request", "response", "socket", "net", "connect", "exec", "spawn", "process",
    "query", "sql", "db", "database", "conn", "env", "download", "upload",
];

/// Classify one symbol. `callees` are the names of the symbols it calls.
pub fn classify_role(kind: &str, name: &str, path: &str, prod_in: usize, prod_out: usize, callees: &[String]) -> &'static str {
    let lower_name = name.to_lowercase();
    let lower_path = path.to_lowercase();
    if is_test_path(path) {
        return "test";
    }
    if is_reexport(path) {
        return "glue";
    }
    // Config paths or config-shaped file names – `settings.py` counts the
    // same as `config/` (tuned on homonin-scripts and kula).
    let stem = lower_path.rsplit('/').next().unwrap_or("");
    if lower_path.split('/').any(|s| s == "config" || s == "settings" || s == "constants")
        || stem.split('.').any(|s| s == "config" || s == "settings" || s == "constants")
        || lower_name.contains("config")
        || lower_name.contains("setting")
    {
        return "config";
    }
    if prod_in == 0 && prod_out > 0 {
        return "entry";
    }
    let util_dir = is_utility_dir(path);
    if (prod_in >= 6 && prod_out <= 2) || (util_dir && prod_in >= 3) {
        return "utility";
    }
    if matches!(kind, "class" | "struct" | "enum" | "interface" | "type" | "typedef" | "constant" | "module" | "trait" | "dataclass") {
        return "model";
    }
    let outside = lower_name.split('_').any(|t| ADAPTER_TOKENS.contains(&t))
        || callees.iter().any(|c| {
            let lc = c.to_lowercase();
            lc.split('_').any(|t| ADAPTER_TOKENS.contains(&t))
        });
    if outside {
        return "adapter";
    }
    if prod_out >= 3 && prod_in <= 1 {
        return "orchestrator";
    }
    "core"
}

/// Dominant role of one member set: the most common role, ties broken by the
/// fixed role order in ROLES.
pub fn dominant_role(roles: &[String], members: &[usize], idx_of: &HashMap<i64, usize>) -> String {
    let mut tally: BTreeMap<&str, usize> = BTreeMap::new();
    for &m in members {
        if let Some(role) = roles.get(m) {
            *tally.entry(role.as_str()).or_default() += 1;
        }
    }
    let mut best = ("core", 0usize);
    for (role, count) in tally {
        let rank = ROLES.iter().position(|r| *r == role).unwrap_or(0);
        let cur_rank = ROLES.iter().position(|r| *r == best.0).unwrap_or(0);
        if count > best.1 || (count == best.1 && rank < cur_rank) {
            best = (role, count);
        }
    }
    // Members dropped from the idx map (never happens in compute, kept for
    // the direct-call path in tests) get no vote.
    let _ = idx_of;
    best.0.to_string()
}

/// Classify every symbol once. Callee names come from the production call
/// adjacency; test and barrel symbols never call into production here, their
/// callees list is empty and their rules match earlier (test / glue).
fn classify_all(
    nodes: &[crate::store::Node],
    call_adj: &[Vec<usize>],
    prod_in: &[usize],
    prod_out: &[usize],
    is_test: &[bool],
    is_hub_file: &[bool],
) -> Vec<String> {
    nodes
        .iter()
        .enumerate()
        .map(|(i, node)| {
            let callees: Vec<String> = call_adj[i].iter().map(|&c| nodes[c].name.clone()).collect();
            if is_test[i] || is_hub_file[i] {
                return if is_test[i] { "test" } else { "glue" }.to_string();
            }
            classify_role(&node.kind, &node.name, &node.path, prod_in[i], prod_out[i], &callees).to_string()
        })
        .collect()
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

pub fn is_reexport(path: &str) -> bool {
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
    roles: &[String],
    idx_of: &HashMap<i64, usize>,
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
        role: dominant_role(roles, &tree.members, idx_of),
    };
    // Children emit first (post-order) so the parent can list their real ids.
    let children: Vec<Block> =
        tree.children.iter().map(|c| emit_tree(c, nodes, adj, in_deg, roles, idx_of, out, Some(&base), depth + 1, counter)).collect();
    let mut block = base;
    block.children = children.iter().map(|c| c.id.clone()).collect();
    if block.children.is_empty() {
        block.symbols = tree.members.iter().map(|&m| nodes[m].id).collect();
    }
    out.push(block.clone());
    block
}

// ----------------------------------------------------------------– chains

/// The condensed production call graph: one node per strongly connected
/// component (a cycle becomes one loop node), the DAG between them, its
/// sources and a topological order. Built with an iterative Tarjan – no
/// recursion, so no depth limit on any real graph.
pub struct Condensation {
    /// Component index per symbol index.
    pub scc_of: Vec<usize>,
    /// Members (symbol indices, ascending) per component.
    pub members: Vec<Vec<usize>>,
    /// A component with more than one member or a self-edge is a loop node.
    pub is_loop: Vec<bool>,
    /// DAG edges component → component, each target list sorted by its
    /// smallest member index – the order the enumeration cursor walks.
    pub dag: Vec<Vec<usize>>,
    /// Components with no incoming DAG edge and at least one outgoing call.
    pub sources: Vec<usize>,
    /// Topological order of component ids.
    pub order: Vec<usize>,
}

/// Iterative Tarjan condensation over the production call adjacency.
pub fn condense(call_adj: &[Vec<usize>]) -> Condensation {
    let n = call_adj.len();
    let mut index: Vec<usize> = vec![usize::MAX; n];
    let mut low: Vec<usize> = vec![0; n];
    let mut on_stack: Vec<bool> = vec![false; n];
    let mut scc_of: Vec<usize> = vec![usize::MAX; n];
    let mut raw: Vec<Vec<usize>> = Vec::new();
    let mut counter = 0usize;
    let mut history: Vec<usize> = Vec::new();
    // Iterative Tarjan: one (node, next-callee-index) frame per call level.
    let mut stack: Vec<(usize, usize)> = Vec::new();
    for start in 0..n {
        if index[start] != usize::MAX {
            continue;
        }
        stack.push((start, 0));
        while let Some((v, ci)) = stack.last_mut() {
            let (v, ci) = (*v, *ci);
            if ci == 0 {
                index[v] = counter;
                low[v] = counter;
                counter += 1;
                history.push(v);
                on_stack[v] = true;
            }
            if ci < call_adj[v].len() {
                let w = call_adj[v][ci];
                stack.last_mut().unwrap().1 = ci + 1;
                if index[w] == usize::MAX {
                    stack.push((w, 0));
                } else if on_stack[w] {
                    low[v] = low[v].min(index[w]);
                }
            } else {
                stack.pop();
                if low[v] == index[v] {
                    let mut comp = Vec::new();
                    while let Some(w) = history.pop() {
                        on_stack[w] = false;
                        scc_of[w] = raw.len();
                        comp.push(w);
                        if w == v {
                            break;
                        }
                    }
                    comp.sort_unstable();
                    raw.push(comp);
                }
                if let Some(&(p, _)) = stack.last() {
                    low[p] = low[p].min(low[v]);
                }
            }
        }
    }
    let m = raw.len();
    let members = raw;
    // A component is a loop node when it holds several members, or when its
    // single member calls itself.
    let mut is_loop = vec![false; m];
    for (v, row) in call_adj.iter().enumerate() {
        for &w in row {
            if scc_of[v] == scc_of[w] && (v == w || members[scc_of[v]].len() > 1) {
                is_loop[scc_of[v]] = true;
            }
        }
    }
    // DAG edges: any production call from one component to another. Intra-
    // component edges (the cycle itself) are dropped.
    let mut dag_sets: Vec<std::collections::BTreeSet<usize>> = vec![std::collections::BTreeSet::new(); m];
    for (v, row) in call_adj.iter().enumerate() {
        for &w in row {
            let (a, b) = (scc_of[v], scc_of[w]);
            if a != b {
                dag_sets[a].insert(b);
            }
        }
    }
    let dag: Vec<Vec<usize>> = dag_sets.into_iter().map(|s| s.into_iter().collect()).collect();
    let mut in_deg = vec![0usize; m];
    for row in &dag {
        for &b in row {
            in_deg[b] += 1;
        }
    }
    // Kahn topological order, deterministic by component id.
    let mut order: Vec<usize> = Vec::with_capacity(m);
    // Smallest component id first – deterministic. A BTreeSet keeps every
    // pop O(log m) instead of rescanning for the minimum each round.
    let mut ready: std::collections::BTreeSet<usize> = (0..m).filter(|&c| in_deg[c] == 0).collect();
    let mut deg = in_deg.clone();
    while let Some(&c) = ready.iter().next() {
        ready.remove(&c);
        order.push(c);
        for &b in &dag[c] {
            deg[b] -= 1;
            if deg[b] == 0 {
                ready.insert(b);
            }
        }
    }
    // Sources: no incoming edge and at least one outgoing call. Isolated
    // components carry no chains and are not sources.
    let sources: Vec<usize> = (0..m).filter(|&c| in_deg[c] == 0 && !dag[c].is_empty()).collect();
    Condensation { scc_of, members, is_loop, dag, sources, order }
}

/// Two path-count passes over the condensed DAG: `into[c]` counts the
/// source→c paths, `out[c]` counts the c→terminal paths. u128 with
/// saturation; `exact` is false the moment any count overflowed.
pub struct PathCounts {
    pub into: Vec<u128>,
    pub out: Vec<u128>,
    pub total: u128,
    pub exact: bool,
}

/// A saturating u128 add; `exact` drops when the ceiling is touched.
fn sat_add(a: &mut u128, b: u128, exact: &mut bool) {
    if b == 0 {
        return;
    }
    match a.checked_add(b) {
        Some(v) => *a = v,
        None => {
            *exact = false;
            *a = u128::MAX;
        }
    }
}

/// Path-count DPs in topological order. Total chains = Σ over sources out[s].
pub fn path_counts(cond: &Condensation) -> PathCounts {
    let m = cond.members.len();
    let mut exact = true;
    let mut into = vec![0u128; m];
    let mut out = vec![0u128; m];
    for &s in &cond.sources {
        into[s] = 1;
    }
    // Predecessor lists computed once – a reverse scan per component keeps
    // the DP at O(V+E) overall.
    let mut preds: Vec<Vec<usize>> = vec![Vec::new(); m];
    for (p, row) in cond.dag.iter().enumerate() {
        for &b in row {
            preds[b].push(p);
        }
    }
    // A source's into stays 1 – it has no predecessors, but the loop below
    // must not overwrite the seed with an empty-pred 0.
    let is_source: Vec<bool> = (0..m).map(|c| cond.sources.contains(&c)).collect();
    for &c in &cond.order {
        if is_source[c] {
            continue;
        }
        let mut v = 0u128;
        for &p in &preds[c] {
            v = v.saturating_add(into[p]);
            if v == u128::MAX {
                exact = false;
            }
        }
        into[c] = v;
    }
    for &c in cond.order.iter().rev() {
        if cond.dag[c].is_empty() {
            out[c] = 1;
            continue;
        }
        let mut v = 0u128;
        for &b in &cond.dag[c] {
            v = v.saturating_add(out[b]);
            if v == u128::MAX {
                exact = false;
            }
        }
        out[c] = v;
    }
    let mut total = 0u128;
    for &s in &cond.sources {
        sat_add(&mut total, out[s], &mut exact);
    }
    PathCounts { into, out, total, exact }
}

/// Chain flow of a production call edge a→b across a component boundary: how
/// many chains use it, `into[a] · out[b]`. Intra-component (loop-internal)
/// edges carry no flow – a cycle's own edges never leave the loop.
pub fn flow_of(cond: &Condensation, counts: &PathCounts, a: usize, b: usize) -> u128 {
    let (sa, sb) = (cond.scc_of[a], cond.scc_of[b]);
    if sa == sb {
        return 0;
    }
    counts.into[sa].saturating_mul(counts.out[sb])
}

/// Log-scaled flow weight for a symbol edge, `ln(1 + flow)`. An edge no chain
/// uses keeps its base weight, so unreachable code still groups; the cap of
/// 13 nats keeps a saturated total from flattening every other signal.
pub fn flow_weight(cond: &Condensation, counts: &PathCounts, a: usize, b: usize) -> f64 {
    let f = flow_of(cond, counts, a, b);
    if f == 0 {
        return 0.0; // intra-component edge – no chain flow
    }
    let val = f.min(1u128 << 18) as f64; // ln(1 + 2^18) ≈ 12.5
    (1.0 + val).ln().min(13.0)
}

/// The lazy enumeration cursor over all chains. Deterministic DFS over the
/// condensed DAG in symbol-id order: sources in order, each component's
/// children in order, the cursor state being the path's stack of child
/// indices. Resumable – the whole state serialises as plain numbers.
#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)]
pub struct ChainCursor {
    /// Next unvisited source.
    pub src_idx: usize,
    /// Stack of (component, next-child-index) frames.
    pub stack: Vec<(usize, usize)>,
    /// Component path from the current source down to the stack top.
    pub path: Vec<usize>,
}

impl ChainCursor {
    #[allow(dead_code)] // resumable enumeration – used by tests and paging clients
    pub fn new() -> Self {
        ChainCursor { src_idx: 0, stack: Vec::new(), path: Vec::new() }
    }

    /// Advance to some source, or return false when all are spent.
    fn push_next_source(cond: &Condensation, cur: &mut ChainCursor) -> bool {
        if cur.src_idx < cond.sources.len() {
            let s = cond.sources[cur.src_idx];
            cur.src_idx += 1;
            cur.path = vec![s];
            cur.stack = vec![(s, 0)];
            return true;
        }
        false
    }

    /// Next chain as its component path, or None when enumeration is done.
    /// Each call advances the cursor by one DFS step chain.
    pub fn next(cond: &Condensation, cur: &mut ChainCursor) -> Option<Vec<usize>> {
        loop {
            if cur.stack.is_empty() && !Self::push_next_source(cond, cur) {
                return None;
            }
            let (top, ci) = *cur.stack.last().unwrap();
            let children = &cond.dag[top];
            if ci < children.len() {
                cur.stack.last_mut().unwrap().1 = ci + 1;
                let child = children[ci];
                cur.path.push(child);
                cur.stack.push((child, 0));
                if children.is_empty() {
                    // unreachable: children non-empty here
                }
                if cond.dag[child].is_empty() {
                    return Some(cur.path.clone());
                }
            } else {
                cur.stack.pop();
                cur.path.pop();
            }
        }
    }

    /// Serialise the cursor state as a JSON array for resumable enumeration.
    #[allow(dead_code)] // resumable enumeration – used by tests and paging clients
    pub fn to_json(&self) -> String {
        serde_json::json!({ "src": self.src_idx, "stack": self.stack, "path": self.path }).to_string()
    }

    /// Rebuild a cursor from serialised state.
    #[allow(dead_code)]
    pub fn from_json(s: &str) -> Option<ChainCursor> {
        let v: serde_json::Value = serde_json::from_str(s).ok()?;
        Some(ChainCursor {
            src_idx: v.get("src")?.as_u64()? as usize,
            stack: v
                .get("stack")?
                .as_array()?
                .iter()
                .map(|p| {
                    let a = p.as_array()?;
                    Some((a.first()?.as_u64()? as usize, a.get(1)?.as_u64()? as usize))
                })
                .collect::<Option<Vec<_>>>()?,
            path: v.get("path")?.as_array()?.iter().map(|x| x.as_u64().map(|n| n as usize)).collect::<Option<Vec<_>>>()?,
        })
    }
}

/// Expand a component path into symbol ids: a singleton contributes its
/// symbol; a loop node contributes its members in symbol-id order – one pass
/// through the loop, never an unrolled cycle.
pub fn expand_steps(cond: &Condensation, node_ids: &[i64], path: &[usize]) -> Vec<i64> {
    let mut steps = Vec::new();
    for &c in path {
        for &m in &cond.members[c] {
            steps.push(node_ids[m]);
        }
    }
    steps
}

/// Chain family: all chains that share a source and a terminal. The count is
/// exact (u128) unless the path total saturated past u128; min/max length and
/// the blocks a family can cross come from enumerating a bounded sample of
/// its members – the count itself never drops.
#[derive(Debug, Clone, Serialize)]
pub struct ChainFamily {
    pub id: String,
    pub source: i64,
    pub terminal: i64,
    pub count: u128,
    pub exact: bool,
    pub min_len: usize,
    pub max_len: usize,
    pub blocks: Vec<String>,
}

/// Enumerate up to `cap` chains of one (source, terminal) family with a
/// dedicated DFS from the source component, keeping only those that end at
/// the terminal. Used for family block lists and length bounds; the count is
/// never derived from this sample.
fn sample_family(cond: &Condensation, src: usize, terminal: usize, cap: usize) -> Vec<Vec<usize>> {
    let mut found: Vec<Vec<usize>> = Vec::new();
    let mut stack: Vec<(usize, usize)> = vec![(src, 0)];
    let mut path: Vec<usize> = vec![src];
    while let Some(&(top, ci)) = stack.last() {
        if found.len() >= cap {
            break;
        }
        let children = &cond.dag[top];
        if ci < children.len() {
            stack.last_mut().unwrap().1 = ci + 1;
            let child = children[ci];
            path.push(child);
            stack.push((child, 0));
            if child == terminal {
                found.push(path.clone());
                stack.pop();
                path.pop();
            }
        } else {
            stack.pop();
            path.pop();
        }
    }
    found
}

// ----------------------------------------------------------------– assembly

/// Deepest block per symbol, shallowest as fallback – the blocks a chain
/// crosses, in order.
fn block_maps(blocks: &[Block]) -> (HashMap<i64, String>, HashMap<i64, String>) {
    let mut deep: HashMap<i64, String> = HashMap::new();
    let mut any: HashMap<i64, String> = HashMap::new();
    for b in blocks {
        for &s in &b.symbols {
            any.entry(s).or_insert_with(|| b.id.clone());
            if b.children.is_empty() {
                deep.insert(s, b.id.clone());
            }
        }
    }
    (deep, any)
}

/// Blocks crossed by a chain, in order, deduplicated.
fn crossed_blocks(block_of: &impl Fn(i64) -> String, steps: &[i64]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for &s in steps {
        let id = block_of(s);
        if seen.insert(id.clone()) {
            out.push(id);
        }
    }
    out
}

impl Builder<'_> {
    /// Families, loops and the legacy sampled chains from one condensation.
    /// Families get exact u128 counts from per-source path DPs; lengths and
    /// the blocks a family can cross come from a bounded sample of its
    /// members – the count itself is never derived from the sample.
    fn build_all_chains(
        &self,
        cond: &Condensation,
        _counts: &PathCounts,
        _nodes: &[crate::store::Node],
        node_ids: &[i64],
        block_of: &impl Fn(i64) -> String,
    ) -> (Vec<Chain>, Vec<ChainFamily>, Vec<LoopNode>) {
        let loops: Vec<LoopNode> = cond
            .members
            .iter()
            .enumerate()
            .filter(|(c, m)| cond.is_loop[*c] && m.len() > 1)
            .map(|(c, m)| LoopNode { id: format!("l{c}"), members: m.iter().map(|&x| node_ids[x]).collect() })
            .collect();

        // Per-source forward DP: g[u] counts the paths this source reaches u
        // by. Summing the predecessors of each sink gives the exact family
        // count for (source, sink). The predecessor lists are built once
        // here – hoisting them keeps the whole family pass O(S·(V+E)) with
        // O(V+E) setup instead of O(S·(V+E)) matrix rebuilds.
        let sinks: Vec<usize> = (0..cond.members.len()).filter(|&c| cond.dag[c].is_empty()).collect();
        let mut preds: Vec<Vec<usize>> = vec![Vec::new(); cond.members.len()];
        for (p, row) in cond.dag.iter().enumerate() {
            for &b in row {
                preds[b].push(p);
            }
        }
        let mut families: Vec<ChainFamily> = Vec::new();
        for &src in &cond.sources {
            let mut g = vec![0u128; cond.members.len()];
            g[src] = 1;
            let start = cond.order.iter().position(|&c| c == src).unwrap_or(0);
            // Saturation is tracked per source: a family whose own DP never
            // overflows stays exact even when the global total saturated.
            let mut exact = true;
            for &c in &cond.order[start + 1..] {
                let mut v = 0u128;
                for &p in &preds[c] {
                    let (sum, overflow) = v.overflowing_add(g[p]);
                    if overflow {
                        exact = false;
                    }
                    v = if overflow { u128::MAX } else { sum };
                }
                if v > 0 {
                    g[c] = v;
                }
            }
            for &sink in &sinks {
                let mut count = 0u128;
                for &p in &preds[sink] {
                    let (sum, overflow) = count.overflowing_add(g[p]);
                    if overflow {
                        exact = false;
                    }
                    count = if overflow { u128::MAX } else { sum };
                }
                if count == 0 {
                    continue;
                }
                let paths = sample_family(cond, src, sink, FAMILY_BLOCKS_SAMPLE);
                let steps_of = |p: &[usize]| expand_steps(cond, node_ids, p);
                let lens: Vec<usize> = paths.iter().map(|p| steps_of(p).len()).collect();
                let blocks = {
                    let mut seen = std::collections::HashSet::new();
                    let mut out = Vec::new();
                    for p in &paths {
                        for id in crossed_blocks(block_of, &steps_of(p)) {
                            if seen.insert(id.clone()) {
                                out.push(id);
                            }
                        }
                    }
                    out
                };
                families.push(ChainFamily {
                    id: format!("f{}", families.len()),
                    source: node_ids[cond.members[src][0]],
                    terminal: node_ids[cond.members[sink][0]],
                    count,
                    exact,
                    min_len: lens.iter().copied().min().unwrap_or(0),
                    max_len: lens.iter().copied().max().unwrap_or(0),
                    blocks,
                });
            }
        }

        // Legacy sampled chains for the blocks/chains CLI and /api/syntagm.
        let mut cur = ChainCursor::new();
        let mut chains: Vec<Chain> = Vec::new();
        while chains.len() < MAX_SAMPLED_CHAINS {
            let Some(path) = ChainCursor::next(cond, &mut cur) else { break };
            let steps = expand_steps(cond, node_ids, &path);
            if steps.len() < 2 {
                continue;
            }
            chains.push(Chain {
                id: format!("c{}", chains.len()),
                source: node_ids[cond.members[path[0]][0]],
                terminal: *steps.last().unwrap(),
                steps: steps.clone(),
                blocks: crossed_blocks(block_of, &steps),
                len: steps.len(),
            });
        }
        (chains, families, loops)
    }

    /// Block-pair chain flow for /api/map and the fmap readout: the summed
    /// `ln(1 + into · out)` of the production call edges between two blocks.
    pub(crate) fn flow_edges(
        cond: &Condensation,
        counts: &PathCounts,
        edges: &[crate::store::Edge],
        idx: &HashMap<i64, usize>,
        block_of: &impl Fn(i64) -> String,
    ) -> Vec<FlowEdge> {
        let mut pairs: std::collections::BTreeMap<(String, String), f64> = std::collections::BTreeMap::new();
        for e in edges {
            if e.kind != "CALLS" {
                continue;
            }
            let (Some(&a), Some(&b)) = (idx.get(&e.src), idx.get(&e.dst)) else { continue };
            let fw = flow_weight(cond, counts, a, b);
            if fw <= 0.0 {
                continue;
            }
            if cond.scc_of[a] == cond.scc_of[b] {
                continue; // loop-internal edges carry no block-crossing flow
            }
            let (from, to) = (block_of(e.src), block_of(e.dst));
            if from == to {
                continue;
            }
            *pairs.entry((from, to)).or_default() += fw;
        }
        pairs.into_iter().map(|((from, to), weight)| FlowEdge { from, to, weight }).collect()
    }
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
    ensure_schema(store)?;
    store.conn.execute("DELETE FROM syntagm_blocks", [])?;
    store.conn.execute("DELETE FROM syntagm_chains", [])?;
    store.conn.execute("DELETE FROM syntagm_families", [])?;
    store.conn.execute("DELETE FROM syntagm_loops", [])?;
    store.conn.execute("DELETE FROM syntagm_roles", [])?;
    for (i, b) in s.blocks.iter().enumerate() {
        store.conn.execute(
            "INSERT OR REPLACE INTO syntagm_blocks VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
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
                b.role,
                i as i64
            ],
        )?;
    }
    for (i, c) in s.chains.iter().enumerate() {
        store.conn.execute(
            "INSERT OR REPLACE INTO syntagm_chains VALUES (?1,?2,?3,?4,?5,?6,?7)",
            rusqlite::params![
                c.id,
                c.source,
                c.terminal,
                serde_json::to_string(&c.steps)?,
                serde_json::to_string(&c.blocks)?,
                c.len as i64,
                i as i64
            ],
        )?;
    }
    for (i, f) in s.families.iter().enumerate() {
        store.conn.execute(
            "INSERT OR REPLACE INTO syntagm_families VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            rusqlite::params![
                f.id,
                f.source,
                f.terminal,
                f.count.to_string(),
                f.exact as i64,
                f.min_len as i64,
                f.max_len as i64,
                serde_json::to_string(&f.blocks)?,
                i as i64
            ],
        )?;
    }
    for (i, l) in s.loops.iter().enumerate() {
        store.conn.execute(
            "INSERT OR REPLACE INTO syntagm_loops VALUES (?1,?2,?3)",
            rusqlite::params![l.id, serde_json::to_string(&l.members)?, i as i64],
        )?;
    }
    for (node, role) in &s.roles {
        store.conn.execute("INSERT OR REPLACE INTO syntagm_roles VALUES (?1,?2)", rusqlite::params![node, role])?;
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
    ensure_schema(store)?;
    let mut blocks = Vec::new();
    {
        let mut st = store.conn.prepare(
            "SELECT id, parent, depth, kind, name, summary, symbols, children, files, cohesion, source, role FROM syntagm_blocks ORDER BY idx",
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
                role: r.get::<_, Option<String>>(11)?.unwrap_or_else(|| "core".into()),
            })
        })?;
        for b in rows {
            blocks.push(b?);
        }
    }
    if blocks.is_empty() {
        return Ok(None);
    }
    // A map stored before families, loops and roles existed is incomplete –
    // rebuild rather than serve a summary of zeros.
    let fams = store.conn.query_row("SELECT count(*) FROM syntagm_families", [], |r| r.get::<_, i64>(0)).unwrap_or(0);
    let role_rows = store.conn.query_row("SELECT count(*) FROM syntagm_roles", [], |r| r.get::<_, i64>(0)).unwrap_or(0);
    if fams == 0 && role_rows == 0 {
        return Ok(None);
    }
    let mut chains = Vec::new();
    {
        let mut st = store.conn.prepare("SELECT id, entry, terminal, steps, blocks, len FROM syntagm_chains ORDER BY idx")?;
        let rows = st.query_map([], |r| {
            Ok(Chain {
                id: r.get(0)?,
                source: r.get(1)?,
                terminal: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                steps: serde_json::from_str(&r.get::<_, String>(3)?).unwrap_or_default(),
                blocks: serde_json::from_str(&r.get::<_, String>(4)?).unwrap_or_default(),
                len: r.get::<_, i64>(5)? as usize,
            })
        })?;
        for c in rows {
            chains.push(c?);
        }
    }
    let mut families = Vec::new();
    if let Ok(mut st) =
        store.conn.prepare("SELECT id, source, terminal, count, exact, min_len, max_len, blocks FROM syntagm_families ORDER BY idx")
    {
        let rows = st.query_map([], |r| {
            let count_text: String = r.get(3)?;
            Ok(ChainFamily {
                id: r.get(0)?,
                source: r.get(1)?,
                terminal: r.get(2)?,
                count: count_text.parse().unwrap_or(0),
                exact: r.get::<_, i64>(4)? != 0,
                min_len: r.get::<_, i64>(5)? as usize,
                max_len: r.get::<_, i64>(6)? as usize,
                blocks: serde_json::from_str(&r.get::<_, String>(7)?).unwrap_or_default(),
            })
        });
        if let Ok(rows) = rows {
            families.extend(rows.filter_map(|f| f.ok()));
        }
    }
    let mut loops = Vec::new();
    if let Ok(mut st) = store.conn.prepare("SELECT id, members FROM syntagm_loops ORDER BY idx") {
        if let Ok(rows) =
            st.query_map([], |r| Ok(LoopNode { id: r.get(0)?, members: serde_json::from_str(&r.get::<_, String>(1)?).unwrap_or_default() }))
        {
            loops.extend(rows.filter_map(|l| l.ok()));
        }
    }
    let mut roles = BTreeMap::new();
    if let Ok(mut st) = store.conn.prepare("SELECT node, role FROM syntagm_roles") {
        if let Ok(rows) = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))) {
            roles.extend(rows.filter_map(|x| x.ok()));
        }
    }
    // The stored shape keeps the structure; the totals and block-pair flows
    // are recomputed from it – both O(V+E) against the loaded graph.
    let total: u128 = families.iter().map(|f| f.count).sum();
    let exact = families.iter().all(|f| f.exact) && !families.is_empty();
    let flows = if families.is_empty() {
        Vec::new()
    } else {
        let (cond, _node_ids) = graph_condensation(store)?;
        let nodes = store.nodes_where("kind != 'file'", [])?;
        let edges = store.all_edges()?;
        let idx: HashMap<i64, usize> = nodes.iter().enumerate().map(|(i, n)| (n.id, i)).collect();
        let counts = path_counts(&cond);
        let (deep, any) = block_maps(&blocks);
        let block_of = |s: i64| deep.get(&s).cloned().or_else(|| any.get(&s).cloned()).unwrap_or_default();
        Builder::flow_edges(&cond, &counts, &edges, &idx, &block_of)
    };
    Ok(Some(Syntagm {
        blocks,
        chains,
        stats: SyntagmStats { ms: 0, batches: 0, threads: default_threads(), embed: embed_state.into() },
        families,
        loops,
        roles,
        flows,
        value_flows: Vec::new(),
        total,
        exact,
    }))
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
        leaves.insert(
            n.id.to_string(),
            serde_json::json!({
                "name": n.name, "kind": n.kind, "path": n.path, "line": n.start_line,
                "role": s.roles.get(&n.id).cloned().unwrap_or_else(|| "core".into())
            }),
        );
    }
    Ok(serde_json::json!({
        "blocks": s.blocks,
        "families": s.families,
        "loops": s.loops,
        "leaves": leaves,
        "flows": s.flows,
        "stats": {
            "chains": s.total.to_string(),
            "exact": s.exact,
            "ms": s.stats.ms,
            "threads": s.stats.threads,
            "embed": s.stats.embed,
        }
    }))
}

/// The condensation of the production call graph with its symbol ids – the
/// substrate the enumeration cursor walks. O(V+E).
pub fn graph_condensation(store: &Store) -> Result<(Condensation, Vec<i64>)> {
    let nodes = store.nodes_where("kind != 'file'", [])?;
    let edges = store.all_edges()?;
    let idx: HashMap<i64, usize> = nodes.iter().enumerate().map(|(i, n)| (n.id, i)).collect();
    let is_test: Vec<bool> = nodes.iter().map(|x| is_test_path(&x.path)).collect();
    let is_hub: Vec<bool> = nodes.iter().map(|x| is_reexport(&x.path)).collect();
    let mut call_adj: Vec<Vec<usize>> = vec![Vec::new(); nodes.len()];
    for e in &edges {
        if e.kind == "CALLS" {
            if let (Some(&a), Some(&b)) = (idx.get(&e.src), idx.get(&e.dst)) {
                if a != b && !is_test[a] && !is_test[b] && !is_hub[a] && !is_hub[b] {
                    call_adj[a].push(b);
                }
            }
        }
    }
    for row in &mut call_adj {
        row.sort();
        row.dedup();
    }
    let cond = condense(&call_adj);
    let node_ids: Vec<i64> = nodes.iter().map(|n| n.id).collect();
    Ok((cond, node_ids))
}

/// One page of a chain family, lazily enumerated with a resumable cursor.
/// The cursor is the DFS stack of child indices – the same state the
/// `ChainCursor` serialises – pinned to one (source, terminal) family.
pub struct FamilyPage {
    pub chains: Vec<Chain>,
    pub cursor: Option<String>, // None when the family is spent
    pub done: bool,
}

/// Page `limit` chains of the family `family` (`f{index}`, as listed in
/// `/api/map`) starting at `cursor` (None = from the start). The count itself
/// never drops – this only materialises the page that was asked for. The
/// family index is resolved by replaying build_all_chains' deterministic
/// (source, sink) order, stopping as soon as the requested pair is reached.
pub fn chain_family_page(_repo: &Repo, store: &Store, family: &str, cursor: Option<&str>, limit: usize) -> Result<FamilyPage> {
    // Rebuild the condensation – O(V+E), no blocks needed for enumeration.
    let (cond, node_ids) = graph_condensation(store)?;
    // The stored families table holds the id → (source, terminal) mapping
    // from the last full build – a direct lookup, no DP replay.
    let (source, terminal): (i64, i64) = store
        .conn
        .query_row("SELECT source, terminal FROM syntagm_families WHERE id = ?1", [family], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|_| anyhow::anyhow!("no family {family} – the map may have been rebuilt"))?;
    let nodes: Vec<crate::store::Node> = store.nodes_where("kind != 'file'", [])?;
    let idx: HashMap<i64, usize> = nodes.iter().enumerate().map(|(i, n)| (n.id, i)).collect();
    let src_sym = idx.get(&source).ok_or_else(|| anyhow::anyhow!("no symbol {source}"))?;
    let term_sym = idx.get(&terminal).ok_or_else(|| anyhow::anyhow!("no symbol {terminal}"))?;
    let src_c = cond.scc_of[*src_sym];
    let term_c = cond.scc_of[*term_sym];

    // Resumable DFS: the cursor is the stack of (component, next-child) plus
    // the path, exactly as ChainCursor serialises it – pinned to this family.
    let (mut stack, mut path, mut seq) = match cursor {
        Some(s) if !s.is_empty() => {
            let v: serde_json::Value = serde_json::from_str(s)?;
            let st: Vec<(usize, usize)> = v["stack"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|p| {
                            let a = p.as_array()?;
                            Some((a.first()?.as_u64()? as usize, a.get(1)?.as_u64()? as usize))
                        })
                        .collect()
                })
                .unwrap_or_default();
            let p: Vec<usize> =
                v["path"].as_array().map(|a| a.iter().filter_map(|x| x.as_u64().map(|n| n as usize)).collect()).unwrap_or_default();
            let n = v.get("n").and_then(|x| x.as_u64()).unwrap_or(0);
            (st, p, n)
        }
        _ => (vec![(src_c, 0)], vec![src_c], 0u64),
    };
    // The blocks a chain crosses come from the stored map – the deepest block
    // per symbol, shallowest as fallback, exactly as chains are built.
    let block_map: std::collections::HashMap<i64, String> = match load_stored(store, "off")? {
        Some(s) => {
            let (deep, any) = block_maps(&s.blocks);
            deep.into_iter().chain(any).collect()
        }
        None => std::collections::HashMap::new(),
    };
    let block_of = |s: i64| block_map.get(&s).cloned().unwrap_or_default();
    let mut chains: Vec<Chain> = Vec::new();
    while chains.len() < limit {
        let Some(&(top, ci)) = stack.last() else { break };
        let children = &cond.dag[top];
        if ci < children.len() {
            stack.last_mut().unwrap().1 = ci + 1;
            let child = children[ci];
            path.push(child);
            stack.push((child, 0));
            if child == term_c {
                let steps: Vec<i64> = path.iter().flat_map(|&c| cond.members[c].iter().map(|&m| node_ids[m])).collect();
                let source = node_ids[cond.members[src_c][0]];
                let terminal = node_ids[cond.members[term_c][0]];
                let blocks = crossed_blocks(&block_of, &steps);
                chains.push(Chain { id: format!("f{family}-{seq}"), source, terminal, blocks, len: steps.len(), steps });
                seq += 1;
                stack.pop();
                path.pop();
            }
        } else {
            stack.pop();
            path.pop();
        }
    }
    let done = stack.is_empty();
    let next_cursor = if done { None } else { Some(serde_json::json!({ "stack": stack, "path": path, "n": seq }).to_string()) };
    Ok(FamilyPage { chains, cursor: next_cursor, done })
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
            s.chains.iter().filter(|c| ids.contains(&c.source)).collect()
        }
        None => s.chains.iter().collect(),
    };
    println!("{} chains\n", filtered.len());
    for c in filtered.iter().take(60) {
        let entry = store.node(c.source)?.map(|n| n.name).unwrap_or_default();
        let names: Vec<String> = c.steps.iter().take(6).filter_map(|id| store.node(*id).ok().flatten().map(|n| n.name)).collect();
        println!("  ▶ {}  {} steps", entry, c.len);
        println!("      → {}", names.join(", "));
        println!("      blocks: {}", c.blocks.join(" › "));
    }
    Ok(())
}

pub mod embed;
pub mod embed_cache;
pub mod flows;
pub mod flows_name;
#[cfg(test)]
mod tests;
