//! SCIP edge source (`index.scip`), when one is present.
//!
//! SCIP is a protobuf format, but the fields we need are a tiny subset of
//! `scip.proto`: `Index{documents}`, `Document{relative_path, occurrences}`,
//! `Occurrence{range, symbol, symbol_roles}`. Reading it with a hand-rolled
//! varint walker keeps the binary free of protobuf codegen. An `index.scip`
//! from `scip-clang` or friends knows exactly which call binds where, so its
//! edges outrank the resolver ladder and name guesses alike: per (src, dst)
//! the best source wins, and disagreements with weaker sources are counted.

use crate::store::Edge;

use std::collections::HashMap;

/// One definition or reference the SCIP index saw in a file.
struct Occ {
    /// 0-based line of the occurrence.
    line: u32,
    symbol: String,
    is_def: bool,
}

/// Parsed `index.scip`: definitions and references per file.
pub struct ScipIndex {
    /// path → occurrences (in file order).
    docs: HashMap<String, Vec<Occ>>,
}

fn varint(b: &[u8], mut i: usize) -> (u64, usize) {
    let mut v: u64 = 0;
    let mut shift = 0;
    while i < b.len() {
        let byte = b[i];
        i += 1;
        v |= ((byte & 0x7f) as u64) << shift;
        if byte & 0x80 == 0 {
            break;
        }
        shift += 7;
    }
    (v, i)
}

fn fields(b: &[u8]) -> Vec<(u32, (u64, usize))> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let (tag, next) = varint(b, i);
        i = next;
        let num = (tag >> 3) as u32;
        match tag & 7 {
            0 => {
                let (v, next) = varint(b, i);
                i = next;
                out.push((num, (v, usize::MAX)));
            }
            2 => {
                let (len, next) = varint(b, i);
                out.push((num, (len, next)));
                i = next + len as usize;
            }
            _ => break,
        }
    }
    out
}

fn str_of(b: &[u8], f: &(u64, usize)) -> String {
    let (len, at) = *f;
    String::from_utf8_lossy(b.get(at..at + len as usize).unwrap_or_default()).into_owned()
}

/// Load `index.scip` from the repo root (or `.kula/index.scip`). `None` when
/// there is none or it does not parse – the resolver ladder simply runs alone.
pub fn load(root: &std::path::Path) -> Option<ScipIndex> {
    let bytes = std::fs::read(root.join("index.scip")).or_else(|_| std::fs::read(root.join(".kula/index.scip"))).ok()?;
    parse_bytes(&bytes)
}

fn parse_bytes(bytes: &[u8]) -> Option<ScipIndex> {
    if bytes.first() != Some(&0x0a) {
        return None; // not an Index message; refuse to guess
    }
    let bytes = bytes;
    let mut docs = HashMap::new();
    for (num, f) in fields(&bytes) {
        if num != 2 {
            continue;
        }
        let (len, at) = f;
        let doc = &bytes[at..at + len as usize];
        let mut path = String::new();
        let mut occs: Vec<Occ> = Vec::new();
        for (num, f) in fields(doc) {
            match num {
                2 => path = str_of(doc, &f),
                4 => {
                    let (len, at) = f;
                    let occ = &doc[at..at + len as usize];
                    let mut line = 0u32;
                    let mut symbol = String::new();
                    let mut roles = 0u64;
                    for (num, f) in fields(occ) {
                        match num {
                            1 => {
                                // packed repeated int32 range: first varint is the line
                                let (len, at) = f;
                                if len > 0 {
                                    let (v, _) = varint(occ, at);
                                    line = v as u32;
                                }
                            }
                            2 => symbol = str_of(occ, &f),
                            3 => roles = f.0,
                            _ => {}
                        }
                    }
                    occs.push(Occ { line, symbol, is_def: roles & 1 == 1 });
                }
                _ => {}
            }
        }
        if !path.is_empty() {
            docs.insert(path, occs);
        }
    }
    Some(ScipIndex { docs })
}

/// A source's rank: SCIP beats the resolver ladder beats the 1/k name guess.
pub fn source_rank(source: &str) -> u8 {
    match source {
        "scip" => 3,
        "resolver" => 2,
        _ => 1, // "name"
    }
}

/// Apply SCIP knowledge to freshly linked edges. Every SCIP call edge the
/// index can pin to a caller and a definition lands as `resolved` with source
/// `scip`; where it disagrees with a weaker edge the stronger source wins and
/// the disagreement is counted. Returns (edges, disagreement count).
pub fn apply(mut scip: ScipIndex, nodes: &[crate::store::Node], mut edges: Vec<Edge>) -> (Vec<Edge>, usize) {
    // Def nodes per path, by start line, plus their spans for caller lookup.
    let mut defs_by_path: HashMap<&str, Vec<(u32, u32, i64)>> = HashMap::new();
    for n in nodes {
        if matches!(n.kind.as_str(), "function" | "method") {
            defs_by_path.entry(n.path.as_str()).or_default().push((n.start_line as u32, n.end_line as u32, n.id));
        }
    }
    for v in defs_by_path.values_mut() {
        v.sort_unstable();
    }
    // def line → symbol string, from SCIP's own definition occurrences.
    let mut def_symbol: HashMap<(&str, u32), &str> = HashMap::new();
    for (path, occs) in &scip.docs {
        for o in occs {
            if o.is_def {
                def_symbol.insert((path.as_str(), o.line), o.symbol.as_str());
            }
        }
    }
    // Symbol → node id.
    let mut node_of_symbol: HashMap<&str, i64> = HashMap::new();
    for (path, occs) in &scip.docs {
        let Some(spans) = defs_by_path.get(path.as_str()) else { continue };
        for o in occs {
            if !o.is_def {
                continue;
            }
            if let Some(&(_, _, id)) = spans.iter().find(|(s, e, _)| o.line + 1 >= *s && o.line + 1 <= *e) {
                node_of_symbol.insert(o.symbol.as_str(), id);
            }
        }
    }
    // Call sites: reference occurrence → caller def (smallest span containing
    // the line) → callee node by symbol.
    let mut wanted: HashMap<(i64, i64), ()> = HashMap::new();
    let mut conflicts = 0usize;
    for (path, occs) in &scip.docs {
        let Some(spans) = defs_by_path.get(path.as_str()) else { continue };
        for o in occs {
            if o.is_def {
                continue;
            }
            let Some(&dst) = node_of_symbol.get(o.symbol.as_str()) else { continue };
            let caller = spans
                .iter()
                .filter(|(s, e, _)| o.line + 1 >= *s && o.line + 1 <= *e)
                .min_by_key(|(s, e, _)| e - s)
                .map(|(_, _, id)| *id);
            let Some(src) = caller else { continue };
            if src != dst {
                wanted.insert((src, dst), ());
            }
        }
    }
    // Best source wins per (src, dst, kind); a SCIP edge demotes anything
    // weaker and every demotion is a disagreement.
    let mut seen: HashMap<(i64, i64, String), usize> = HashMap::new();
    for (i, e) in edges.iter().enumerate() {
        seen.entry((e.src, e.dst, e.kind.clone())).or_insert(i);
    }
    for &(src, dst) in wanted.keys() {
        let key = (src, dst, "CALLS".to_string());
        match seen.get(&key) {
            Some(&i) if source_rank(&edges[i].source) < source_rank("scip") => {
                conflicts += 1;
                edges[i].source = "scip".into();
                edges[i].confidence = "resolved".into();
                edges[i].weight = 1.0;
            }
            Some(_) => {}
            None => {
                seen.insert(key, edges.len());
                edges.push(Edge { src, dst, kind: "CALLS".into(), weight: 1.0, confidence: "resolved".into(), source: "scip".into() });
            }
        }
    }
    (edges, conflicts)
}

/// Minimal SCIP writer for tests and fixtures: enough of the format to round
/// trip a set of (file, def-line, symbol, call-line) facts.
#[cfg(test)]
pub(crate) fn encode(doc_path: &str, occs: &[(u32, &str, bool)]) -> Vec<u8> {
    fn tag(field: u32, wire: u32) -> Vec<u8> {
        let mut t = field << 3 | wire;
        let mut out = Vec::new();
        while t > 0x7f {
            out.push((t & 0x7f) as u8 | 0x80);
            t >>= 7;
        }
        out.push(t as u8);
        out
    }
    fn len(bytes: &[u8]) -> Vec<u8> {
        let mut l = bytes.len() as u64;
        let mut out = Vec::new();
        while l > 0x7f {
            out.push((l & 0x7f) as u8 | 0x80);
            l >>= 7;
        }
        out.push(l as u8);
        out
    }
    fn msg(field: u32, body: &[u8]) -> Vec<u8> {
        let mut out = tag(field, 2);
        out.extend(len(body));
        out.extend_from_slice(body);
        out
    }
    fn varint(field: u32, v: u64) -> Vec<u8> {
        let mut out = tag(field, 0);
        let mut v = v;
        loop {
            let b = (v & 0x7f) as u8;
            v >>= 7;
            if v == 0 {
                out.push(b);
                break;
            }
            out.push(b | 0x80);
        }
        out
    }
    let mut doc = tag(2, 2);
    doc.extend(len(doc_path.as_bytes()));
    doc.extend_from_slice(doc_path.as_bytes());
    for (line, symbol, is_def) in occs {
        let mut occ = Vec::new();
        // packed range: [start_line, start_char, end_line, end_char]
        let mut range = Vec::new();
        for v in [*line as u64, 0, *line as u64, 120] {
            let mut b = varint(0, v);
            b.remove(0); // strip the inner tag; ranges are a packed field
            range.extend(b);
        }
        occ.extend(tag(1, 2));
        occ.extend(len(&range));
        occ.extend(range);
        occ.extend(msg(2, symbol.as_bytes()));
        if *is_def {
            occ.extend(varint(3, 1));
        }
        doc.extend(msg(4, &occ));
    }
    msg(2, &doc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_what_encode_writes() {
        let bytes = encode("src/a.rs", &[(2, "scip-rs a::f.", true), (9, "scip-rs a::f.", false), (9, "scip-rs a::g.", false)]);
        let idx = load_from_bytes(&bytes).expect("parses");
        let occs = &idx.docs["src/a.rs"];
        assert_eq!(occs.len(), 3);
        assert!(occs[0].is_def && !occs[1].is_def);
        assert_eq!(occs[2].symbol, "scip-rs a::g.");
    }

    #[test]
    fn load_delegates() {
        let bytes = encode("src/b.rs", &[(0, "scip-rs b::h.", true)]);
        assert!(load_from_bytes(&bytes).is_some());
    }

    pub(crate) fn load_from_bytes(bytes: &[u8]) -> Option<ScipIndex> {
        parse_bytes(bytes)
    }
}
