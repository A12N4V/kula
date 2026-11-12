//! Architecture checks (K2): cycles, god modules, coupling, dead candidates.
//! Pure and deterministic; reads the graph, never the network.

use crate::store::{Node, Store};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};

#[derive(Debug, Serialize)]
pub struct ArchReport {
    pub schema: u32,
    /// Cycles as sorted node-name chains, e.g. `a.rs -> b.rs -> a.rs`.
    pub cycles: Vec<Vec<String>>,
    /// fan_in + fan_out above p95 and loc above 1000.
    pub god_modules: Vec<String>,
    /// Mean of fan_in over modules, normalised to 0..1 by the max fan_in.
    pub coupling: f64,
    /// Symbols with no incoming edges and no entry-point reasons to live.
    pub dead_candidates: Vec<String>,
}

/// File-level dependency graph: file → files it depends on. The seeded-cycle
/// fixture has a→b→a inside one directory, so cycles must be detected per file.
pub fn file_graph(db: &Store) -> BTreeMap<String, BTreeSet<String>> {
    let (_, by_id) = module_graph(db);
    let mut sym_file: HashMap<i64, String> = HashMap::new();
    for n in by_id.values() {
        if n.kind == "file" {
            sym_file.insert(n.id, n.path.clone());
        } else if n.kind != "package" {
            if let Some(f) = sym_file_path(&by_id, n.id) {
                sym_file.insert(n.id, f);
            }
        }
    }
    let file_of = |id: i64| -> Option<String> {
        match by_id.get(&id).map(|n| n.kind.as_str()) {
            Some("file") => by_id.get(&id).map(|n| n.path.clone()),
            Some(_) => sym_file.get(&id).cloned(),
            None => None,
        }
    };
    let mut g: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for e in db.all_edges().unwrap_or_default() {
        if e.kind == "CONTAINS" {
            continue;
        }
        if let (Some(a), Some(b)) = (file_of(e.src), file_of(e.dst)) {
            if a != b {
                g.entry(a).or_default().insert(b);
            }
        }
    }
    g
}

/// Build the module-level dependency graph (directory → directory) the same way
/// the tree does: symbol edges bucketed to their file's directory.
pub fn module_graph(db: &Store) -> (BTreeMap<String, BTreeSet<String>>, HashMap<i64, Node>) {
    let nodes = db.nodes_where("id >= 0", []).unwrap_or_default();
    let mut by_id: HashMap<i64, Node> = HashMap::new();
    for n in &nodes {
        by_id.insert(n.id, n.clone());
    }
    // Walk owner links (class -> method) up to the file.
    let sym_file = |id: i64| -> Option<String> {
        let mut cur = by_id.get(&id)?;
        for _ in 0..8 {
            match cur.parent {
                Some(p) => {
                    let n = by_id.get(&p)?;
                    if n.kind == "file" {
                        return Some(n.path.clone());
                    }
                    cur = n;
                }
                None => return if cur.kind == "file" { Some(cur.path.clone()) } else { None },
            }
        }
        None
    };
    let dir_of = |p: &str| -> String {
        p.rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_else(|| ".".into())
    };
    let bucket = |id: i64| -> Option<String> {
        match by_id.get(&id).map(|n| n.kind.as_str()) {
            Some("file") => by_id.get(&id).map(|n| dir_of(&n.path)),
            Some(_) => sym_file(id).map(|f| dir_of(&f)),
            None => None,
        }
    };
    let mut g: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for e in db.all_edges().unwrap_or_default() {
        if e.kind == "CONTAINS" {
            continue;
        }
        if let (Some(a), Some(b)) = (bucket(e.src), bucket(e.dst)) {
            if a != b {
                g.entry(a).or_default().insert(b);
            }
        }
    }
    (g, by_id)
}

/// Johnson-free cycle detection: depth-first search over the sorted module graph.
/// Deterministic: neighbours visited in sorted order; cycles reported as sorted
/// chains starting at their smallest member. A module appears in at most one
/// reported cycle to keep the output bounded.
pub fn find_cycles(g: &BTreeMap<String, BTreeSet<String>>) -> Vec<Vec<String>> {
    let mut cycles: Vec<Vec<String>> = Vec::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut visited: BTreeSet<String> = BTreeSet::new();
    let mut stack: Vec<String> = Vec::new();
    let mut on_stack: BTreeSet<String> = BTreeSet::new();
    for start in g.keys() {
        if visited.contains(start) {
            continue;
        }
        dfs(start, g, &mut visited, &mut stack, &mut on_stack, &mut cycles, &mut seen);
    }
    cycles.sort();
    cycles.dedup();
    cycles
}

fn dfs(
    u: &str,
    g: &BTreeMap<String, BTreeSet<String>>,
    visited: &mut BTreeSet<String>,
    stack: &mut Vec<String>,
    on_stack: &mut BTreeSet<String>,
    cycles: &mut Vec<Vec<String>>,
    seen: &mut BTreeSet<String>,
) {
    visited.insert(u.to_string());
    stack.push(u.to_string());
    on_stack.insert(u.to_string());
    if let Some(ns) = g.get(u) {
        for v in ns {
            if on_stack.contains(v.as_str()) {
                // Found a cycle: take the stack slice from v's first occurrence.
                let pos = stack.iter().position(|x| x == v).unwrap();
                let mut cyc: Vec<String> = stack[pos..].to_vec();
                cyc.sort();
                let key = cyc.join("->");
                if seen.insert(key) {
                    cycles.push(cyc);
                }
            } else if !visited.contains(v.as_str()) {
                dfs(v, g, visited, stack, on_stack, cycles, seen);
            }
        }
    }
    stack.pop();
    on_stack.remove(u);
}

/// Percentile of a sorted list, linear interpolation.
fn p95(sorted: &[f64]) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let idx = (sorted.len() - 1) as f64 * 0.95;
    let lo = idx.floor() as usize;
    let hi = idx.ceil() as usize;
    let frac = idx - lo as f64;
    sorted[lo] + (sorted[hi] - sorted[lo]) * frac
}

/// God modules: fan_in + fan_out above p95 and loc above 1000.
pub fn god_modules(g: &BTreeMap<String, BTreeSet<String>>, loc: &HashMap<String, usize>) -> Vec<String> {
    let mut fan: BTreeMap<String, f64> = BTreeMap::new();
    for (a, bs) in g {
        *fan.entry(a.clone()).or_default() += bs.len() as f64;
        for b in bs {
            *fan.entry(b.clone()).or_default() += 1.0;
        }
    }
    let mut totals: Vec<f64> = fan.values().copied().collect();
    totals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let thr = p95(&totals);
    let mut out: Vec<String> = fan
        .into_iter()
        .filter(|(m, f)| *f > thr && loc.get(m).copied().unwrap_or(0) > 1000)
        .map(|(m, _)| m)
        .collect();
    out.sort();
    out
}

/// Coupling: mean fan_in over modules, normalised to 0..1 by the max fan_in.
pub fn coupling(g: &BTreeMap<String, BTreeSet<String>>) -> f64 {
    let mut in_deg: BTreeMap<String, usize> = BTreeMap::new();
    for (_, bs) in g {
        for b in bs {
            *in_deg.entry(b.clone()).or_default() += 1;
        }
    }
    let max = in_deg.values().copied().max().unwrap_or(0);
    if max == 0 || in_deg.is_empty() {
        return 0.0;
    }
    let sum: usize = in_deg.values().sum();
    sum as f64 / (in_deg.len() as f64 * max as f64)
}

/// Symbols with no incoming edges and not an entry point.
pub fn dead_candidates(db: &Store, by_id: &HashMap<i64, Node>) -> Vec<String> {
    let mut has_in: BTreeSet<i64> = BTreeSet::new();
    for e in db.all_edges().unwrap_or_default() {
        if e.kind != "CONTAINS" {
            has_in.insert(e.dst);
        }
    }
    let mut out: Vec<String> = Vec::new();
    for n in by_id.values() {
        if n.kind == "file" || n.kind == "package" || n.parent.is_none() {
            continue;
        }
        if has_in.contains(&n.id) {
            continue;
        }
        // Symbols with no incoming edges are candidates only if they look like
        // plain functions or methods; types and tests are usually used by name.
        if n.kind == "function" || n.kind == "method" {
            out.push(n.name.clone());
        }
    }
    out.sort();
    out.dedup();
    out
}

/// Full architecture report.
pub fn check(db: &Store) -> ArchReport {
    let (g, by_id) = module_graph(db);
    // Loc per module: sum of symbol locs in that directory.
    let mut loc: HashMap<String, usize> = HashMap::new();
    for n in by_id.values() {
        if n.kind == "file" || n.kind == "package" {
            continue;
        }
        let file = sym_file_path(&by_id, n.id);
        if let Some(f) = file {
            let dir = f.rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_else(|| ".".into());
            *loc.entry(dir).or_default() += (n.end_line - n.start_line + 1).max(0) as usize;
        }
    }
    ArchReport {
        schema: 1,
        cycles: find_cycles(&file_graph(db)),
        god_modules: god_modules(&g, &loc),
        coupling: coupling(&g),
        dead_candidates: dead_candidates(db, &by_id),
    }
}

/// Walk owner links (class -> method) up to the file path.
fn sym_file_path(by_id: &HashMap<i64, Node>, id: i64) -> Option<String> {
    let mut cur = by_id.get(&id)?;
    for _ in 0..8 {
        match cur.parent {
            Some(p) => {
                let n = by_id.get(&p)?;
                if n.kind == "file" {
                    return Some(n.path.clone());
                }
                cur = n;
            }
            None => return if cur.kind == "file" { Some(cur.path.clone()) } else { None },
        }
    }
    None
}

/// Render the report as markdown lines.
pub fn markdown(r: &ArchReport) -> String {
    let mut s = String::new();
    if r.cycles.is_empty() {
        s.push_str("No cycles.\n");
    } else {
        s.push_str("Cycles:\n");
        for c in &r.cycles {
            s.push_str(&format!("- {}\n", c.join(" -> ")));
        }
    }
    if r.god_modules.is_empty() {
        s.push_str("No god modules.\n");
    } else {
        s.push_str("God modules:\n");
        for m in &r.god_modules {
            s.push_str(&format!("- {m}\n"));
        }
    }
    s.push_str(&format!("Coupling: {:.3}\n", r.coupling));
    if r.dead_candidates.is_empty() {
        s.push_str("No dead candidates.\n");
    } else {
        s.push_str("Dead candidates:\n");
        for d in &r.dead_candidates {
            s.push_str(&format!("- {d}\n"));
        }
    }
    s
}
