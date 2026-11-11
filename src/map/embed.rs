//! Local, offline, deterministic function embeddings for the map engine.
//!
//! Every symbol gets a 256-dimensional signed count vector built from hashed
//! feature terms: split identifiers (name and path), doc comments, signature
//! tokens and call-context terms (callee and caller names from CALLS edges).
//! No network, no model download – the whole provider is hash-based and
//! reproducible byte-for-byte across runs and platforms (integer bucket
//! accumulation, fixed iteration order, `sqrt` applied per element only).
//!
//! Test code gets a trivial empty vector (`is_test_path`), so it neither
//! spends extraction work nor glues production sections together.
//!
//! Wired as the default `Similarity` at the `build_with` seam: when the
//! caller brings no provider (no cached page-embedding index), the map still
//! gets a deterministic lexical one. Lazily initialised – no threads, no IO
//! at module load.

use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

use crate::git::Repo;
use crate::store::{Edge, Node, Store};

use super::embed_cache::VectorCache;
use super::is_test_path;

/// Hash-vector dimensionality. Small enough to keep 4k+ symbols inside the
/// ≤ 10 s build budget, large enough that collisions stay rare per directory.
pub const DIM: usize = 256;

/// The `embed_state` string this provider maps under. Distinct from "off" and
/// from the page-embedding states so the stored Syntagm is keyed separately.
pub const STATE: &str = "hash-v1";

/// Generic keywords and one-letter noise that carry no thematic signal.
const STOPWORDS: &[&str] = &[
    "pub",
    "fn",
    "func",
    "function",
    "let",
    "mut",
    "var",
    "val",
    "const",
    "impl",
    "self",
    "this",
    "super",
    "mod",
    "use",
    "import",
    "export",
    "from",
    "return",
    "if",
    "else",
    "match",
    "while",
    "for",
    "loop",
    "break",
    "continue",
    "struct",
    "enum",
    "trait",
    "type",
    "class",
    "interface",
    "def",
    "async",
    "await",
    "ref",
    "as",
    "in",
    "is",
    "new",
    "static",
    "where",
    "dyn",
    "move",
    "true",
    "false",
    "none",
    "null",
    "undefined",
    "string",
    "number",
    "int",
    "bool",
    "void",
    "result",
    "option",
    "some",
    "err",
    "error",
    "ok",
    "data",
    "str",
    "usize",
    "i64",
    "u64",
    "f64",
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "then",
    "into",
    "from",
    "out",
    "get",
    "set",
    "tmp",
    "foo",
    "bar",
    "baz",
    "arg",
    "args",
    "param",
    "params",
    "res",
    "ret",
    "item",
    "value",
];

/// FNV-1a 64-bit over the bytes of `s`.
fn hash64(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// Split an identifier into lowercase words: snake_case, kebab-case,
/// camelCase and `::`/`/` separators.
fn split_words(ident: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for ch in ident.chars() {
        if ch.is_alphanumeric() {
            // Word break on a case transition (lower→upper, letter→digit is kept).
            if ch.is_uppercase() && cur.chars().last().is_some_and(|c| c.is_lowercase()) {
                out.push(cur.to_lowercase());
                cur.clear();
            }
            cur.push(ch);
        } else {
            if !cur.is_empty() {
                out.push(cur.to_lowercase());
                cur.clear();
            }
        }
    }
    if !cur.is_empty() {
        out.push(cur.to_lowercase());
    }
    out.retain(|w| w.len() >= 3 && !STOPWORDS.contains(&w.as_str()));
    out
}

/// Comment-marker prefixes that start a doc line, by language family.
fn is_comment_line(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("///")
        || t.starts_with("//!")
        || t.starts_with("/**")
        || t.starts_with("*")
        || t.starts_with("//")
        || t.starts_with("#") && !(t.starts_with("#!") || t.starts_with("#["))
}

/// One symbol's raw feature terms, in insertion order.
fn terms_for(name: &str, src: Option<&str>, start: i64, ctx: &CallCtx) -> Vec<String> {
    let mut terms: Vec<String> = Vec::new();
    // Identifiers from the name. Path/file tokens deliberately excluded:
    // they make same-file functions near-identical regardless of semantics,
    // which floods the seam with noisy same-directory edges.
    for w in split_words(name) {
        terms.push(w);
    }

    // Doc comment lines just above the definition, then the signature (the
    // first two lines). Body tokens deliberately excluded: at hashing
    // dimensionality they dilute the name/doc signal with implementation
    // noise and cost the most extraction time.
    if let Some(text) = src {
        let lines: Vec<&str> = text.lines().collect();
        let n = lines.len() as i64;
        let mut doc_end = (start - 1).min(n);
        let mut doc_start = doc_end;
        while doc_start >= 1 && is_comment_line(lines[(doc_start - 1) as usize]) {
            doc_start -= 1;
        }
        if doc_end > doc_start {
            doc_end = doc_end.min(doc_start + 24);
        }
        let sig_end = start.min(n);
        for line in lines.iter().skip((doc_start.max(1) - 1) as usize).take((doc_end - doc_start.max(1)).max(0) as usize) {
            for w in split_words(line) {
                terms.push(w);
            }
        }
        for line in lines.iter().skip((sig_end.max(1) - 1) as usize).take(((sig_end + 1).min(n) - sig_end.max(1) + 1).max(0) as usize) {
            for w in split_words(line) {
                terms.push(w);
            }
        }
    }
    // Call context: callees carry the most signal, callers less.
    for callee in &ctx.callees {
        for w in split_words(callee) {
            terms.push(w);
        }
    }
    for caller in &ctx.callers {
        for w in split_words(caller) {
            terms.push(w);
        }
    }
    terms
}

/// The signed 256-bucket count vector for a term list. Bucket index and sign
/// both come from `hash64`; accumulation is integer and order-independent.
pub fn vector_for(terms: &[String]) -> [i32; DIM] {
    let mut v = [0i32; DIM];
    for t in terms {
        let h = hash64(t);
        let idx = (h % DIM as u64) as usize;
        if (h >> 63) & 1 == 0 {
            v[idx] += 1;
        } else {
            v[idx] -= 1;
        }
    }
    v
}

/// Cosine similarity of two signed count vectors, clamped to 0..1. Iterates
/// bucket-by-bucket in fixed order, so the float sum is reproducible.
pub fn cosine(a: &[i32; DIM], b: &[i32; DIM]) -> f64 {
    let (mut dot, mut na, mut nb) = (0i64, 0i64, 0i64);
    for i in 0..DIM {
        dot += a[i] as i64 * b[i] as i64;
        na += a[i] as i64 * a[i] as i64;
        nb += b[i] as i64 * b[i] as i64;
    }
    if na == 0 || nb == 0 {
        return 0.0;
    }
    (dot as f64 / ((na as f64).sqrt() * (nb as f64).sqrt())).clamp(0.0, 1.0)
}

#[derive(Default)]
struct CallCtx {
    callees: Vec<String>,
    callers: Vec<String>,
}

/// Per-symbol inputs (everything the content hash is computed over).
struct SymInput {
    name: String,
    path: String,
    start: i64,
    end: i64,
    ctx: CallCtx,
    test: bool,
}

/// The local deterministic `Similarity` provider. Built once per map build at
/// the seam; vectors are computed lazily on first query and memoised.
pub struct HashEmbedder {
    root: std::path::PathBuf,
    syms: BTreeMap<i64, SymInput>,
    file_text: Mutex<HashMap<String, Option<String>>>,
    cache: VectorCache,
    vectors: Mutex<HashMap<i64, [i32; DIM]>>,
}

impl HashEmbedder {
    /// Gather symbol inputs and call context from the store and open the
    /// content-hash cache beside the graph database. Cheap (no file reads,
    /// no hashing) – all heavy work is lazy per query.
    pub fn new(repo: &Repo, store: &Store) -> Option<Self> {
        let nodes: Vec<Node> = store.nodes_where("kind != 'file'", []).ok()?;
        if nodes.is_empty() {
            return None;
        }
        let edges: Vec<Edge> = store.all_edges().ok()?;
        let mut names: HashMap<i64, String> = HashMap::new();
        for n in &nodes {
            names.insert(n.id, n.name.clone());
        }
        let mut ctx: HashMap<i64, CallCtx> = HashMap::new();
        for e in &edges {
            if e.kind != "CALLS" || e.src == e.dst {
                continue;
            }
            if let (Some(sn), Some(dn)) = (names.get(&e.src), names.get(&e.dst)) {
                ctx.entry(e.src).or_default().callees.push(dn.clone());
                ctx.entry(e.dst).or_default().callers.push(sn.clone());
            }
        }
        let mut syms = BTreeMap::new();
        for n in nodes {
            let test = is_test_path(&n.path);
            let entry = ctx.remove(&n.id).unwrap_or_default();
            syms.insert(n.id, SymInput { name: n.name, path: n.path, start: n.start_line, end: n.end_line, ctx: entry, test });
        }
        Some(Self {
            root: repo.root.clone(),
            syms,
            file_text: Mutex::new(HashMap::new()),
            cache: VectorCache::open(repo),
            vectors: Mutex::new(HashMap::new()),
        })
    }

    /// Content hash over every input of the vector: name, path, line span,
    /// call context and a hash of the source slice actually consumed. Two
    /// symbols share a cache key only when all of these agree.
    fn content_hash(&self, id: i64) -> u64 {
        let s = self.syms.get(&id).expect("known symbol");
        if s.test {
            return 0;
        }
        let src = self.source_slice(id);
        let mut acc = String::new();
        acc.push_str(&s.name);
        acc.push('\u{1}');
        acc.push_str(&s.path);
        acc.push('\u{1}');
        acc.push_str(&format!("{}:{}", s.start, s.end));
        for c in &s.ctx.callees {
            acc.push('\u{2}');
            acc.push_str(c);
        }
        for c in &s.ctx.callers {
            acc.push('\u{3}');
            acc.push_str(c);
        }
        acc.push_str(&src);
        hash64(&acc)
    }

    /// The source text slice the features come from, memoised per file. When
    /// the file is unreadable the hash simply covers name/path/context.
    fn source_slice(&self, id: i64) -> String {
        let s = self.syms.get(&id).expect("known symbol");
        let mut texts = self.file_text.lock().expect("lock");
        let text = texts.entry(s.path.clone()).or_insert_with(|| std::fs::read_to_string(self.root.join(&s.path)).ok());
        let Some(text) = text else { return String::new() };
        let lines: Vec<&str> = text.lines().collect();
        let n = lines.len() as i64;
        // Mirror terms_for's window: doc lines above, signature, bounded body.
        let lo = (s.start - 24).max(1);
        let hi = s.start.min(n);
        lines.iter().skip((lo - 1).max(0) as usize).take((hi - lo + 1).max(0) as usize).fold(String::new(), |a, l| a + l)
    }

    fn vector_of(&self, id: i64) -> [i32; DIM] {
        let mut v = self.vectors.lock().expect("lock");
        if let Some(hit) = v.get(&id) {
            return *hit;
        }
        let vec = self.compute(id);
        v.insert(id, vec);
        vec
    }

    /// Compute (or load from the disk cache) one symbol's vector. The disk
    /// cache is consulted before term extraction; misses are written back.
    fn compute(&self, id: i64) -> [i32; DIM] {
        let h = self.content_hash(id);
        let empty = [0i32; DIM];
        if h == 0 {
            return empty; // test code: trivial embedding, no extraction work
        }
        if let Some(hit) = self.cache.get(h) {
            return hit;
        }
        let s = self.syms.get(&id).expect("known symbol");
        let terms = terms_for(&s.name, self.file_text.lock().expect("lock").get(&s.path).and_then(|t| t.as_deref()), s.start, &s.ctx);
        let vec = vector_for(&terms);
        self.cache.put(h, vec);
        vec
    }

    /// Read one symbol's vector directly – a seam for tests and stats.
    #[cfg(test)]
    pub fn vector_of_public(&self, id: i64) -> [i32; DIM] {
        self.vector_of(id)
    }

    /// Persist any newly computed vectors. Cheap to call; a no-op when
    /// nothing changed.
    pub fn flush(&self) {
        self.cache.flush();
    }
}

impl super::Similarity for HashEmbedder {
    fn similarity(&self, a: i64, b: i64) -> f64 {
        cosine(&self.vector_of(a), &self.vector_of(b))
    }
}

impl Drop for HashEmbedder {
    fn drop(&mut self) {
        self.cache.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(terms: &[&str]) -> [i32; DIM] {
        let owned: Vec<String> = terms.iter().map(|t| t.to_string()).collect();
        vector_for(&owned)
    }

    #[test]
    fn split_words_handles_cases_and_filters_noise() {
        assert_eq!(split_words("parse_pedigreeFile"), vec!["parse", "pedigree", "file"]);
        assert_eq!(split_words("httpsClient::maxAge"), vec!["https", "client", "max", "age"]);
        assert!(split_words("get_set_foo").is_empty()); // stopwords only
        assert!(split_words("ab").is_empty()); // too short
    }

    #[test]
    fn identical_terms_give_identical_vectors_and_full_similarity() {
        let a = v(&["pedigree", "decode", "record"]);
        let b = v(&["record", "decode", "pedigree"]); // order must not matter
        assert_eq!(a, b);
        assert_eq!(cosine(&a, &b), 1.0);
    }

    #[test]
    fn disjoint_vectors_score_zero_and_empty_is_safe() {
        let a = v(&["pedigree", "decode"]);
        let b = v(&["renderer", "layout"]);
        assert_eq!(cosine(&a, &b), 0.0);
        assert_eq!(cosine(&a, &[0i32; DIM]), 0.0);
    }

    #[test]
    fn shared_terms_raise_similarity_monotonically() {
        let base = v(&["pedigree", "decode", "graph"]);
        let near = v(&["pedigree", "decode", "graph", "render"]);
        let far = v(&["pedigree", "decode", "graph", "render", "serve", "http", "socket", "listen"]);
        let s_near = cosine(&base, &near);
        let s_far = cosine(&base, &far);
        assert!(s_near > 0.3, "near: {s_near}");
        assert!(s_far > 0.0 && s_far < s_near, "far: {s_far} vs {s_near}");
    }

    #[test]
    fn vector_is_deterministic_across_construction_order() {
        let t1: Vec<String> = (0..500).map(|i| format!("term{i}")).collect();
        let mut t2 = t1.clone();
        t2.reverse();
        assert_eq!(vector_for(&t1), vector_for(&t2));
    }
}
