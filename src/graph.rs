//! Graph analysis: communities, context, impact, trace, flows and diff impact.

use crate::git::Repo;
use crate::store::{Community, Edge, Node, Store};
use anyhow::{bail, Result};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

/// Weighted label propagation over the undirected graph. Deterministic.
pub fn detect_communities(nodes: &mut [Node], edges: &[Edge]) -> Vec<Community> {
    let n = nodes.len();
    let mut adj: Vec<Vec<(usize, f64)>> = vec![Vec::new(); n];
    for e in edges {
        let w = match e.kind.as_str() {
            "CALLS" => 1.0 * e.weight.max(0.25),
            "CONTAINS" => 1.2,
            "IMPORTS" => 0.6,
            _ => 0.3,
        };
        let (a, b) = (e.src as usize, e.dst as usize);
        if a < n && b < n {
            adj[a].push((b, w));
            adj[b].push((a, w));
        }
    }
    let mut label: Vec<usize> = (0..n).collect();
    for _round in 0..24 {
        let mut changed = 0;
        for i in 0..n {
            if adj[i].is_empty() {
                continue;
            }
            let mut score: HashMap<usize, f64> = HashMap::new();
            for &(j, w) in &adj[i] {
                *score.entry(label[j]).or_default() += w;
            }
            // Mild self-affinity keeps labels stable.
            *score.entry(label[i]).or_default() += 0.05;
            let best = score
                .into_iter()
                .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap().then(b.0.cmp(&a.0)))
                .map(|x| x.0)
                .unwrap();
            if best != label[i] {
                label[i] = best;
                changed += 1;
            }
        }
        if changed == 0 {
            break;
        }
    }
    // Compact ids ordered by size, and name each after its dominant directory.
    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for (i, l) in label.iter().enumerate() {
        groups.entry(*l).or_default().push(i);
    }
    let mut ordered: Vec<Vec<usize>> = groups.into_values().collect();
    ordered.sort_by(|a, b| b.len().cmp(&a.len()).then(a[0].cmp(&b[0])));
    let mut out = Vec::new();
    for (cid, members) in ordered.iter().enumerate() {
        let mut dirs: BTreeMap<String, usize> = BTreeMap::new();
        let mut names: BTreeMap<String, usize> = BTreeMap::new();
        for &m in members {
            let p = &nodes[m].path;
            let d = p.rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_else(|| ".".into());
            *dirs.entry(d).or_default() += 1;
            if nodes[m].kind == "class" || nodes[m].kind == "file" {
                *names.entry(nodes[m].name.clone()).or_default() += 1;
            }
            nodes[m].community = cid as i64;
        }
        let dir = dirs.into_iter().max_by_key(|x| x.1).map(|x| x.0).unwrap_or_default();
        let short = dir.rsplit('/').take(2).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("/");
        let hub = names.into_iter().max_by_key(|x| x.1).map(|x| x.0);
        let label = match hub {
            Some(h) if members.len() > 3 => format!("{short} · {}", h.split('.').next().unwrap_or(&h)),
            _ => short,
        };
        out.push(Community { id: cid as i64, label, size: members.len() as i64 });
    }
    out
}

#[derive(Serialize)]
pub struct Context {
    pub node: Node,
    pub community: Option<String>,
    pub callers: Vec<Node>,
    pub callees: Vec<Node>,
    pub children: Vec<Node>,
    pub imports: Vec<Node>,
    pub imported_by: Vec<Node>,
    pub container: Option<Node>,
    pub snippet: String,
}

pub fn context(repo: &Repo, store: &Store, id: i64) -> Result<Context> {
    let Some(node) = store.node(id)? else { bail!("no node {id}") };
    let pick = |v: Vec<(Node, f64)>| v.into_iter().map(|x| x.0).collect::<Vec<_>>();
    let callers = pick(store.neighbours(id, "CALLS", false)?);
    let callees = pick(store.neighbours(id, "CALLS", true)?);
    let children = pick(store.neighbours(id, "CONTAINS", true)?);
    let container = store.neighbours(id, "CONTAINS", false)?.into_iter().next().map(|x| x.0);
    let (imports, imported_by) = if node.kind == "file" {
        (pick(store.neighbours(id, "IMPORTS", true)?), pick(store.neighbours(id, "IMPORTS", false)?))
    } else {
        (vec![], vec![])
    };
    let community = store
        .conn
        .query_row("SELECT label FROM communities WHERE id = ?1", [node.community], |r| r.get(0))
        .ok();
    let snippet = read_lines(repo, &node.path, node.start_line, node.end_line.min(node.start_line + 80));
    Ok(Context { node, community, callers, callees, children, imports, imported_by, container, snippet })
}

pub fn read_lines(repo: &Repo, path: &str, start: i64, end: i64) -> String {
    let full = repo.root.join(path);
    // Refuse anything that escapes the repository.
    if path.contains("..") || !full.starts_with(&repo.root) {
        return String::new();
    }
    std::fs::read_to_string(full)
        .map(|s| {
            s.lines()
                .skip((start.max(1) - 1) as usize)
                .take((end - start + 1).max(1) as usize)
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

#[derive(Serialize, Clone)]
pub struct ImpactHit {
    pub node: Node,
    pub depth: usize,
    pub via: Option<i64>,
}

#[derive(Serialize)]
pub struct Impact {
    pub root: Node,
    pub direction: String,
    pub hits: Vec<ImpactHit>,
    pub files: usize,
    pub communities: Vec<String>,
    pub risk: String,
}

/// Blast radius: who (transitively) depends on `id` (upstream) or what it relies on (downstream).
pub fn impact(store: &Store, id: i64, upstream: bool, max_depth: usize) -> Result<Impact> {
    let Some(root) = store.node(id)? else { bail!("no node {id}") };
    let mut seen: HashSet<i64> = HashSet::from([id]);
    let mut q: VecDeque<(i64, usize)> = VecDeque::from([(id, 0)]);
    // A file's impact is the union of its symbols' impact plus its importers.
    if root.kind == "file" {
        for (c, _) in store.neighbours(id, "CONTAINS", true)? {
            seen.insert(c.id);
            q.push_back((c.id, 0));
        }
    }
    let mut hits = Vec::new();
    while let Some((cur, d)) = q.pop_front() {
        if d >= max_depth {
            continue;
        }
        let mut next = store.neighbours(cur, "CALLS", !upstream)?;
        if root.kind == "file" {
            next.extend(store.neighbours(cur, "IMPORTS", !upstream)?);
        }
        for (n, _) in next {
            if seen.insert(n.id) {
                hits.push(ImpactHit { node: n.clone(), depth: d + 1, via: Some(cur) });
                q.push_back((n.id, d + 1));
            }
        }
        if hits.len() > 500 {
            break;
        }
    }
    let files: HashSet<&str> = hits.iter().map(|h| h.node.path.as_str()).collect();
    let comm_ids: HashSet<i64> = hits.iter().map(|h| h.node.community).collect();
    let mut communities = Vec::new();
    for c in comm_ids {
        if let Ok(l) = store.conn.query_row("SELECT label FROM communities WHERE id = ?1", [c], |r| r.get::<_, String>(0)) {
            communities.push(l);
        }
    }
    communities.sort();
    let direct = hits.iter().filter(|h| h.depth == 1).count();
    let risk = match (direct, hits.len(), communities.len()) {
        (_, t, c) if t >= 40 || c >= 5 => "high",
        (d, t, _) if d >= 5 || t >= 12 => "medium",
        (_, 0, _) => "none",
        _ => "low",
    };
    Ok(Impact { root, direction: if upstream { "upstream" } else { "downstream" }.into(), files: files.len(), communities, risk: risk.into(), hits })
}

/// Shortest call path from `a` to `b`.
pub fn trace(store: &Store, a: i64, b: i64) -> Result<Vec<Node>> {
    let mut prev: HashMap<i64, i64> = HashMap::new();
    let mut q = VecDeque::from([a]);
    let mut seen = HashSet::from([a]);
    while let Some(cur) = q.pop_front() {
        if cur == b {
            let mut path = vec![b];
            let mut c = b;
            while let Some(p) = prev.get(&c) {
                path.push(*p);
                c = *p;
            }
            path.reverse();
            return path.into_iter().filter_map(|id| store.node(id).ok().flatten()).map(Ok).collect();
        }
        for (n, _) in store.neighbours(cur, "CALLS", true)? {
            if seen.insert(n.id) {
                prev.insert(n.id, cur);
                q.push_back(n.id);
            }
        }
        if seen.len() > 20_000 {
            break;
        }
    }
    Ok(vec![])
}

#[derive(Serialize)]
pub struct Flow {
    pub entry: Node,
    pub steps: Vec<ImpactHit>,
    pub reach: usize,
}

/// Execution flows: entry points (nothing calls them, they call things) and what they reach.
pub fn flows(store: &Store, limit: usize) -> Result<Vec<Flow>> {
    let entries = store.nodes_where(
        "kind IN ('function','method') AND id NOT IN (SELECT dst FROM edges WHERE kind = 'CALLS')
         AND (SELECT count(*) FROM edges WHERE kind = 'CALLS' AND src = nodes.id) >= 2",
        [],
    )?;
    let mut out = Vec::new();
    for e in entries {
        let imp = impact(store, e.id, false, 4)?;
        out.push(Flow { reach: imp.hits.len(), entry: e, steps: imp.hits.into_iter().take(40).collect() });
    }
    out.sort_by(|a, b| b.reach.cmp(&a.reach).then(a.entry.name.cmp(&b.entry.name)));
    out.truncate(limit);
    Ok(out)
}

#[derive(Serialize)]
pub struct CompareFile {
    pub status: String,
    pub path: String,
    pub symbols: Vec<Node>,
}

#[derive(Serialize)]
pub struct Compare {
    pub base: String,
    pub head: String,
    pub ahead: usize,
    pub behind: usize,
    pub commits: Vec<crate::git::Commit>,
    pub files: Vec<CompareFile>,
    pub touched: usize,
    pub affected: Vec<ImpactHit>,
    pub communities: Vec<String>,
    pub risk: String,
}

/// Branch comparison: git diff + which symbols changed + what they ripple into.
pub fn compare(repo: &Repo, store: Option<&Store>, base: &str, head: &str) -> Result<Compare> {
    let ranges = repo.changed_ranges(base, head)?;
    let (ahead, behind) = repo.ahead_behind(base, head);
    let commits = repo.log(200, Some(&format!("{base}..{head}")))?;
    let mut files = Vec::new();
    let mut touched_ids: Vec<i64> = Vec::new();
    for (status, path, rs) in ranges {
        let mut syms = Vec::new();
        if let Some(st) = store {
            let candidates = st.nodes_where("path = ?1 AND kind != 'file'", [&path])?;
            for n in candidates {
                let hit = rs.iter().any(|(a, b)| (*a as i64) <= n.end_line && (*b as i64) >= n.start_line);
                // Keep the innermost changed symbols (skip a class if a method inside changed).
                if hit {
                    syms.push(n);
                }
            }
            let inner: Vec<Node> = syms
                .iter()
                .filter(|n| !syms.iter().any(|m| m.id != n.id && m.parent == Some(n.id)))
                .cloned()
                .collect();
            syms = inner;
            touched_ids.extend(syms.iter().map(|s| s.id));
        }
        files.push(CompareFile { status, path, symbols: syms });
    }
    let mut affected: Vec<ImpactHit> = Vec::new();
    let mut communities: HashSet<String> = HashSet::new();
    let touched: HashSet<i64> = touched_ids.iter().copied().collect();
    if let Some(st) = store {
        let mut seen = touched.clone();
        for id in &touched_ids {
            let imp = impact(st, *id, true, 3)?;
            communities.extend(imp.communities);
            for h in imp.hits {
                if seen.insert(h.node.id) {
                    affected.push(h);
                }
            }
        }
    }
    affected.sort_by_key(|h| h.depth);
    let mut communities: Vec<String> = communities.into_iter().collect();
    communities.sort();
    let risk = match (touched.len(), affected.len()) {
        (_, a) if a >= 40 => "high",
        (t, a) if t >= 10 || a >= 10 => "medium",
        (0, 0) => "none",
        _ => "low",
    };
    Ok(Compare { base: base.into(), head: head.into(), ahead, behind, commits, files, touched: touched.len(), affected, communities, risk: risk.into() })
}

#[derive(Serialize)]
pub struct GraphExport {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub communities: Vec<Community>,
    pub truncated: bool,
}

/// Graph for the UI. `level` = "symbol" (default) or "file".
pub fn export(store: &Store, level: &str, limit: usize) -> Result<GraphExport> {
    let communities = store.communities()?;
    if level == "file" {
        let nodes = store.nodes_where("kind = 'file' AND lang != '' ORDER BY id", [])?;
        let ids: HashSet<i64> = nodes.iter().map(|n| n.id).collect();
        // Lift symbol calls to file→file dependencies.
        let mut st = store.conn.prepare(
            "SELECT DISTINCT fa.id, fb.id, 'DEPENDS', count(*) FROM edges e
             JOIN nodes a ON a.id = e.src JOIN nodes b ON b.id = e.dst
             JOIN nodes fa ON fa.kind = 'file' AND fa.path = a.path
             JOIN nodes fb ON fb.kind = 'file' AND fb.path = b.path
             WHERE e.kind IN ('CALLS','IMPORTS') AND fa.id != fb.id GROUP BY fa.id, fb.id",
        )?;
        let edges = st
            .query_map([], |r| Ok(Edge { src: r.get(0)?, dst: r.get(1)?, kind: r.get(2)?, weight: r.get::<_, i64>(3)? as f64 }))?
            .filter_map(|e| e.ok())
            .filter(|e| ids.contains(&e.src) && ids.contains(&e.dst))
            .collect();
        return Ok(GraphExport { nodes, edges, communities, truncated: false });
    }
    let total: i64 = store.conn.query_row("SELECT count(*) FROM nodes", [], |r| r.get(0))?;
    // Keep the most connected nodes when the graph is huge.
    let nodes = store.nodes_where(
        "lang != '' ORDER BY (SELECT count(*) FROM edges WHERE src = nodes.id OR dst = nodes.id) DESC, id LIMIT ?1",
        [limit as i64],
    )?;
    let ids: HashSet<i64> = nodes.iter().map(|n| n.id).collect();
    let edges = store.all_edges()?.into_iter().filter(|e| ids.contains(&e.src) && ids.contains(&e.dst)).collect();
    Ok(GraphExport { truncated: (total as usize) > nodes.len(), nodes, edges, communities })
}

/// Pick the single best node for a reference, preferring definitions.
pub fn resolve_one(store: &Store, r: &str) -> Result<Node> {
    let hits = store.resolve(r)?;
    if let Some(h) = hits.first() {
        return Ok(h.clone());
    }
    let s = store.search(r, 1)?;
    s.into_iter().next().ok_or_else(|| anyhow::anyhow!("no symbol matches {r:?}"))
}
