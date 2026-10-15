//! Map-by-default wiring: run the map (blocks + chains) after indexing and at
//! server start-up, off the request path, with progress on its own channel
//! (`GET /api/map/progress`). Gates: `[map] auto = true` (default) in
//! kula.toml, `kula index --no-map`. Singleflight: one run at a time – a
//! reindex and the embed remap cannot double-map. The incremental gate is
//! inside the engine (syntagm_rev): an unchanged graph reuses the stored map
//! in milliseconds, so a post-commit remap is cheap even when it fires.

use anyhow::Result;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::{embed, git::Repo, store::Store, syntagm};

// ----------------------------------------------------------------– progress

/// Live state of the background map run, polled by `/api/map/progress`.
#[derive(Serialize, Clone)]
pub struct MapState {
    pub running: bool,
    /// Phase of the current run: map | done | error.
    pub phase: String,
    pub blocks: usize,
    pub chains: usize,
    pub ms: u128,
    /// Last failure of a background run, empty when all went well.
    pub error: String,
}

static RUNNING: AtomicBool = AtomicBool::new(false);
static STATE: Mutex<MapState> = Mutex::new(MapState { running: false, phase: String::new(), blocks: 0, chains: 0, ms: 0, error: String::new() });

fn set_state(f: impl FnOnce(&mut MapState)) {
    let mut s = STATE.lock().unwrap();
    f(&mut s);
}

/// Current state for the API.
pub fn state() -> MapState {
    STATE.lock().unwrap().clone()
}

// ----------------------------------------------------------------– gates

/// `[map] auto` in kula.toml; on unless switched off. `[map] threads` rides
/// the engine's own `[syntagm] threads` read, so only the switch lives here.
pub fn enabled(repo: &Repo) -> bool {
    if let Ok(src) = std::fs::read_to_string(repo.root.join("kula.toml")) {
        if let Ok(t) = src.parse::<toml::Table>() {
            return t.get("map").and_then(|m| m.get("auto")).and_then(|v| v.as_bool()).unwrap_or(true);
        }
    }
    true
}

// ----------------------------------------------------------------– run

/// Spawn the map on the background pool unless one is running or `[map] auto`
/// is off. Never blocks the caller – `kula index` and the server both fire
/// and forget. Returns whether a run actually started.
pub fn spawn(repo: Repo, quiet: bool) -> bool {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return false; // singleflight: someone is already mapping this repo
    }
    if !enabled(&repo) {
        RUNNING.store(false, Ordering::SeqCst);
        return false;
    }
    set_state(|s| {
        *s = MapState { running: true, phase: "map".into(), blocks: 0, chains: 0, ms: 0, error: String::new() };
    });
    match std::thread::Builder::new()
        .name("kula-map".into())
        .spawn(move || {
            let t0 = std::time::Instant::now();
            let r = run_blocking(&repo);
            match r {
                Ok(s) => set_state(|st| {
                    *st = MapState {
                        running: false,
                        phase: "done".into(),
                        blocks: s.blocks.len(),
                        chains: s.chains.len(),
                        ms: t0.elapsed().as_millis(),
                        error: String::new(),
                    };
                }),
                Err(e) => set_state(|st| {
                    st.running = false;
                    st.phase = "error".into();
                    st.error = format!("{e:#}");
                }),
            }
            RUNNING.store(false, Ordering::SeqCst);
        }) {
        // Thread spawn failed – release the flight guard and say so.
        Err(_) => {
            RUNNING.store(false, Ordering::SeqCst);
            return false;
        }
        Ok(_) => {}
    }
    if !quiet {
        eprintln!("  {} mapping in the background – {} for progress", crate::term::dim("◇"), crate::term::dim("/api/map/progress"));
    }
    true
}

/// The map itself: the engine's own incremental gate (syntagm_rev) reuses the
/// stored map when the graph hash is unchanged, so this is cheap after a
/// commit that touched nothing indexed. The embedding cache, when present,
/// rides along as the similarity provider – that is the thematic re-form.
fn run_blocking(repo: &Repo) -> Result<syntagm::Syntagm> {
    let store = Store::open(repo)?;
    let (idx, state) = embed::similarity_for(repo, &store);
    let sim = idx.as_ref().map(|i| i as &dyn syntagm::Similarity);
    syntagm::build_with(repo, &store, sim, state)
}

// ----------------------------------------------------------------– tests

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_auto_defaults_on_and_reads_the_switch() {
        let dir = tempfile::tempdir().unwrap();
        // No kula.toml: on.
        assert!(enabled(&repo_in(dir.path())));
        std::fs::write(dir.path().join("kula.toml"), "[map]\nauto = false\n").unwrap();
        assert!(!enabled(&repo_in(dir.path())));
        std::fs::write(dir.path().join("kula.toml"), "[map]\nauto = true\n[embed]\nthreads = 2\n").unwrap();
        assert!(enabled(&repo_in(dir.path())));
    }

    #[test]
    fn spawn_refuses_when_auto_is_off() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("kula.toml"), "[map]\nauto = false\n").unwrap();
        let repo = repo_in(dir.path());
        let started = std::thread::scope(|sc| {
            let h = sc.spawn(|| {
                let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
                rt.block_on(async { spawn(repo, true) })
            });
            h.join().unwrap()
        });
        assert!(!started, "auto = false must not start a map run");
        assert!(!state().running);
    }

    fn repo_in(root: &std::path::Path) -> Repo {
        // A Repo for gate checks only – never opened here.
        Repo { root: root.to_path_buf() }
    }
}