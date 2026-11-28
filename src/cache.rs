//! Mtime-keyed response cache.
//!
//! Some endpoints scan many small files (skills, research json, kula.toml,
//! agent connections) on every poll. This module fingerprints the inputs by
//! `(mtime, size)` and only rebuilds the payload when the fingerprint moves,
//! so an unchanged repository answers from memory. Mutating actions write to
//! the very paths listed here, so the fingerprint moves by itself.

use anyhow::Result;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// One fingerprint entry per cache key.
static CACHE: Mutex<Option<HashMap<String, Cached>>> = Mutex::new(None);

struct Cached {
    fingerprint: Vec<(PathBuf, u64, u64, i64)>,
    value: Value,
}

/// Directories we fingerprint recursively (capped), each with its own depth cap.
const DIRS: &[&str] = &[".kula", ".agents", ".claude", ".cursor", ".gemini", ".codex", ".github/workflows"];
const FILES: &[&str] = &[
    "kula.toml",
    ".mcp.json",
    ".kula-ci.yml",
    // agent docs at the root (the Docs tab edits these)
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    // what `stack` reads
    "Cargo.toml",
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "go.mod",
    "Makefile",
];

/// `(mtime micros, content hash, size)` of one path; missing files as (0, 0, 0).
///
/// Git refs are 41-byte sha files on a filesystem whose mtime may only carry
/// seconds, so a ref written in the same second as the previous poll looks
/// unchanged by mtime and size alone – the content hash closes that hole for
/// small files. Larger files (graph.db) keep mtime and size only.
const HASH_LIMIT: u64 = 8192;

fn stamp(p: &Path) -> (u64, u64, i64) {
    match std::fs::metadata(p) {
        Ok(m) => {
            let mtime =
                m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_micros() as u64).unwrap_or(0);
            let size = m.len().try_into().unwrap_or(i64::MAX);
            let mut hash = mtime;
            if m.len() <= HASH_LIMIT {
                use std::hash::{Hash, Hasher};
                if let Ok(bytes) = std::fs::read(p) {
                    let mut h = std::collections::hash_map::DefaultHasher::new();
                    bytes.hash(&mut h);
                    hash = mtime ^ h.finish().rotate_left(32);
                }
            }
            (mtime, hash, size)
        }
        Err(_) => (0, 0, 0),
    }
}

/// The git dirs of `root`: the worktree git dir (HEAD, index) and the shared
/// common dir (refs, packed-refs, logs). Resolved once per root and memoised –
/// a worktree's `.git` is a file pointing into the main checkout, so watching
/// `<root>/.git` would miss every ref update.
fn git_dirs(root: &Path) -> Vec<PathBuf> {
    static RESOLVED: std::sync::OnceLock<Mutex<HashMap<PathBuf, Vec<PathBuf>>>> = std::sync::OnceLock::new();
    let mut map = RESOLVED.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap();
    map.entry(root.to_path_buf()).or_insert_with(|| resolve_git_dirs(root)).clone()
}

fn resolve_git_dirs(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for args in [["rev-parse", "--absolute-git-dir"], ["rev-parse", "--git-common-dir"]] {
        let Ok(o) = std::process::Command::new("git").arg("-C").arg(root).args(args).output() else { return out };
        let p = std::path::absolute(std::str::from_utf8(&o.stdout).unwrap_or_default().trim()).unwrap_or_default();
        if !p.as_os_str().is_empty() && p.is_dir() {
            out.push(p);
        }
    }
    out
}

/// Fingerprint: one stamp per watched file, recursive stamps inside each
/// watched directory (capped), and the git dirs' control files and refs.
fn fingerprint(root: &Path) -> Vec<(PathBuf, u64, u64, i64)> {
    let mut out = Vec::new();
    for f in FILES {
        let p = root.join(f);
        let (mtime, hash, size) = stamp(&p);
        out.push((p, mtime, hash, size));
    }
    for d in DIRS {
        let dir = root.join(d);
        walk(&dir, &mut out, 0);
    }
    for g in git_dirs(root) {
        for f in ["HEAD", "index", "packed-refs"] {
            let p = g.join(f);
            let (mtime, hash, size) = stamp(&p);
            out.push((p, mtime, hash, size));
        }
        walk(&g.join("refs"), &mut out, 0);
        // `kula hook install` writes here; agents_info reports it
        walk(&g.join("hooks"), &mut out, 0);
    }
    out
}

/// Cap: per directory 2000 entries and 3 levels deep – enough for skills,
/// research runs and refs, cheap to compute on every poll.
const MAX_ENTRIES: usize = 2000;
const MAX_DEPTH: u8 = 3;

fn walk(dir: &Path, out: &mut Vec<(PathBuf, u64, u64, i64)>, depth: u8) {
    if depth > MAX_DEPTH || out.len() >= MAX_ENTRIES {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, out, depth + 1);
        } else {
            let (mtime, hash, size) = stamp(&p);
            out.push((p, mtime, hash, size));
        }
        if out.len() >= MAX_ENTRIES {
            return;
        }
    }
}

/// Forget everything. The server calls this on every write request, so a
/// change made through the UI never waits on a file stamp to show up.
pub fn clear() {
    if let Some(map) = CACHE.lock().unwrap().as_mut() {
        map.clear();
    }
}

/// Answer `build()` from cache while the fingerprint of `root`'s watched paths
/// is unchanged; otherwise rebuild and remember. The key separates callers.
pub fn cached<F>(key: &str, root: &Path, build: F) -> Result<Value>
where
    F: FnOnce() -> Result<Value>,
{
    let fp = fingerprint(root);
    let mut guard = CACHE.lock().unwrap();
    let map = guard.get_or_insert_with(HashMap::new);
    let hit = map.get(key).filter(|hit| hit.fingerprint == fp).map(|hit| hit.value.clone());
    if let Some(v) = hit {
        return Ok(v);
    }
    let value = build()?;
    map.insert(key.to_string(), Cached { fingerprint: fp, value: value.clone() });
    // Cap: keep the last few keys, enough for the endpoints that use this now.
    if map.len() > 8 {
        let oldest = map.keys().next().cloned();
        if let Some(k) = oldest {
            map.remove(&k);
        }
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reuses_and_rebuilds_on_change() {
        let dir = std::env::temp_dir().join(format!("kula-cache-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".agents")).unwrap();
        std::fs::write(dir.join("kula.toml"), "x = 1\n").unwrap();
        let n = std::cell::Cell::new(0u32);
        let build = || {
            n.set(n.get() + 1);
            Ok(serde_json::json!({ "n": n.get() }))
        };
        let a = cached("t", &dir, build).unwrap();
        let b = cached("t", &dir, build).unwrap();
        assert_eq!(a["n"], 1, "first call builds");
        assert_eq!(b["n"], 1, "second call is cached");
        // Touch an input: same stamp unless mtime moved – force it with a write.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        std::fs::write(dir.join("kula.toml"), "x = 2\n").unwrap();
        let c = cached("t", &dir, build).unwrap();
        assert_eq!(c["n"], 2, "changed input rebuilds");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

// ---------------------------------------------------------------------------
// Parse cache – keyed by (git blob oid, grammar version).
//
// Reindexing the same commit re-parses every file even though tree-sitter
// output depends only on (source bytes, grammar). The git index already holds
// each tracked file's blob oid, so we read oids with `git ls-files -s` (no
// hashing of tracked files) and parse only cache misses. Untracked files fall
// back to an FNV of their contents as the oid stand-in. The cached value is a
// JSON mirror of everything the graph builder consumes from a parse, so a
// warm build is byte-identical to a cold one.
// ---------------------------------------------------------------------------

/// Bump when the tree-sitter queries or `parse_source` change shape.
pub const GRAMMAR_VERSION: u32 = 1;

/// Everything the graph builder consumes from one parsed file.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct CachedParse {
    pub path: String,
    pub lang: String,
    pub loc: u32,
    pub defs: Vec<CachedDef>,
    pub calls: Vec<(String, usize)>,
    pub self_calls: HashSet<usize>,
    pub imports: Vec<String>,
    pub import_bindings: Vec<crate::index::resolve::ImportBinding>,
    pub receivers: HashMap<usize, String>,
    pub var_types: HashMap<String, String>,
    pub interfaces: Vec<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct CachedDef {
    pub name: String,
    pub kind: String,
    pub start_line: u32,
    pub end_line: u32,
    pub start_byte: usize,
    pub end_byte: usize,
    pub parent_name: Option<String>,
    pub hash: u64,
}

/// The blob oid of every tracked file whose worktree copy is clean, straight
/// from the git index – no content hashing. Dirty (modified, unmerged, staged
/// differently) and untracked paths are simply absent: `parse_one_cached` then
/// falls back to a content FNV, so a worktree edit can never be served the
/// committed file's cached parse.
pub fn blob_oids(root: &Path) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Ok(o) = std::process::Command::new("git").arg("-C").arg(root).args(["ls-files", "-s", "-z"]).output() else {
        return out;
    };
    for rec in o.stdout.split(|b| *b == 0) {
        let s = std::str::from_utf8(rec).unwrap_or_default();
        // "mode oid stage\0path" – ls-files -s is "mode oid stage\tpath" per record.
        let Some((meta, path)) = s.split_once('\t') else { continue };
        let Some(oid) = meta.split_whitespace().nth(1) else { continue };
        out.insert(path.to_string(), oid.to_string());
    }
    // Drop every path git reports as dirty; those keys would claim the cached
    // parse of the committed blob for content that has since changed.
    if let Ok(st) =
        std::process::Command::new("git").arg("-C").arg(root).args(["status", "--porcelain", "-z", "--untracked-files"]).output()
    {
        for rec in st.stdout.split(|b| *b == 0) {
            let s = std::str::from_utf8(rec).unwrap_or_default();
            if s.len() < 4 {
                continue;
            }
            out.remove(&s[3..]);
            // Rename records are "XY new\0old\0": the old path is dirty too.
            if s.starts_with('R') {
                if let Some((new, old)) = s[3..].split_once('\0') {
                    out.remove(new);
                    out.remove(old);
                }
            }
        }
    }
    out
}

/// FNV-1a of the contents, for files the git index does not track.
pub fn content_oid(content: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in content.as_bytes() {
        h = (h ^ *b as u64).wrapping_mul(0x100000001b3);
    }
    format!("u{h:016x}")
}

/// Persistent parse cache in `.kula/pcache.db`. Open failures fall back to an
/// in-memory cache so indexing never breaks because of the cache.
pub struct ParseCache {
    conn: Option<std::sync::Mutex<Connection>>,
    pub hits: std::sync::atomic::AtomicU64,
    pub misses: std::sync::atomic::AtomicU64,
}

impl ParseCache {
    pub fn open(root: &Path) -> ParseCache {
        let conn = root
            .join(".kula")
            .pipe(|dir| std::fs::create_dir_all(&dir).ok().map(|_| dir))
            .and_then(|dir| Connection::open(dir.join("pcache.db")).ok())
            .and_then(|c| {
                c.execute_batch(
                    "CREATE TABLE IF NOT EXISTS pcache(key TEXT PRIMARY KEY, value BLOB);
                     PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;",
                )
                .ok()
                .map(|_| c)
            });
        if let Some(c) = &conn {
            // Cap: keep the newest entries when the cache outgrows ~40k parses.
            if let Ok(n) = c.query_row("SELECT count(*) FROM pcache", [], |r| r.get::<_, i64>(0)) {
                if n > 40_000 {
                    let _ =
                        c.execute("DELETE FROM pcache WHERE rowid IN (SELECT rowid FROM pcache ORDER BY rowid LIMIT ?1)", [(n - 40_000)]);
                }
            }
        }
        ParseCache { conn: conn.map(std::sync::Mutex::new), hits: Default::default(), misses: Default::default() }
    }

    fn key(oid: &str, lang: &str) -> String {
        format!("{}:{}:{}", GRAMMAR_VERSION, lang, oid)
    }

    pub fn get(&self, oid: &str, lang: &str) -> Option<CachedParse> {
        let conn = self.conn.as_ref()?.lock().ok()?;
        let row = conn.query_row("SELECT value FROM pcache WHERE key = ?1", [Self::key(oid, lang)], |r| r.get::<_, Vec<u8>>(0)).ok()?;
        self.hits.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        serde_json::from_slice(&row).ok()
    }

    pub fn put(&self, oid: &str, lang: &str, v: &CachedParse) {
        let Ok(bytes) = serde_json::to_vec(v) else { return };
        if let Some(c) = &self.conn {
            if let Ok(c) = c.lock() {
                let _ = c.execute("INSERT OR REPLACE INTO pcache VALUES (?1, ?2)", params![Self::key(oid, lang), bytes]);
            }
        }
        self.misses.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
}

// rusqlite is not a dependency of cache.rs today; it is of the crate.
use rusqlite::{params, Connection};

/// Small pipe helper for the optional-open chain above.
trait Pipe: Sized {
    fn pipe<T>(self, f: impl FnOnce(Self) -> T) -> T {
        f(self)
    }
}
impl<T> Pipe for T {}

#[cfg(test)]
mod pcache_tests {
    use super::*;

    #[test]
    fn round_trips_cached_parse() {
        let dir = std::env::temp_dir().join(format!("kula-pcache-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let c = ParseCache::open(&dir);
        let v = CachedParse {
            path: "a.rs".into(),
            lang: "rust".into(),
            loc: 12,
            defs: vec![CachedDef {
                name: "f".into(),
                kind: "function".into(),
                start_line: 1,
                end_line: 3,
                start_byte: 0,
                end_byte: 9,
                parent_name: None,
                hash: 42,
            }],
            calls: vec![("g".into(), 5)],
            self_calls: HashSet::new(),
            imports: vec!["std::io".into()],
            import_bindings: vec![],
            receivers: HashMap::new(),
            var_types: HashMap::new(),
            interfaces: vec![],
        };
        c.put("abc", "rust", &v);
        let back = c.get("abc", "rust").expect("hit after put");
        assert_eq!(back.defs[0].hash, 42);
        assert!(c.get("other", "rust").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
