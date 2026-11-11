//! Bench metrics: flow recall / precision (member Jaccard ≥ 0.6 = match),
//! name quality, section purity, edge crossings after layout, build time and
//! memory. All comparisons run on tail-qualified member names so repo-root
//! drift cannot punish a correct match.

use serde::Serialize;

/// A produced or gold flow, members as qualified names (`path::fn`).
#[derive(Debug, Clone)]
pub struct Flow {
    pub name: String,
    pub members: Vec<String>,
    pub keywords: Vec<String>,
}

/// Tail-qualify a member: the last path segment plus the symbol name, so
/// `src/map.rs::build_with` and `map.rs::build_with` are the same member.
pub fn tail(member: &str) -> String {
    let (path, name) = match member.rsplit_once("::") {
        Some((p, n)) => (p, n),
        // A bare symbol name: match on the name alone.
        None => return member.to_string(),
    };
    let file = path.rsplit('/').next().unwrap_or(path);
    format!("{file}::{name}")
}

fn member_set(members: &[String]) -> std::collections::BTreeSet<String> {
    members.iter().map(|m| tail(m)).collect()
}

/// Jaccard similarity of two member sets, tail-qualified.
pub fn jaccard(a: &[String], b: &[String]) -> f64 {
    let a = member_set(a);
    let b = member_set(b);
    if a.is_empty() && b.is_empty() {
        return 0.0;
    }
    let inter = a.intersection(&b).count();
    let union = a.union(&b).count();
    if union == 0 {
        return 0.0;
    }
    inter as f64 / union as f64
}

pub const MATCH_THRESHOLD: f64 = 0.6;

#[derive(Debug, Default, Serialize)]
pub struct FlowScores {
    pub gold_flows: usize,
    pub produced_flows: usize,
    pub recall: f64,
    pub precision: f64,
    pub name_score: f64,
}

/// Recall / precision / mean name score over matched pairs.
/// One gold flow can be matched by at most one produced flow (greedy,
/// best-first), so precision is meaningful on dense output.
pub fn flow_scores(prod: &[Flow], gold: &[Flow]) -> FlowScores {
    let mut matched_gold = std::collections::BTreeSet::new();
    let mut matches: Vec<(usize, usize)> = Vec::new();
    // Greedy over all pairs, best Jaccard first – stable and deterministic.
    let mut pairs: Vec<(f64, usize, usize)> = Vec::new();
    for (pi, p) in prod.iter().enumerate() {
        for (gi, g) in gold.iter().enumerate() {
            let j = jaccard(&p.members, &g.members);
            if j >= MATCH_THRESHOLD {
                pairs.push((j, pi, gi));
            }
        }
    }
    pairs.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    let mut used_p = std::collections::BTreeSet::new();
    for (_, pi, gi) in pairs {
        if used_p.insert(pi) && matched_gold.insert(gi) {
            matches.push((pi, gi));
        }
    }
    let mut name_total = 0.0;
    for (pi, gi) in &matches {
        name_total += crate::bench::mapping::names::score(&prod[*pi].name, &gold[*gi].keywords);
    }
    let score = |n: usize, d: usize| if d == 0 { 0.0 } else { n as f64 / d as f64 };
    FlowScores {
        gold_flows: gold.len(),
        produced_flows: prod.len(),
        recall: score(matched_gold.len(), gold.len()),
        precision: score(matches.len(), prod.len()),
        name_score: if matches.is_empty() { 0.0 } else { name_total / matches.len() as f64 },
    }
}

/// Section purity: for each gold flow, the share of its members inside the
/// single section holding the most of them; averaged over gold flows.
/// `blocks` maps a section name to its tail-qualified members.
pub fn section_purity(gold: &[Flow], blocks: &[(String, Vec<String>)]) -> f64 {
    let mut total = 0.0;
    let mut counted = 0;
    for g in gold {
        let set = member_set(&g.members);
        if set.is_empty() {
            continue;
        }
        let mut best = 0usize;
        for (_, members) in blocks {
            let mut seen = std::collections::BTreeSet::new();
            let hits = members.iter().map(|m| tail(m)).filter(|m| set.contains(m) && seen.insert(m.clone())).count();
            let hits = hits.min(set.len());
            best = best.max(hits);
        }
        total += best as f64 / set.len() as f64;
        counted += 1;
    }
    if counted == 0 {
        0.0
    } else {
        total / counted as f64
    }
}

/// Edge crossings after the deterministic baseline layout: blocks sorted by
/// id, each edge a (from, to) pair, crossings counted pairwise. O(E²) – the
/// edge set is block-pair flows, so it stays small.
pub fn edge_crossings(edges: &[(String, String)]) -> usize {
    let rank = |v: &String| v.clone();
    let mut n = 0usize;
    for i in 0..edges.len() {
        for j in (i + 1)..edges.len() {
            let (a1, b1) = (&edges[i].0, &edges[i].1);
            let (a2, b2) = (&edges[j].0, &edges[j].1);
            if a1 == a2 || b1 == b2 || a1 == b2 || b1 == a2 {
                continue; // shared endpoint: no crossing by definition
            }
            let (r1, s1, r2, s2) = (rank(a1), rank(b1), rank(a2), rank(b2));
            if (r1 < r2 && s1 > s2) || (r1 > r2 && s1 < s2) {
                n += 1;
            }
        }
    }
    n
}

/// Peak RSS of this process in KiB (ru_maxrss; macOS reports bytes, Linux KiB).
pub fn peak_rss_kib() -> u64 {
    unsafe {
        let mut ru: libc::rusage = std::mem::zeroed();
        if libc::getrusage(libc::RUSAGE_SELF, &mut ru) != 0 {
            return 0;
        }
        let v = ru.ru_maxrss as u64;
        if cfg!(target_os = "macos") {
            v / 1024
        } else {
            v
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jaccard_thresholds_on_qualified_names() {
        let a = vec!["src/map.rs::build_with".into(), "src/map.rs::compute".into()];
        let b = vec!["map.rs::build_with".into(), "map.rs::compute".into(), "map.rs::load".into()];
        let j = jaccard(&a, &b);
        assert!((j - 2.0 / 3.0).abs() < 1e-9);
        assert!(j >= MATCH_THRESHOLD);
    }

    #[test]
    fn disjoint_members_never_match() {
        let a = vec!["a.rs::one".into()];
        let b = vec!["b.rs::two".into()];
        assert!(jaccard(&a, &b) < MATCH_THRESHOLD);
    }

    #[test]
    fn purity_counts_majority_block() {
        let gold = vec![Flow { name: "n".into(), members: vec!["a.rs::x".into(), "a.rs::y".into(), "b.rs::z".into()], keywords: vec![] }];
        let blocks = vec![
            ("A".into(), vec!["a.rs::x".into(), "a.rs::y".into(), "other.rs::q".into()]),
            ("B".into(), vec!["b.rs::z".into(), "c.rs::w".into()]),
        ];
        let p = section_purity(&gold, &blocks);
        assert!((p - 2.0 / 3.0).abs() < 1e-9);
    }

    #[test]
    fn crossings_count_only_true_overpasses() {
        let edges = vec![("a".to_string(), "d".to_string()), ("b".to_string(), "c".to_string()), ("a".to_string(), "b".to_string())];
        assert_eq!(edge_crossings(&edges), 1);
    }
}
