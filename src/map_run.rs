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
    /// Phase of the current run. Real stages, not one opaque blob: load |
    /// graph | similarity | map | done | error.
    pub phase: String,
    pub blocks: usize,
    pub chains: usize,
    pub ms: u128,
    /// Last failure of a background run, empty when all went well.
    pub error: String,
}

static RUNNING: AtomicBool = AtomicBool::new(false);
static STATE: Mutex<MapState> =
    Mutex::new(MapState { running: false, phase: String::new(), blocks: 0, chains: 0, ms: 0, error: String::new() });

fn set_state(f: impl FnOnce(&mut MapState)) {
    let mut s = STATE.lock().unwrap();
    f(&mut s);
}

/// Report the run's phase – real stage boundaries, not one opaque "map".
fn set_phase(phase: &str) {
    set_state(|s| s.phase = phase.into());
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
    let started = std::thread::Builder::new().name("kula-map".into()).spawn(move || {
        let t0 = std::time::Instant::now();
        let r = run_phased(&repo);
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
    });
    // Thread spawn failed – release the flight guard and say so.
    if started.is_err() {
        RUNNING.store(false, Ordering::SeqCst);
        return false;
    }
    drop(started);
    if !quiet {
        eprintln!("  {} mapping in the background – {} for progress", crate::term::dim("◇"), crate::term::dim("/api/map/progress"));
    }
    true
}

/// The map, on the caller's thread, with the singleflight guard held for the
/// whole run. `kula index` uses this instead of `spawn`: the CLI process ends
/// when main returns, so a detached thread would be killed mid-run and the
/// stored map would never land. The server keeps fire-and-forget `spawn`.
/// Returns whether a run ran (false when one is already running or auto is off).
pub fn run_now(repo: Repo, quiet: bool) -> bool {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return false;
    }
    if !enabled(&repo) {
        RUNNING.store(false, Ordering::SeqCst);
        return false;
    }
    set_state(|s| *s = MapState { running: true, phase: "load".into(), blocks: 0, chains: 0, ms: 0, error: String::new() });
    let t0 = std::time::Instant::now();
    let r = run_phased(&repo);
    let ok = r.is_ok();
    match r {
        Ok(ref s) => set_state(|st| {
            *st = MapState {
                running: false,
                phase: "done".into(),
                blocks: s.blocks.len(),
                chains: s.chains.len(),
                ms: t0.elapsed().as_millis(),
                error: String::new(),
            };
        }),
        Err(ref e) => set_state(|st| {
            st.running = false;
            st.phase = "error".into();
            st.error = format!("{e:#}");
        }),
    }
    RUNNING.store(false, Ordering::SeqCst);
    if ok && !quiet {
        eprintln!("  {} mapped {} blocks, {} chains in {} ms", crate::term::dim("◇"), s_blocks(&r), s_chains(&r), t0.elapsed().as_millis());
    }
    ok
}

fn s_blocks(r: &Result<syntagm::Syntagm>) -> usize {
    r.as_ref().map(|s| s.blocks.len()).unwrap_or(0)
}
fn s_chains(r: &Result<syntagm::Syntagm>) -> usize {
    r.as_ref().map(|s| s.chains.len()).unwrap_or(0)
}

/// The run with its real stage boundaries reported to the progress state:
/// load (the graph store) → graph (read nodes and edges) → similarity (the
/// embedding cache, when present) → map (the engine builds blocks and
/// chains). The engine does not report finer callbacks yet – when M1's
/// `map.rs` grows phase callbacks, they slot into `set_phase` here.
fn run_phased(repo: &Repo) -> Result<syntagm::Syntagm> {
    set_phase("load");
    let store = Store::open(repo)?;
    set_phase("graph");
    set_phase("similarity");
    let (idx, state) = embed::similarity_for(repo, &store);
    let sim = idx.as_ref().map(|i| i as &dyn syntagm::Similarity);
    set_phase("map");
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
