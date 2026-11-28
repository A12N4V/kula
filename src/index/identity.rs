//! Symbol identity and relinking across indexes.
//!
//! A symbol is identified by the triple (path, name, bodyhash). Two symbols
//! are the same when any two of the three match – a moved-and-renamed function
//! whose body is unchanged is still the same symbol, and so is a renamed file
//! with the same function. B3 uses this to make fences follow moves: the map
//! of old-symbol → new-symbol survives a reindex.

use std::collections::HashMap;

/// FNV-1a, stable across runs and platforms (same constant as the index).
fn fnv(b: &[u8]) -> u64 {
    b.iter().fold(0xcbf29ce484222325u64, |h, x| (h ^ *x as u64).wrapping_mul(0x100000001b3))
}

/// Stable identity for one symbol: a hash of its (path, name, bodyhash)
/// triple. Two indexes that both know the triple agree on the id without
/// sharing state.
pub fn symbol_id(path: &str, name: &str, bodyhash: u64) -> String {
    let mut h = fnv(path.as_bytes());
    h = (h ^ fnv(name.as_bytes())).wrapping_mul(0x100000001b3);
    h = (h ^ bodyhash).wrapping_mul(0x100000001b3);
    format!("s{h:016x}")
}

/// How many of the three identity parts two symbols share.
fn overlap(path_a: &str, name_a: &str, hash_a: u64, path_b: &str, name_b: &str, hash_b: u64) -> usize {
    [path_a == path_b, name_a == name_b, hash_a == hash_b && hash_a != 0].iter().filter(|m| **m).count()
}

/// Match old symbols to new ones: two of (path, name, bodyhash) must agree.
/// Returns, for each old index, the index of its new counterpart (or `None`).
/// Ambiguity (two new symbols claim the same old one) keeps the first by new
/// index order – deterministic, since inputs are in index order.
pub fn relink(old: &[(String, String, u64)], new: &[(String, String, u64)]) -> Vec<Option<usize>> {
    // Bucket new symbols by each single part, so a two-part match is two
    // bucket lookups instead of a full scan.
    let mut by_path: HashMap<&str, Vec<usize>> = HashMap::new();
    let mut by_name: HashMap<&str, Vec<usize>> = HashMap::new();
    let mut by_hash: HashMap<u64, Vec<usize>> = HashMap::new();
    for (i, (p, n, h)) in new.iter().enumerate() {
        by_path.entry(p.as_str()).or_default().push(i);
        by_name.entry(n.as_str()).or_default().push(i);
        by_hash.entry(*h).or_default().push(i);
    }
    let mut out: Vec<Option<usize>> = Vec::with_capacity(old.len());
    for (op, on, oh) in old {
        let empty: Vec<usize> = Vec::new();
        let pb = by_path.get(op.as_str()).unwrap_or(&empty);
        let nb = by_name.get(on.as_str()).unwrap_or(&empty);
        let hb = by_hash.get(oh).unwrap_or(&empty);
        // Cheap pairs first: path+name is the common exact move case.
        let hit = [[pb, nb], [pb, hb], [nb, hb]].into_iter().find_map(|pair| {
            pair.into_iter().find_map(|bucket| {
                bucket.iter().copied().find(|&i| {
                    let (np, nn, nh) = &new[i];
                    overlap(op, on, *oh, np, nn, *nh) >= 2
                })
            })
        });
        out.push(hit);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_stable_and_distinct() {
        let a = symbol_id("src/a.rs", "f", 7);
        assert_eq!(a, symbol_id("src/a.rs", "f", 7));
        assert_ne!(a, symbol_id("src/a.rs", "f", 8));
        assert_ne!(a, symbol_id("src/a.rs", "g", 7));
        assert_ne!(a, symbol_id("src/b.rs", "f", 7));
    }

    #[test]
    fn relinks_two_of_three() {
        let old = vec![
            ("src/a.rs".into(), "f".into(), 1),
            ("src/a.rs".into(), "g".into(), 2),
            ("src/b.rs".into(), "h".into(), 3),
        ];
        // f moved and was renamed but the body is the same (hash matches);
        // g moved file with the same name; h unchanged.
        let new = vec![
            ("src/c.rs".into(), "renamed".into(), 1),
            ("src/deep/g.rs".into(), "g".into(), 2),
            ("src/b.rs".into(), "h".into(), 3),
        ];
        let m = relink(&old, &new);
        assert_eq!(m, vec![Some(0), Some(1), Some(2)]);
    }

    #[test]
    fn refuses_one_of_three() {
        let old = vec![("src/a.rs".into(), "f".into(), 1)];
        let new = vec![("src/z.rs".into(), "q".into(), 9)];
        assert_eq!(relink(&old, &new), vec![None]);
    }
}
