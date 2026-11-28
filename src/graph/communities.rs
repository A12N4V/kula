//! Communities: Louvain modularity with a connectivity split, and their labels.

use crate::store::{Community, Edge, Node};
use std::collections::{BTreeMap, HashMap, HashSet};

/// Edge weight by kind: calls and containment bind code together, imports less.
fn weight(e: &Edge) -> f64 {
    match e.kind.as_str() {
        "CALLS" => e.weight.max(0.25),
        "CONTAINS" => 1.2,
        "IMPORTS" => 0.6,
        _ => 0.3,
    }
}

type Adj = Vec<Vec<(usize, f64)>>;

/// One Louvain local moving pass to a fixed point: each node joins the
/// neighbouring community with the largest modularity gain. Deterministic:
/// nodes in index order, ties to the lower community id.
fn local_moves(adj: &Adj, comm: &mut [usize]) -> bool {
    let n = adj.len();
    let k: Vec<f64> = adj.iter().map(|a| a.iter().map(|x| x.1).sum()).collect();
    let m2: f64 = k.iter().sum();
    if m2 <= 0.0 {
        return false;
    }
    let mut tot = vec![0.0; n];
    for i in 0..n {
        tot[comm[i]] += k[i];
    }
    let mut moved_any = false;
    let mut w_to: HashMap<usize, f64> = HashMap::new();
    for _pass in 0..32 {
        let mut moved = 0usize;
        for i in 0..n {
            if adj[i].is_empty() {
                continue;
            }
            let own = comm[i];
            w_to.clear();
            for &(j, w) in &adj[i] {
                if j != i {
                    *w_to.entry(comm[j]).or_default() += w;
                }
            }
            tot[own] -= k[i];
            let gain = |c: usize, w: f64| w - tot[c] * k[i] / m2;
            let mut best = (own, gain(own, w_to.get(&own).copied().unwrap_or(0.0)));
            let mut cands: Vec<(usize, f64)> = w_to.iter().map(|(c, w)| (*c, *w)).collect();
            cands.sort_unstable_by_key(|x| x.0);
            for (c, w) in cands {
                let g = gain(c, w);
                if g > best.1 + 1e-12 {
                    best = (c, g);
                }
            }
            tot[best.0] += k[i];
            if best.0 != own {
                comm[i] = best.0;
                moved += 1;
            }
        }
        if moved == 0 {
            break;
        }
        moved_any = true;
    }
    moved_any
}

/// Louvain: local moves, then fold each community into one node and repeat
/// until nothing moves. Returns a community per original node.
fn louvain(adj0: &Adj) -> Vec<usize> {
    let n0 = adj0.len();
    let mut member: Vec<usize> = (0..n0).collect(); // original node → current super node
    let mut adj = adj0.clone();
    for _level in 0..12 {
        let n = adj.len();
        let mut comm: Vec<usize> = (0..n).collect();
        if !local_moves(&adj, &mut comm) {
            break;
        }
        // renumber communities densely in first-seen order
        let mut ids: HashMap<usize, usize> = HashMap::new();
        for c in comm.iter_mut() {
            let next = ids.len();
            *c = *ids.entry(*c).or_insert(next);
        }
        let m = ids.len();
        let mut agg: Vec<BTreeMap<usize, f64>> = vec![BTreeMap::new(); m];
        for (u, a) in adj.iter().enumerate() {
            for &(v, w) in a {
                *agg[comm[u]].entry(comm[v]).or_default() += w;
            }
        }
        adj = agg.into_iter().map(|row| row.into_iter().collect()).collect();
        for s in member.iter_mut() {
            *s = comm[*s];
        }
        if m == n {
            break;
        }
    }
    member
}

/// Split any community that is not connected in the original graph into its
/// components (Leiden's guarantee: every community is one connected piece).
fn split_disconnected(adj: &Adj, comm: &mut [usize]) {
    let n = adj.len();
    let mut next = comm.iter().copied().max().map_or(0, |m| m + 1);
    let mut seen = vec![false; n];
    let mut kept: HashSet<usize> = HashSet::new();
    for s in 0..n {
        if seen[s] {
            continue;
        }
        let c = comm[s];
        let label = if kept.insert(c) {
            c
        } else {
            next += 1;
            next - 1
        };
        let mut stack = vec![s];
        seen[s] = true;
        while let Some(u) = stack.pop() {
            comm[u] = label;
            for &(v, _) in &adj[u] {
                if !seen[v] && comm[v] == c {
                    seen[v] = true;
                    stack.push(v);
                }
            }
        }
    }
}

/// Detect communities and name them. Deterministic for a given graph.
pub fn detect_communities(nodes: &mut [Node], edges: &[Edge]) -> Vec<Community> {
    let n = nodes.len();
    let mut adj: Adj = vec![Vec::new(); n];
    for e in edges {
        let (a, b) = (e.src as usize, e.dst as usize);
        if a < n && b < n && a != b {
            let w = weight(e);
            adj[a].push((b, w));
            adj[b].push((a, w));
        }
    }
    let mut label = louvain(&adj);
    split_disconnected(&adj, &mut label);
    // A node with no edges (a doc, a config, an asset) joins the largest
    // community among connected nodes in its directory, else one per directory,
    // so loose files never count as clusters of their own.
    let dir = |p: &str| p.rsplit_once('/').map_or(String::new(), |(d, _)| d.to_string());
    let mut by_dir: HashMap<String, HashMap<usize, usize>> = HashMap::new();
    for i in 0..n {
        if !adj[i].is_empty() {
            *by_dir.entry(dir(&nodes[i].path)).or_default().entry(label[i]).or_default() += 1;
        }
    }
    let mut loose: HashMap<String, usize> = HashMap::new();
    let mut fresh = label.iter().copied().max().map_or(0, |m| m + 1);
    for i in 0..n {
        if adj[i].is_empty() {
            let d = dir(&nodes[i].path);
            label[i] = match by_dir.get(&d).and_then(|m| m.iter().max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(a.0)))) {
                Some((c, _)) => *c,
                None => *loose.entry(d).or_insert_with(|| {
                    fresh += 1;
                    fresh - 1
                }),
            };
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
    let mut seen: HashSet<String> = HashSet::new();
    for (cid, members) in ordered.iter().enumerate() {
        for &m in members {
            nodes[m].community = cid as i64;
        }
        let mut label = cluster_label(members.iter().map(|&m| &nodes[m]));
        if !seen.insert(label.clone()) {
            let base = label.clone();
            label = (2..).map(|k| format!("{base} {k}")).find(|l| !seen.contains(l)).unwrap_or(base);
            seen.insert(label.clone());
        }
        out.push(Community { id: cid as i64, label, size: members.len() as i64 });
    }
    out
}

/// Name a cluster after where its code lives: the directory and the file
/// holding most members. Dependency, env and other non-code nodes never name
/// it, and tests only when the cluster is all tests. Ties go to the first path.
fn cluster_label<'a>(members: impl Iterator<Item = &'a Node>) -> String {
    const NOT_CODE: &[&str] = &["dependency", "env", "route", "table", "package", "file"];
    let all: Vec<&Node> = members.collect();
    let code: Vec<&Node> = all.iter().copied().filter(|n| !NOT_CODE.contains(&n.kind.as_str()) && !n.path.is_empty()).collect();
    let pool = if code.is_empty() { all.clone() } else { code };
    let src: Vec<&Node> = pool.iter().copied().filter(|n| !crate::agent::is_test_path(&n.path)).collect();
    let pool = if src.is_empty() { pool } else { src };
    let top = |keys: Vec<String>| -> Option<String> {
        let mut c: BTreeMap<String, usize> = BTreeMap::new();
        for k in keys {
            *c.entry(k).or_default() += 1;
        }
        // Highest count; on a tie the alphabetically first key.
        c.into_iter().max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(&a.0))).map(|x| x.0)
    };
    let dir = top(pool.iter().map(|n| n.path.rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_else(|| ".".into())).collect())
        .unwrap_or_default();
    let short = dir.rsplit('/').take(2).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("/");
    let stem = |p: &str| {
        let f = p.rsplit('/').next().unwrap_or(p);
        f.split('.').next().unwrap_or(f).to_string()
    };
    let file = top(pool.iter().map(|n| stem(&n.path)).collect());
    match file {
        Some(f) if all.len() > 3 && !f.is_empty() && f != short.rsplit('/').next().unwrap_or("") => format!("{short} · {f}"),
        _ => short,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: usize, path: &str) -> Node {
        Node {
            id: id as i64,
            kind: "function".into(),
            name: format!("f{id}"),
            path: path.into(),
            lang: "rust".into(),
            start_line: 1,
            end_line: 1,
            parent: None,
            community: 0,
        }
    }

    /// Two dense cliques joined by one weak call, plus a loose file in the first one's directory.
    fn graph() -> (Vec<Node>, Vec<Edge>) {
        let mut nodes: Vec<Node> = (0..5).map(|i| node(i, "a/x.rs")).chain((5..10).map(|i| node(i, "b/y.rs"))).collect();
        nodes.push(Node { kind: "file".into(), ..node(10, "a/README.md") });
        let mut edges = Vec::new();
        for (lo, hi) in [(0, 5), (5, 10)] {
            for i in lo..hi {
                for j in i + 1..hi {
                    edges.push(Edge::new(i as i64, j as i64, "CALLS", 1.0));
                }
            }
        }
        edges.push(Edge::new(4, 5, "CALLS", 0.25));
        (nodes, edges)
    }

    #[test]
    fn cliques_split_and_loose_files_join_their_directory() {
        let (mut nodes, edges) = graph();
        let cs = detect_communities(&mut nodes, &edges);
        assert_eq!(cs.len(), 2, "{cs:?}");
        let a = nodes[0].community;
        assert!(nodes[..5].iter().all(|n| n.community == a));
        assert!(nodes[5..10].iter().all(|n| n.community != a));
        assert_eq!(nodes[10].community, a, "the README sits with the code in its directory");
    }

    #[test]
    fn same_graph_same_communities() {
        let (mut a, edges) = graph();
        let (mut b, _) = graph();
        detect_communities(&mut a, &edges);
        detect_communities(&mut b, &edges);
        assert_eq!(a.iter().map(|n| n.community).collect::<Vec<_>>(), b.iter().map(|n| n.community).collect::<Vec<_>>());
    }

    #[test]
    fn a_disconnected_community_is_split() {
        // a ring of two triangles sharing nothing ends as two communities, never one
        let adj: Adj = vec![vec![(1, 1.0), (2, 1.0)], vec![(0, 1.0), (2, 1.0)], vec![(0, 1.0), (1, 1.0)], vec![(4, 1.0)], vec![(3, 1.0)]];
        let mut comm = vec![0, 0, 0, 0, 0];
        split_disconnected(&adj, &mut comm);
        assert_eq!(comm[0], comm[2]);
        assert_ne!(comm[0], comm[3]);
        assert_eq!(comm[3], comm[4]);
    }
}
