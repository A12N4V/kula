//! E1: PUT /api/file – the editable code panel's write side.
//!
//! The read side lives in `server.rs` (`GET /api/file`, which now returns a
//! `base_hash` – sha256 hex of the file's contents). The panel sends that hash
//! back with its edit; if the file changed on disk since, the write is
//! refused with 409 plus the current text so the panel can offer
//! reload / overwrite.
//!
//! Refusals (400 unless noted): paths outside the repo root, symlink escapes,
//! `.git/` and `.kula/` paths, `kula.toml` (kula's own config is edited in
//! Settings), binary files, files over 1 MB. Writes are atomic (temp file +
//! rename) and keep the file's mode; after a write the file is re-indexed in
//! the background via the same path the hooks and the auto-reindex loop use,
//! so the graph and map reflect the edit.

use anyhow::{anyhow, bail, ensure};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

/// Files over this size are refused – this is a micro-edit panel beside a
/// graph, not a bulk uploader.
pub const MAX_BYTES: usize = 1024 * 1024;

/// sha256 hex of a file's UTF-8 contents. The client computes the same with
/// `crypto.subtle.digest`, so the panel's `base_hash` and the server's agree
/// byte for byte (JSON round-trips keep the string, and valid UTF-8 encodes
/// identically in both).
pub fn hash(text: &str) -> String {
    let mut h = Sha256::new();
    h.update(text.as_bytes());
    let d = h.finalize();
    d.iter().map(|b| format!("{b:02x}")).collect()
}

/// A refusal that maps onto an HTTP status in the handler.
pub struct Refusal {
    pub status: StatusCode,
    pub body: Value,
}

/// The core of the write, HTTP-free so tests can drive it directly.
/// `base_hash` carries what the client loaded; when the target does not exist
/// yet a fresh file is created. Returns the hash of what was written.
pub fn write_checked(root: &Path, path: &str, content: &str, base_hash: Option<&str>) -> Result<String, Refusal> {
    let deny = |status: StatusCode, err: Value| Refusal { status, body: err };
    let bad = |msg: String| deny(StatusCode::BAD_REQUEST, json!({ "error": msg }));
    if let Err(e) = target_of(root, path) {
        return Err(bad(format!("{e:#}")));
    }
    if content.len() > MAX_BYTES {
        return Err(bad(format!("refusing to write: more than {MAX_BYTES} bytes")));
    }
    let target = root.join(path);
    let exists = target.symlink_metadata().is_ok();
    let current = if exists {
        let meta = match std::fs::metadata(&target) {
            Ok(m) => m,
            Err(e) => return Err(bad(format!("cannot read {path}: {e}"))),
        };
        if meta.len() > MAX_BYTES as u64 {
            return Err(bad(format!("refusing to write {path}: it is over {MAX_BYTES} bytes on disk")));
        }
        match std::fs::read(&target) {
            Ok(bytes) if bytes.contains(&0) => return Err(bad(format!("refusing to write {path}: it is a binary file"))),
            Ok(bytes) => match String::from_utf8(bytes) {
                Ok(s) => s,
                Err(_) => return Err(bad(format!("refusing to write {path}: it is not valid UTF-8"))),
            },
            Err(e) => return Err(bad(format!("cannot read {path}: {e}"))),
        }
    } else {
        String::new()
    };
    if let Some(want) = base_hash {
        let have = hash(&current);
        if have != want {
            return Err(deny(
                StatusCode::CONFLICT,
                json!({
                    "error": format!("{path} changed on disk since it was loaded"),
                    "path": path, "current": current, "hash": have,
                }),
            ));
        }
    }
    // Atomic: write a sibling temp file with the old file's mode, rename over.
    // tempfile itself is a dev-only dependency, so the staging name is made
    // here: colliding writers get distinct counters, and a crash at worst
    // leaves a dot-prefixed scratch file behind.
    let parent = target.parent().unwrap_or(root);
    if !parent.exists() {
        std::fs::create_dir_all(parent).map_err(|e| bad(format!("cannot create {path}: {e}")))?;
    }
    let staged = parent.join(format!(".kula-save-{}-{}", std::process::id(), STAGE_SEQ.fetch_add(1, Ordering::Relaxed)));
    if let Err(e) = std::fs::write(&staged, content.as_bytes()) {
        return Err(bad(format!("cannot stage {path}: {e}")));
    }
    if exists {
        if let Ok(meta) = std::fs::metadata(&target) {
            use std::os::unix::fs::{MetadataExt, PermissionsExt};
            let _ = std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(meta.mode() & 0o7777));
        }
    }
    if let Err(e) = std::fs::rename(&staged, &target) {
        let _ = std::fs::remove_file(&staged);
        return Err(bad(format!("cannot write {path}: {e}")));
    }
    Ok(hash(content))
}

static STAGE_SEQ: AtomicU64 = AtomicU64::new(0);

/// Resolve and vet the request path: relative, no `..`, no component that is
/// a symlink out of the root, and none of the always-refused names.
fn target_of(root: &Path, path: &str) -> anyhow::Result<()> {
    ensure!(!path.is_empty(), "send path");
    ensure!(!path.starts_with('/'), "path must be relative to the repository root, got {path}");
    ensure!(!path.split('/').any(|s| s == ".."), "path may not contain ..");
    for seg in path.split('/') {
        ensure!(!matches!(seg, ".git" | ".kula"), "refusing {seg}/ – kula's own data is not editable here");
        ensure!(seg != "kula.toml", "kula.toml is kula's own config – edit it in Settings");
    }
    // Symlink escape: canonicalize the deepest existing ancestor (a new file
    // behind a symlinked directory would slip past canonicalizing the target).
    let can_root = root.canonicalize().map_err(|e| anyhow!("cannot resolve repository root: {e}"))?;
    let mut anc = root.join(path);
    while !anc.exists() {
        match anc.parent().map(Path::to_path_buf) {
            Some(p) => anc = p,
            None => bail!("path must be relative to the repository root, got {path}"),
        }
        if !anc.starts_with(root) {
            bail!("path must be relative to the repository root, got {path}");
        }
    }
    let can = anc.canonicalize().map_err(|e| anyhow!("cannot resolve {path}: {e}"))?;
    ensure!(can.starts_with(&can_root), "path escapes the repository root: {path}");
    Ok(())
}

#[derive(Deserialize)]
pub(crate) struct SaveBody {
    path: String,
    content: String,
    base_hash: Option<String>,
}

/// PUT /api/file – save an edit from the code panel. Token protection comes
/// from the server's guard middleware, which already requires `x-kula-token`
/// on every non-GET `/api/*` request.
pub async fn put(State(s): State<crate::server::AppState>, axum::extract::Json(body): axum::extract::Json<SaveBody>) -> Response {
    let root = s.repo.root.clone();
    let wrote = tokio::task::spawn_blocking(move || write_checked(&root, &body.path, &body.content, body.base_hash.as_deref()))
        .await
        .map_err(|e| anyhow!(e));
    match wrote {
        Ok(Ok(wrote_hash)) => {
            // Re-index in the background so the graph and map see the edit –
            // the same path the hooks and the auto-reindex loop take.
            let repo = s.repo.clone();
            tokio::spawn(async move {
                let r = repo.clone();
                if tokio::task::spawn_blocking(move || crate::index::run(&r, true)).await.is_ok() {
                    crate::map_run::spawn(repo, true);
                }
            });
            (StatusCode::OK, axum::Json(json!({ "ok": true, "hash": wrote_hash }))).into_response()
        }
        Ok(Err(refusal)) => (refusal.status, axum::Json(refusal.body)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, axum::Json(json!({ "error": format!("{e:#}") }))).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn tmp_repo() -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir_all(d.path().join("src")).unwrap();
        fs::write(d.path().join("src/a.txt"), "one\ntwo\n").unwrap();
        let root = d.path().to_path_buf();
        (d, root)
    }

    fn saved(root: &Path, path: &str, content: &str, base: Option<&str>) -> String {
        write_checked(root, path, content, base).unwrap_or_else(|r| panic!("refused: {}", r.body))
    }

    fn refused(root: &Path, path: &str, content: &str, base: Option<&str>) -> Refusal {
        write_checked(root, path, content, base).expect_err("expected a refusal")
    }

    #[test]
    fn writes_and_agrees_on_the_hash() {
        let (d, root) = tmp_repo();
        let h = saved(&root, "src/a.txt", "three\nfour\n", None);
        assert_eq!(fs::read_to_string(d.path().join("src/a.txt")).unwrap(), "three\nfour\n");
        assert_eq!(h.len(), 64);
        assert_eq!(h, hash("three\nfour\n"));
    }

    #[test]
    fn keeps_the_file_mode() {
        let (d, root) = tmp_repo();
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        fs::set_permissions(d.path().join("src/a.txt"), fs::Permissions::from_mode(0o755)).unwrap();
        saved(&root, "src/a.txt", "x\n", None);
        let mode = fs::metadata(d.path().join("src/a.txt")).unwrap().mode() & 0o777;
        assert_eq!(mode, 0o755);
    }

    #[test]
    fn a_stale_hash_is_a_conflict_with_the_current_text() {
        let (d, root) = tmp_repo();
        fs::write(d.path().join("src/a.txt"), "changed\n").unwrap();
        let r = refused(&root, "src/a.txt", "panel edit\n", Some(hash("one\ntwo\n").as_str()));
        assert_eq!(r.status, StatusCode::CONFLICT);
        assert_eq!(r.body["current"], "changed\n");
        assert_eq!(r.body["hash"], json!(hash("changed\n")));
        // Nothing was written.
        assert_eq!(fs::read_to_string(d.path().join("src/a.txt")).unwrap(), "changed\n");
        // The fresh hash goes through.
        saved(&root, "src/a.txt", "panel edit\n", Some(hash("changed\n").as_str()));
    }

    #[test]
    fn refuses_paths_outside_the_root() {
        let (_d, root) = tmp_repo();
        for p in ["/etc/hosts", "../outside.txt", "src/../../b.txt"] {
            assert_eq!(refused(&root, p, "x\n", None).status, StatusCode::BAD_REQUEST, "{p}");
        }
        for p in ["../outside.txt", "src/../../b.txt"] {
            assert!(refused(&root, p, "x\n", None).body["error"].as_str().unwrap().contains(".."), "{p}");
        }
    }

    #[test]
    fn refuses_symlink_escapes() {
        let (d, root) = tmp_repo();
        std::os::unix::fs::symlink("/etc", d.path().join("escape-dir")).unwrap();
        std::os::unix::fs::symlink("/etc/hosts", d.path().join("escape-file.txt")).unwrap();
        assert_eq!(refused(&root, "escape-dir/hosts", "x\n", None).status, StatusCode::BAD_REQUEST);
        assert_eq!(refused(&root, "escape-file.txt", "x\n", None).status, StatusCode::BAD_REQUEST);
        // And a symlinked source directory with a real subdirectory below it.
        let real = tempfile::tempdir().unwrap();
        fs::create_dir_all(real.path().join("sub")).unwrap();
        std::os::unix::fs::symlink(real.path().join("sub"), d.path().join("src/elsewhere")).unwrap();
        assert_eq!(refused(&root, "src/elsewhere/new.txt", "x\n", None).status, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn refuses_kula_paths_and_config() {
        let (_d, root) = tmp_repo();
        for p in [".git/config", "sub/.git/x", ".kula/state.db", "sub/.kula/x", "kula.toml", "src/kula.toml"] {
            let r = refused(&root, p, "x\n", None);
            assert_eq!(r.status, StatusCode::BAD_REQUEST, "{p}");
        }
        assert!(!Path::new("kula.toml").exists() || std::fs::read_to_string("kula.toml").is_ok());
    }

    #[test]
    fn refuses_binaries_and_oversize_files() {
        let (d, root) = tmp_repo();
        fs::write(d.path().join("src/bin.dat"), [0u8, 1, 2, 0, 3]).unwrap();
        assert_eq!(refused(&root, "src/bin.dat", "x\n", None).status, StatusCode::BAD_REQUEST);
        fs::write(d.path().join("src/big.txt"), "x".repeat(MAX_BYTES + 1)).unwrap();
        let e = refused(&root, "src/big.txt", "x\n", None).body["error"].as_str().unwrap().to_string();
        assert!(e.contains("on disk"), "{e}");
        // An oversize payload is refused before it ever touches the file.
        assert_eq!(refused(&root, "src/a.txt", &"y".repeat(MAX_BYTES + 1), None).status, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn creates_a_fresh_file_but_not_with_a_mismatched_hash() {
        let (d, root) = tmp_repo();
        saved(&root, "src/new.txt", "fresh\n", None);
        assert_eq!(fs::read_to_string(d.path().join("src/new.txt")).unwrap(), "fresh\n");
        assert_eq!(refused(&root, "src/new.txt", "other\n", Some(hash("old").as_str())).status, StatusCode::CONFLICT);
    }
}
