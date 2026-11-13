//! Label propagation communities and their labels.

use crate::store::{Community, Edge, Node};
use std::collections::{BTreeMap, HashMap, HashSet};

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
