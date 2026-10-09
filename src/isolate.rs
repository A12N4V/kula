//! Isolate part of the graph: pick a slice of the codebase by selector and see
//! only it, with its boundary – what calls in, what it calls out – summarised.
//!
//! Selectors (any number, unioned):
//!
//! | selector | picks |
//! |---|---|
//! | `src/auth/**`, `path:src/auth` | files and symbols under a path glob (a bare dir means everything under it) |
//! | `cluster:3`, `cluster:auth` | a cluster by id or label |
//! | `symbol:login`, `login`, `login~2` | a symbol, its members and its N-hop call/import neighbourhood (`~N`, else `hops`) |
//! | `diff:main`, `diff:main..feature` | the symbols a branch touches (plus their files) |
//! | `scope:auth`, `@auth` | a saved `[[scope]]` from kula.toml |
//!
//! A saved scope keeps its selectors and the files they picked; a workflow (or
//! task) can then say `scope = ["@auth"]` and get exactly those files.

use crate::config::{Config, Scope};
use crate::git::Repo;
use crate::store::{Edge, Node, Store};
use anyhow::{bail, Result};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};

/// One node outside the slice that touches it.
#[derive(Serialize, Clone, Debug)]
pub struct Peer {
    pub node: Node,
    /// Edge kinds crossing the boundary (CALLS, IMPORTS, …).
    pub kinds: Vec<String>,
    /// How many edges cross.
    pub edges: usize,
    /// The nodes inside the slice it touches.
    pub inside: Vec<i64>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Counts {
    pub nodes: usize,
    pub files: usize,
    pub internal: usize,
    /// Edges entering the slice / external nodes they come from.
    pub inbound_edges: usize,
    pub inbound: usize,
    pub outbound_edges: usize,
    pub outbound: usize,
}

#[derive(Serialize, Clone, Debug)]
pub struct Slice {
    pub selectors: Vec<String>,
    pub nodes: Vec<Node>,
    /// Edges with both ends inside.
    pub edges: Vec<Edge>,
    /// Edges crossing the boundary (one end inside), for drawing stubs.
    pub boundary: Vec<Edge>,
    /// External callers/importers, most edges first.
    pub inbound: Vec<Peer>,
    /// What the slice uses outside itself, most edges first.
    pub outbound: Vec<Peer>,
    pub files: Vec<String>,
    pub clusters: Vec<String>,
    pub counts: Counts,
}

/// Structural edges never count as a boundary: a file containing a picked
/// symbol is context, not a dependency.
fn crosses(kind: &str) -> bool {
    kind != "CONTAINS"
}

fn looks_like_path(s: &str) -> bool {
    s.contains('/') || s.contains('*') || s.contains('.')
}

fn globset(p: &str) -> Result<globset::GlobSet> {
    let p = p.trim_start_matches("./");
    let mut b = globset::GlobSetBuilder::new();
    b.add(globset::Glob::new(p)?);
    if !p.contains('*') {
        b.add(globset::Glob::new(&format!("{}/**", p.trim_end_matches('/')))?);
    }
    Ok(b.build()?)
}

/// Split `ref~N` into the reference and its hop count.
fn hops_of(s: &str, default: usize) -> (&str, usize) {
    match s.rsplit_once('~') {
        Some((r, n)) if !r.is_empty() => match n.parse() {
            Ok(n) => (r, n),
            Err(_) => (s, default),
        },
        _ => (s, default),
    }
}

/// What every selector reads: the store, the config and the graph in memory.
struct Ctx<'a> {
    repo: &'a Repo,
    st: &'a Store,
    cfg: Config,
    nodes: Vec<Node>,
    /// Undirected neighbours along non-structural edges.
    adj: HashMap<i64, Vec<i64>>,
}

/// Per outside node: edge kinds, edge count, the inside nodes it touches.
type PeerAcc = BTreeMap<i64, (BTreeSet<String>, usize, BTreeSet<i64>)>;

/// The ids one selector picks.
fn pick(cx: &Ctx, sel: &str, hops: usize, depth: usize) -> Result<HashSet<i64>> {
    let (repo, st, cfg, nodes, adj) = (cx.repo, cx.st, &cx.cfg, &cx.nodes, &cx.adj);
    let sel = sel.trim();
    let (kind, arg) = match sel.split_once(':') {
        Some((k, a)) if matches!(k, "path" | "cluster" | "symbol" | "sym" | "diff" | "scope") => (k, a.trim()),
        _ if sel.starts_with('@') => ("scope", &sel[1..]),
        _ if looks_like_path(hops_of(sel, hops).0) && !sel.contains("::") => ("path", sel),
        _ => ("symbol", sel),
    };
    if arg.is_empty() {
        bail!("empty selector {sel:?}");
    }
    let mut out = HashSet::new();
    match kind {
        "path" => {
            let g = globset(arg)?;
            out.extend(nodes.iter().filter(|n| g.is_match(&n.path)).map(|n| n.id));
            if out.is_empty() {
                bail!("nothing in the graph matches the path {arg:?}");
            }
        }
        "cluster" => {
            let cs = st.communities()?;
            let c = match arg.parse::<i64>() {
                Ok(id) => cs.iter().find(|c| c.id == id),
                Err(_) => cs
                    .iter()
                    .find(|c| c.label.eq_ignore_ascii_case(arg))
                    .or_else(|| cs.iter().find(|c| c.label.to_lowercase().contains(&arg.to_lowercase()))),
            };
            let Some(c) = c else { bail!("no cluster {arg:?} – `kula clusters` lists them") };
            out.extend(nodes.iter().filter(|n| n.community == c.id).map(|n| n.id));
        }
        "symbol" | "sym" => {
            let (r, n) = hops_of(arg, hops);
            let root = crate::graph::resolve_one(st, r)?;
            // The symbol and everything it contains, then N hops along calls and imports.
            let mut frontier: VecDeque<(i64, usize)> = VecDeque::new();
            let mut stack = vec![root.id];
            while let Some(id) = stack.pop() {
                if out.insert(id) {
                    frontier.push_back((id, 0));
                    stack.extend(nodes.iter().filter(|m| m.parent == Some(id)).map(|m| m.id));
                }
            }
            while let Some((id, d)) = frontier.pop_front() {
                if d >= n {
                    continue;
                }
                for &m in adj.get(&id).map(Vec::as_slice).unwrap_or(&[]) {
                    if out.insert(m) {
                        frontier.push_back((m, d + 1));
                    }
                }
            }
        }
        "diff" => {
            let (base, head) = match arg.split_once("..") {
                Some((b, h)) => (b.to_string(), h.trim_start_matches('.').to_string()),
                None => (arg.to_string(), repo.branch()),
            };
            for (_status, path, ranges) in repo.changed_ranges(&base, &head)? {
                for n in nodes.iter().filter(|n| n.path == path) {
                    let hit = n.kind == "file" || ranges.iter().any(|(a, b)| (*a as i64) <= n.end_line && (*b as i64) >= n.start_line);
                    if hit {
                        out.insert(n.id);
                    }
                }
            }
        }
        "scope" => {
            if depth > 4 {
                bail!("scope {arg:?} refers to itself");
            }
            let Some(s) = cfg.scopes.iter().find(|s| s.name == arg) else {
                bail!("no saved scope {arg:?} – `kula graph scopes` lists them")
            };
            for x in &s.select {
                out.extend(pick(cx, x, hops, depth + 1)?);
            }
        }
        _ => unreachable!(),
    }
    Ok(out)
}

/// Extract the slice the selectors pick. `hops` is the default neighbourhood
/// for symbol selectors without `~N`.
pub fn isolate(repo: &Repo, st: &Store, selectors: &[String], hops: usize) -> Result<Slice> {
    let selectors: Vec<String> = selectors.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    if selectors.is_empty() {
        bail!("give a selector: a path glob, cluster:<id|label>, symbol:<name>[~hops], diff:<base>[..head] or @<scope>");
    }
    let all_edges = st.all_edges()?;
    let mut adj: HashMap<i64, Vec<i64>> = HashMap::new();
    for e in all_edges.iter().filter(|e| crosses(&e.kind)) {
        adj.entry(e.src).or_default().push(e.dst);
        adj.entry(e.dst).or_default().push(e.src);
    }
    let cx = Ctx { repo, st, cfg: Config::load(&repo.root).unwrap_or_default(), nodes: st.nodes_where("lang != '' ORDER BY id", [])?, adj };
    let mut ids = HashSet::new();
    for s in &selectors {
        ids.extend(pick(&cx, s, hops, 0)?);
    }
    Ok(build(selectors, &cx.nodes, &all_edges, &ids, &st.communities()?))
}

fn build(selectors: Vec<String>, nodes: &[Node], edges: &[Edge], ids: &HashSet<i64>, communities: &[crate::store::Community]) -> Slice {
    let by_id: HashMap<i64, &Node> = nodes.iter().map(|n| (n.id, n)).collect();
    let mut internal = Vec::new();
    let mut boundary = Vec::new();
    let mut peers: [PeerAcc; 2] = Default::default();
    for e in edges {
        let (a, b) = (ids.contains(&e.src), ids.contains(&e.dst));
        match (a, b) {
            (true, true) => internal.push(e.clone()),
            (false, true) | (true, false) if crosses(&e.kind) => {
                let (side, outside, inside) = if b { (0, e.src, e.dst) } else { (1, e.dst, e.src) };
                if !by_id.contains_key(&outside) {
                    continue;
                }
                boundary.push(e.clone());
                let p = peers[side].entry(outside).or_default();
                p.0.insert(e.kind.clone());
                p.1 += 1;
                p.2.insert(inside);
            }
            _ => {}
        }
    }
    let peer_list = |m: &PeerAcc| {
        let mut v: Vec<Peer> = m
            .iter()
            .map(|(id, (k, n, ins))| Peer {
                node: by_id[id].clone(),
                kinds: k.iter().cloned().collect(),
                edges: *n,
                inside: ins.iter().copied().collect(),
            })
            .collect();
        v.sort_by(|a, b| b.edges.cmp(&a.edges).then(a.node.path.cmp(&b.node.path)).then(a.node.name.cmp(&b.node.name)));
        v
    };
    let (inbound, outbound) = (peer_list(&peers[0]), peer_list(&peers[1]));
    let picked: Vec<Node> = nodes.iter().filter(|n| ids.contains(&n.id)).cloned().collect();
    let files: Vec<String> =
        picked.iter().filter(|n| n.kind != "package").map(|n| n.path.clone()).collect::<BTreeSet<_>>().into_iter().collect();
    let cl: BTreeSet<i64> = picked.iter().map(|n| n.community).collect();
    let clusters = communities.iter().filter(|c| cl.contains(&c.id)).map(|c| c.label.clone()).collect();
    let counts = Counts {
        nodes: picked.len(),
        files: files.len(),
        internal: internal.len(),
        inbound_edges: inbound.iter().map(|p| p.edges).sum(),
        inbound: inbound.len(),
        outbound_edges: outbound.iter().map(|p| p.edges).sum(),
        outbound: outbound.len(),
    };
    Slice { selectors, nodes: picked, edges: internal, boundary, inbound, outbound, files, clusters, counts }
}

/// Save a named scope: the selectors and the files they pick today.
pub fn save(repo: &Repo, st: &Store, name: &str, about: &str, selectors: &[String], hops: usize) -> Result<(Scope, Slice)> {
    let slice = isolate(repo, st, selectors, hops)?;
    let scope =
        Scope { name: name.trim().into(), about: about.trim().into(), select: slice.selectors.clone(), hops, paths: slice.files.clone() };
    let mut cfg = Config::load(&repo.root)?;
    cfg.scopes.retain(|s| s.name != scope.name);
    cfg.scopes.push(scope.clone());
    crate::config::set_scopes(&repo.root, &cfg.scopes)?;
    Ok((scope, slice))
}

pub fn remove(repo: &Repo, name: &str) -> Result<bool> {
    let mut cfg = Config::load(&repo.root)?;
    let before = cfg.scopes.len();
    cfg.scopes.retain(|s| s.name != name);
    if cfg.scopes.len() == before {
        return Ok(false);
    }
    crate::config::set_scopes(&repo.root, &cfg.scopes)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n(id: i64, path: &str, name: &str) -> Node {
        Node {
            id,
            kind: "function".into(),
            name: name.into(),
            path: path.into(),
            lang: "rust".into(),
            start_line: 1,
            end_line: 2,
            parent: None,
            community: 0,
        }
    }
    fn e(src: i64, dst: i64, kind: &str) -> Edge {
        Edge { src, dst, kind: kind.into(), weight: 1.0 }
    }

    #[test]
    fn boundary_counts_in_and_out_and_skips_contains() {
        let nodes = vec![n(1, "a.rs", "a1"), n(2, "a.rs", "a2"), n(3, "b.rs", "b1"), n(4, "c.rs", "c1")];
        let edges = vec![e(1, 2, "CALLS"), e(3, 1, "CALLS"), e(3, 2, "CALLS"), e(2, 4, "CALLS"), e(4, 1, "CONTAINS")];
        let ids: HashSet<i64> = [1, 2].into();
        let s = build(vec!["a.rs".into()], &nodes, &edges, &ids, &[]);
        assert_eq!(s.counts.nodes, 2);
        assert_eq!(s.counts.internal, 1);
        assert_eq!((s.counts.inbound, s.counts.inbound_edges), (1, 2));
        assert_eq!((s.counts.outbound, s.counts.outbound_edges), (1, 1));
        assert_eq!(s.inbound[0].node.name, "b1");
        assert_eq!(s.inbound[0].inside, vec![1, 2]);
        assert_eq!(s.boundary.len(), 3);
        assert_eq!(s.files, vec!["a.rs"]);
    }

    #[test]
    fn hop_suffix() {
        assert_eq!(hops_of("login~2", 1), ("login", 2));
        assert_eq!(hops_of("login", 1), ("login", 1));
        assert_eq!(hops_of("~/x", 1), ("~/x", 1));
    }
}
