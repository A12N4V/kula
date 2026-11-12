//! Distinctive names for clusters: tf-idf over identifier words and path
//! segments. Same input always yields the same names.

use super::Cluster;
use std::collections::{BTreeMap, BTreeSet};

const STOP: &[&str] =
    &["the", "and", "for", "with", "from", "into", "self", "new", "get", "set", "let", "mut", "pub", "fn", "use", "src", "lib", "mod", "std", "str", "string", "impl", "node_modules"];

/// One name per cluster, in input order. Top two vocabulary words joined with
/// a space, ties broken alphabetically; collisions get a numeral appended.
pub fn name_clusters(clusters: &[Cluster]) -> Vec<String> {
    let n = clusters.len();
    let docs: Vec<BTreeMap<String, usize>> = clusters.iter().map(vocab).collect();
    let mut df: BTreeMap<String, usize> = BTreeMap::new();
    for d in &docs {
        for w in d.keys() {
            *df.entry(w.clone()).or_default() += 1;
        }
    }
    let mut names = Vec::with_capacity(n);
    for d in &docs {
        let total: usize = d.values().sum();
        let mut scored: Vec<(String, f64)> = d
            .iter()
            .map(|(w, c)| {
                let tf = *c as f64 / total.max(1) as f64;
                let idf = ((n + 1) as f64 / (df.get(w).copied().unwrap_or(0) + 1) as f64).ln();
                (w.clone(), tf * idf)
            })
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(&b.0)));
        names.push(scored.into_iter().map(|(w, _)| w).take(2).collect::<Vec<_>>().join(" "));
    }
    // Names are unique within a repo: append a numeral on collision.
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut out = Vec::with_capacity(n);
    for (i, nm) in names.into_iter().enumerate() {
        let base = if nm.is_empty() { format!("cluster {}", clusters[i].id) } else { nm };
        let mut cand = base.clone();
        let mut k = 1;
        while !seen.insert(cand.clone()) {
            k += 1;
            cand = format!("{base} {k}");
        }
        out.push(cand);
    }
    out
}

/// Words of a cluster: identifier words of its symbols plus path segments.
fn vocab(c: &Cluster) -> BTreeMap<String, usize> {
    let mut m = BTreeMap::new();
    for mem in &c.members {
        for w in crate::store::split_ident(&mem.name).split_whitespace() {
            add(&mut m, w);
        }
        for seg in mem.path.split('/') {
            let seg = match seg.rsplit_once('.') {
                Some((stem, ext)) if !stem.is_empty() && ext.len() <= 4 => stem,
                _ => seg,
            };
            for w in crate::store::split_ident(seg).split_whitespace() {
                add(&mut m, w);
            }
        }
    }
    m
}

fn add(m: &mut BTreeMap<String, usize>, w: &str) {
    if w.len() < 2 || w.chars().all(|c| c.is_ascii_digit()) || STOP.contains(&w) {
        return;
    }
    *m.entry(w.to_string()).or_default() += 1;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cl(id: i64, members: &[(&str, &str)]) -> Cluster {
        Cluster {
            id,
            label: String::new(),
            members: members
                .iter()
                .map(|(name, path)| Node {
                    id: 0,
                    kind: "function".into(),
                    name: name.to_string(),
                    path: path.to_string(),
                    lang: String::new(),
                    start_line: 0,
                    end_line: 0,
                    parent: None,
                    community: id,
                })
                .collect(),
        }
    }

    use crate::store::Node;

    #[test]
    fn names_are_distinctive_and_stable() {
        let cs = vec![
            cl(0, &[("hashToken", "src/util/crypto.ts"), ("salt", "src/util/crypto.ts")]),
            cl(1, &[("enqueue", "worker/queue.py"), ("pushRedis", "worker/queue.py")]),
        ];
        let names = name_clusters(&cs);
        assert_eq!(names.len(), 2);
        assert_ne!(names[0], names[1]);
        assert_eq!(names, name_clusters(&cs));
    }

    #[test]
    fn collision_gets_a_numeral() {
        let cs = vec![cl(0, &[("alpha", "util/alpha.rs")]), cl(1, &[("alpha", "util/alpha.rs")])];
        let names = name_clusters(&cs);
        assert_eq!(names[0], "alpha util");
        assert_eq!(names[1], "alpha util 2");
    }
}
