//! Blast radius: the files that depend on a set of files, from the graph. The
//! plan records each slice's expected radius; the gate notes changes that reach
//! further.

use crate::graph::impact;
use crate::store::Store;
use std::collections::BTreeSet;

/// How many call hops the radius follows.
pub const DEPTH: usize = 3;

/// Files that (transitively) depend on any of `files`, leaving `files` out.
pub fn radius(st: &Store, files: &[String]) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for f in files {
        let nodes = st.nodes_where("kind = 'file' AND path = ?1", [f.as_str()]).unwrap_or_default();
        for n in nodes {
            if let Ok(imp) = impact(st, n.id, true, DEPTH) {
                out.extend(imp.hits.into_iter().map(|h| h.node.path).filter(|p| !p.is_empty()));
            }
        }
    }
    for f in files {
        out.remove(f);
    }
    out
}

/// Files a scope covers, from the indexed file list.
pub fn scope_files(st: &Store, scope: &[String]) -> Vec<String> {
    st.nodes_where("kind = 'file' ORDER BY path", [])
        .unwrap_or_default()
        .into_iter()
        .map(|n| n.path)
        .filter(|p| super::task::in_scope(p, scope))
        .collect()
}

/// Radius files outside both the slice's scope and its expected radius.
pub fn beyond(actual: &BTreeSet<String>, expected: &[String], scope: &[String]) -> Vec<String> {
    actual.iter().filter(|f| !expected.contains(f) && !super::task::in_scope(f, scope)).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn beyond_skips_expected_and_scope() {
        let actual: BTreeSet<String> = ["a/x.rs", "b/y.rs", "c/z.rs"].iter().map(|s| s.to_string()).collect();
        let got = beyond(&actual, &["b/y.rs".into()], &["a".into()]);
        assert_eq!(got, vec!["c/z.rs".to_string()]);
    }
}
