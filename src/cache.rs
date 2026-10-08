//! Mtime-keyed response cache.
//!
//! Some endpoints scan many small files (skills, research json, kula.toml,
//! agent connections) on every poll. This module fingerprints the inputs by
//! `(mtime, size)` and only rebuilds the payload when the fingerprint moves,
//! so an unchanged repository answers from memory. Mutating actions write to
//! the very paths listed here, so the fingerprint moves by itself.

use anyhow::Result;
use serde_json::Value;
use std::collections::HashMap;
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
const FILES: &[&str] = &["kula.toml", ".mcp.json", ".kula-ci.yml"];

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
