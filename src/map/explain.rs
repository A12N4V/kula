//! `kula explain`: purpose, public surface, dependencies, dependents, hot spots
//! and anchored memories for a module, file or symbol. Pure and deterministic.

use super::arch;
use super::{clusters, file_of, names, Cluster};
use crate::git::Repo;
use crate::store::{Node, Store};
use anyhow::{anyhow, Result};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct HotSpot {
    pub symbol: String,
    pub fan_in: i64,
    pub score: i64,
}

#[derive(Debug, Serialize)]
pub struct ExplainReport {
    pub schema: u32,
    pub target: String,
    /// module | file | symbol
    pub kind: String,
    pub file: String,
    /// One line: the cluster name this target belongs to.
    pub purpose: String,
    pub surface: Vec<String>,
    pub depends_on: Vec<String>,
    pub used_by: Vec<String>,
    pub hot_spots: Vec<HotSpot>,
    pub memories: Vec<String>,
}

/// Explain a target. Accepts a symbol name, a file path or a module
/// (directory) name or path. Errors with a hint when nothing matches.
pub fn explain(repo: &Repo, db: &Store, target: &str, memories: Vec<String>) -> Result<ExplainReport> {
    // A symbol or file from the index first.
    if let Some(node) = resolve_node(db, target) {
        let kind = if node.kind == "file" { "file".to_string() } else { "symbol".to_string() };
        return symbol_or_file(repo, db, target, node, kind, memories);
    }
    // Then a module: a directory name or path known to the tree.
    let tree = super::tree::module_tree(&repo.root, db);
    let want = |m: &super::tree::TreeNode| m.kind == "module" && (m.path == target || m.name == target || m.path.ends_with(&format!("/{target}")));
    if let Some(p) = tree.packages.iter().find(|p| p.children.iter().any(|m| want(m))) {
        let m = p.children.iter().find(|m| want(m)).unwrap();
        return module_report(repo, db, target, m, memories);
    }
    Err(anyhow!(
        "nothing known as '{target}'; try `kula query {}` for symbols, or a file path, or a directory like src/net",
        target.split(|c: char| !c.is_alphanumeric() && c != '_').next().unwrap_or(target)
    ))
}

fn resolve_node(db: &Store, target: &str) -> Option<Node> {
    let hits = db.resolve(target).ok()?;
    let non_file = hits.iter().find(|n| n.kind != "file").cloned();
    non_file.or_else(|| hits.into_iter().next())
}

fn symbol_or_file(repo: &Repo, db: &Store, _target: &str, node: Node, kind: String, memories: Vec<String>) -> Result<ExplainReport> {
    let nodes = db.nodes_where("id >= 0", []).unwrap_or_default();
    let by_id: HashMap<i64, Node> = nodes.iter().map(|n| (n.id, n.clone())).collect();
    let file = file_of(node.id, &by_id).unwrap_or_else(|| node.path.clone());
    let purpose = cluster_of(db, &node).unwrap_or_else(|| "no cluster".into());

    let (depends_on, used_by) = if kind == "file" {
        let g = arch::file_graph(db);
        (
            g.get(&node.path).map(|s| s.iter().cloned().collect()).unwrap_or_default(),
            g.iter().filter(|(_, v)| v.contains(&node.path)).map(|(k, _)| k.clone()).collect(),
        )
    } else {
        (call_neighbours(db, node.id, true), call_neighbours(db, node.id, false))
    };

    // A symbol is on the public surface when its file declares it pub/export.
    let surface = if kind == "symbol" && is_public(&repo.root.join(&file), &node.name) {
        vec![node.name.clone()]
    } else {
        vec![]
    };
    let fan_in = if kind == "symbol" { db.neighbours(node.id, "CALLS", false).map(|v| v.len() as i64).unwrap_or(0) } else { 0 };
    let hot_spots = if fan_in > 0 { vec![HotSpot { symbol: node.name.clone(), fan_in, score: fan_in }] } else { vec![] };

    Ok(ExplainReport {
        schema: 1,
        target: node.name.clone(),
        kind,
        file,
        purpose,
        surface,
        depends_on,
        used_by,
        hot_spots,
        memories,
    })
}

fn module_report(repo: &Repo, db: &Store, _target: &str, m: &super::tree::TreeNode, memories: Vec<String>) -> Result<ExplainReport> {
    let purpose = module_cluster(db, &m.path).unwrap_or_else(|| format!("module {}", m.name));
    let dir = m.path.clone();

    // Public surface: pub/export declarations in the module's files that name
    // one of its symbols; fall back to every symbol when nothing is public.
    let pubsyms: BTreeSet<String> =
        symbols_of_files(repo, db, &dir).into_iter().filter(|(s, f)| is_public(&repo.root.join(f), s)).map(|(s, _)| s).collect();
    let surface: Vec<String> = if pubsyms.is_empty() { m.symbols.clone() } else { pubsyms.into_iter().collect() };

    let g = arch::module_graph(db).0;
    let depends_on: Vec<String> = g.get(&dir).map(|s| s.iter().cloned().collect()).unwrap_or_default();
    let used_by: Vec<String> = g.iter().filter(|(_, v)| v.contains(&dir)).map(|(k, _)| k.clone()).collect();

    // Hot spots: churn of the module times each symbol's fan_in.
    let mut hot_spots: Vec<HotSpot> = Vec::new();
    if m.churn_30d > 0 {
        let in_deg: BTreeMap<String, i64> = symbol_fan_in(db, &dir);
        for s in &m.symbols {
            let fan_in = *in_deg.get(s).unwrap_or(&0);
            let score = fan_in * m.churn_30d;
            if score > 0 {
                hot_spots.push(HotSpot { symbol: s.clone(), fan_in, score });
            }
        }
        hot_spots.sort_by(|a, b| b.score.cmp(&a.score).then(a.symbol.cmp(&b.symbol)));
        hot_spots.truncate(5);
    }

    Ok(ExplainReport {
        schema: 1,
        target: m.name.clone(),
        kind: "module".into(),
        file: dir,
        purpose,
        surface,
        depends_on,
        used_by,
        hot_spots,
        memories,
    })
}

/// Cluster name for a symbol: the cluster holding it.
fn cluster_of(db: &Store, node: &Node) -> Option<String> {
    let cs = clusters(db);
    let c = cs.iter().find(|c| c.members.iter().any(|m| m.id == node.id))?;
    Some(cluster_name(db, &cs, c))
}

/// Cluster name for a module: the cluster with the most members in that
/// directory.
fn module_cluster(db: &Store, dir: &str) -> Option<String> {
    let cs = clusters(db);
    let best = cs
        .iter()
        .max_by_key(|c| c.members.iter().filter(|m| m.path.starts_with(&format!("{dir}/")) || m.path.starts_with(dir)).count())?;
    let in_dir = best.members.iter().any(|m| m.path.starts_with(dir));
    if !in_dir {
        return None;
    }
    Some(cluster_name(db, &cs, best))
}

fn cluster_name(_db: &Store, cs: &[Cluster], c: &Cluster) -> String {
    let idx = cs.iter().position(|x| x.id == c.id).unwrap_or(0);
    names::name_clusters(cs).get(idx).cloned().unwrap_or_else(|| format!("cluster {}", c.id))
}

fn call_neighbours(db: &Store, id: i64, out: bool) -> Vec<String> {
    let mut v: Vec<String> = db
        .neighbours(id, "CALLS", out)
        .unwrap_or_default()
        .into_iter()
        .map(|(n, _)| n.name)
        .filter(|n| !n.is_empty())
        .collect();
    v.sort();
    v.dedup();
    v
}

fn symbol_fan_in(db: &Store, dir: &str) -> BTreeMap<String, i64> {
    let mut in_deg: BTreeMap<i64, i64> = BTreeMap::new();
    for e in db.all_edges().unwrap_or_default() {
        if e.kind != "CONTAINS" {
            *in_deg.entry(e.dst).or_default() += 1;
        }
    }
    let nodes = db.nodes_where("id >= 0", []).unwrap_or_default();
    let by_id: HashMap<i64, Node> = nodes.iter().map(|n| (n.id, n.clone())).collect();
    let mut out = BTreeMap::new();
    for n in &nodes {
        if n.kind == "file" || n.kind == "package" || n.parent.is_none() {
            continue;
        }
        if let Some(f) = file_of(n.id, &by_id) {
            let d = f.rsplit_once('/').map(|(d, _)| d).unwrap_or(".");
            if d == dir {
                out.insert(n.name.clone(), *in_deg.get(&n.id).unwrap_or(&0));
            }
        }
    }
    out
}

fn symbols_of_files(_repo: &Repo, db: &Store, dir: &str) -> Vec<(String, String)> {
    let nodes = db.nodes_where("id >= 0", []).unwrap_or_default();
    let by_id: HashMap<i64, Node> = nodes.iter().map(|n| (n.id, n.clone())).collect();
    let mut out: BTreeSet<(String, String)> = BTreeSet::new();
    for n in &nodes {
        if n.kind == "file" || n.kind == "package" || n.parent.is_none() {
            continue;
        }
        if let Some(f) = file_of(n.id, &by_id) {
            let d = f.rsplit_once('/').map(|(d, _)| d).unwrap_or(".");
            if d == dir {
                out.insert((n.name.clone(), f));
            }
        }
    }
    out.into_iter().collect()
}

/// True when the file's text marks the name public (rust pub, ts/py export,
/// python dunder main, ts/js export). Missing files are not public.
fn is_public(path: &Path, name: &str) -> bool {
    let Ok(text) = std::fs::read_to_string(path) else { return false };
    for line in text.lines() {
        let t = line.trim_start();
        if !t.contains(name) {
            continue;
        }
        if t.starts_with("pub ") || t.starts_with("pub(") || t.starts_with("export ") {
            return true;
        }
    }
    false
}

/// Render the report as markdown with the fixed section names.
pub fn markdown(r: &ExplainReport) -> String {
    let mut s = String::new();
    s.push_str(&format!("{}: {} ({}, {})\n\n", r.target, r.purpose, r.kind, r.file));
    section(&mut s, "Surface", &r.surface);
    section(&mut s, "Depends on", &r.depends_on);
    section(&mut s, "Used by", &r.used_by);
    if !r.hot_spots.is_empty() {
        let hs: Vec<String> = r.hot_spots.iter().map(|h| format!("{} (fan_in {}, score {})", h.symbol, h.fan_in, h.score)).collect();
        section(&mut s, "Hot spots", &hs);
    }
    section(&mut s, "Memories", &r.memories);
    s
}

fn section(s: &mut String, title: &str, items: &[String]) {
    if items.is_empty() {
        s.push_str(&format!("{title}\nnone\n\n"));
    } else {
        s.push_str(&format!("{title}\n"));
        for i in items {
            s.push_str(&format!("- {i}\n"));
        }
        s.push('\n');
    }
}



#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_checks_pub_and_export() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("a.rs");
        std::fs::write(&f, "pub fn run() {}\nfn hide() {}\n").unwrap();
        assert!(is_public(&f, "run"));
        assert!(!is_public(&f, "hide"));
        let g = d.path().join("b.ts");
        std::fs::write(&g, "export function render() {}\n").unwrap();
        assert!(is_public(&g, "render"));
    }

    #[test]
    fn markdown_has_sections() {
        let r = ExplainReport {
            schema: 1,
            target: "net".into(),
            kind: "module".into(),
            file: "core/src/net".into(),
            purpose: "net ping".into(),
            surface: vec!["pong".into()],
            depends_on: vec![],
            used_by: vec!["core/src".into()],
            hot_spots: vec![],
            memories: vec![],
        };
        let md = markdown(&r);
        for want in ["Surface", "Depends on", "Used by"] {
            assert!(md.contains(want), "missing {want} in:\n{md}");
        }
    }
}
