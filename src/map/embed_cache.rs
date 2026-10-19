//! Content-hash-keyed disk cache for map function embeddings.
//!
//! Key: a 64-bit hash over every input of the vector (name, path, line span,
//! call context, consumed source slice) – see `HashEmbedder::content_hash`.
//! Value: the packed signed 256-bucket count vector. The file lives beside
//! the graph database in the repository's `.kula` directory and is written
//! atomically (temp file + rename) only on flush. Nothing here runs at
//! module load: an idle cache is a zero-cost placeholder until `open`.

use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::git::Repo;

use super::embed::{DIM, STATE};

/// Idle placeholder – used when no repository root is known yet.
pub struct VectorCache {
    inner: Option<Inner>,
}

struct Inner {
    path: PathBuf,
    dirty: AtomicBool,
    map: Mutex<HashMap<u64, [i32; DIM]>>,
}

impl VectorCache {
    /// Open (or prepare) the cache file `<kula_dir>/map-embed-<state>.bin`.
    /// A corrupt or truncated file is discarded wholesale – the vectors are
    /// recomputable, correctness beats completeness.
    pub fn open(repo: &Repo) -> Self {
        let path = repo.kula_dir().join(format!("map-embed-{STATE}.bin"));
        let map = read_file(&path).unwrap_or_default();
        VectorCache { inner: Some(Inner { path, dirty: AtomicBool::new(false), map: Mutex::new(map) }) }
    }

    pub fn get(&self, key: u64) -> Option<[i32; DIM]> {
        let inner = self.inner.as_ref()?;
        inner.map.lock().expect("lock").get(&key).copied()
    }

    pub fn put(&self, key: u64, vec: [i32; DIM]) {
        let Some(inner) = self.inner.as_ref() else { return };
        let mut map = inner.map.lock().expect("lock");
        if map.insert(key, vec).is_none() {
            inner.dirty.store(true, Ordering::Relaxed);
        }
    }

    /// Write the cache out atomically when new vectors were computed.
    /// Deterministic record order (sorted keys) so identical content yields
    /// identical files. A lost write is only a slow rebuild, never a
    /// correctness problem.
    pub fn flush(&self) {
        let Some(inner) = self.inner.as_ref() else { return };
        if !inner.dirty.swap(false, Ordering::Relaxed) {
            return;
        }
        let map = inner.map.lock().expect("lock");
        let mut keys: Vec<&u64> = map.keys().collect();
        keys.sort_unstable();
        let bytes = encode(&keys.iter().map(|k| (**k, map[k])).collect::<Vec<_>>());
        drop(map);
        let tmp = inner.path.with_extension(format!("tmp-{}", std::process::id()));
        if std::fs::write(&tmp, &bytes).is_ok() {
            let _ = std::fs::rename(&tmp, &inner.path);
        }
    }
}

/// Record layout: magic "KME1" + count, then per record key + dim × 2-byte
/// zigzag values. Compact (≈ 520 B per symbol) and trivially parseable.
fn encode(entries: &[(u64, [i32; DIM])]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + entries.len() * (8 + DIM * 2));
    out.extend_from_slice(b"KME1");
    out.extend_from_slice(&(entries.len() as u32).to_le_bytes());
    for (k, v) in entries {
        out.extend_from_slice(&k.to_le_bytes());
        for x in v {
            let z = ((x << 1) ^ (x >> 31)) as u16;
            out.extend_from_slice(&z.to_le_bytes());
        }
    }
    out
}

fn read_file(path: &std::path::Path) -> Option<HashMap<u64, [i32; DIM]>> {
    let mut buf = Vec::new();
    std::fs::File::open(path).ok()?.read_to_end(&mut buf).ok()?;
    decode(&buf)
}

fn decode(buf: &[u8]) -> Option<HashMap<u64, [i32; DIM]>> {
    if buf.len() < 8 || &buf[0..4] != b"KME1" {
        return None;
    }
    let n = u32::from_le_bytes(buf[4..8].try_into().ok()?) as usize;
    let need = 8usize.checked_add(n.checked_mul(8 + DIM * 2)?)?;
    if buf.len() < need {
        return None;
    }
    let mut map = HashMap::with_capacity(n);
    let mut o = 8;
    for _ in 0..n {
        let k = u64::from_le_bytes(buf[o..o + 8].try_into().ok()?);
        o += 8;
        let mut v = [0i32; DIM];
        for slot in v.iter_mut() {
            let z = u16::from_le_bytes(buf[o..o + 2].try_into().ok()?);
            o += 2;
            *slot = ((z >> 1) as i32) ^ (-((z & 1) as i32));
        }
        map.insert(k, v);
    }
    Some(map)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(entries: Vec<(u64, [i32; DIM])>) -> HashMap<u64, [i32; DIM]> {
        let bytes = encode(&entries);
        decode(&bytes).expect("decode")
    }

    #[test]
    fn encode_decode_roundtrips_signed_values() {
        let mut v = [0i32; DIM];
        v[0] = -3;
        v[1] = 7;
        v[255] = -1;
        let back = roundtrip(vec![(0xdead_beef, v)]);
        assert_eq!(back.get(&0xdead_beef).copied(), Some(v));
    }

    #[test]
    fn corrupt_input_is_rejected_not_panicked() {
        assert!(decode(b"").is_none());
        assert!(decode(b"XXXX0000").is_none());
        let bytes = encode(&[]);
        assert!(decode(&bytes[..4]).is_none()); // header only, no count room
        let truncated = &bytes[..3];
        assert!(decode(truncated).is_none());
    }

    #[test]
    fn empty_cache_encodes_and_decodes() {
        assert!(roundtrip(vec![]).is_empty());
    }
}
