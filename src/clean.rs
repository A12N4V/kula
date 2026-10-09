//! Disk upkeep: what kula leaves in `.kula/` after use, cleared on a timer.
//!
//! `kula run` keeps the files an agent wrote over fences in `.kula/run/<stamp>`,
//! the graph store grows free pages as it is re-indexed, and a crashed write can
//! leave temp files behind. `kula clean` removes the first once they are older
//! than the timer, deletes the last, and compacts the store. `kula view` runs
//! the same pass once the UI has been idle for the timer (Settings → Disk).

use crate::git::Repo;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{Duration, SystemTime};

/// Minutes of idle before cleaning; 0 turns it off.
pub const DEFAULT_AFTER_MIN: u32 = 15;

/// Rejected research experiments kept for context when gc prunes a finished
/// run – every kept experiment survives, only superseded rejected ones go.
const KEEP_REJECTED: usize = 10;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Policy {
    pub after_min: u32,
}

impl Default for Policy {
    fn default() -> Self {
        Policy { after_min: DEFAULT_AFTER_MIN }
    }
}

fn policy_path(repo: &Repo) -> std::path::PathBuf {
    repo.kula_dir().join("clean.json")
}

pub fn policy(repo: &Repo) -> Policy {
    std::fs::read_to_string(policy_path(repo)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn set_policy(repo: &Repo, p: Policy) -> Result<Policy> {
    let p = Policy { after_min: p.after_min.min(24 * 60) };
    std::fs::create_dir_all(repo.kula_dir())?;
    std::fs::write(policy_path(repo), serde_json::to_string_pretty(&p)?)?;
    Ok(p)
}

#[derive(Debug, Default, Serialize)]
pub struct Report {
    pub runs_removed: usize,
    pub temp_removed: usize,
    pub freed_bytes: u64,
    /// `.kula/` after the pass.
    pub size_bytes: u64,
}

pub fn size(p: &Path) -> u64 {
    match std::fs::symlink_metadata(p) {
        Ok(m) if m.is_dir() => std::fs::read_dir(p).into_iter().flatten().flatten().map(|e| size(&e.path())).sum(),
        Ok(m) => m.len(),
        Err(_) => 0,
    }
}

fn older_than(p: &Path, age: Duration) -> bool {
    std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| SystemTime::now().duration_since(t).ok()).is_some_and(|d| d >= age)
}

/// One pass. `age` is how old a kept run must be to go; `Duration::ZERO` takes them all.
pub fn run(repo: &Repo, age: Duration, dry_run: bool) -> Result<Report> {
    let dir = repo.kula_dir();
    let before = size(&dir);
    let mut r = Report::default();
    // Agents' kept versions from `kula run`.
    for e in std::fs::read_dir(dir.join("run")).into_iter().flatten().flatten() {
        if older_than(&e.path(), age) {
            r.runs_removed += 1;
            if !dry_run {
                std::fs::remove_dir_all(e.path()).or_else(|_| std::fs::remove_file(e.path()))?;
            }
        }
    }
    if !dry_run {
        let _ = std::fs::remove_dir(dir.join("run"));
    }
    // Leftovers from interrupted writes.
    for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if (name.ends_with(".tmp") || name.ends_with("-journal") || name.ends_with(".db-shm"))
            && older_than(&e.path(), Duration::from_secs(60))
        {
            r.temp_removed += 1;
            if !dry_run {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    // Give the store's free pages back to the disk.
    if !dry_run && dir.join("graph.db").exists() {
        if let Ok(c) = rusqlite::Connection::open(dir.join("graph.db")) {
            let _ = c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
        }
    }
    r.size_bytes = size(&dir);
    r.freed_bytes = before.saturating_sub(r.size_bytes);
    Ok(r)
}

/// A deep compaction pass, `kula gc`. Unlike `run` (which only clears aged
/// agent snapshots), gc prunes what has been superseded: rejected research
/// experiments in finished runs and exact-duplicate memories. Nothing is
/// deleted silently – the caller reports every count and byte – and nothing a
/// live run still references goes: active research runs and kept experiments
/// always survive, and memory dedupe lands as its own commit on
/// `refs/kula/meta`, auditable like every other metadata change.
pub fn gc(repo: &Repo, dry_run: bool) -> Result<GcReport> {
    let dir = repo.kula_dir();
    let before = size(&dir);
    let mut r = GcReport { size_bytes_before: before, ..GcReport::default() };

    // Research: finished runs only – an active run's history is its log.
    let rdir = dir.join("research");
    for e in std::fs::read_dir(&rdir).into_iter().flatten().flatten() {
        if !e.file_name().to_string_lossy().ends_with(".json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(e.path()) else { continue };
        let Ok(mut s) = serde_json::from_str::<crate::research::State>(&text) else { continue };
        if s.active {
            continue;
        }
        let kept = s.experiments.iter().filter(|x| x.kept).count();
        let rejected = s.experiments.len() - kept;
        // Keep every kept experiment and the newest KEEP_REJECTED rejected ones.
        let cutoff = rejected.saturating_sub(KEEP_REJECTED);
        let mut seen_rejected = 0usize;
        let before_len = s.experiments.len();
        let mut keep = Vec::with_capacity(before_len);
        for x in s.experiments.drain(..).rev() {
            if x.kept {
                keep.push(x);
            } else {
                seen_rejected += 1;
                if seen_rejected > cutoff {
                    keep.push(x);
                }
            }
        }
        keep.reverse();
        let dropped = before_len - keep.len();
        if dropped > 0 {
            s.experiments = keep;
            r.research_pruned += dropped;
            if !dry_run {
                // Compact, not pretty: these files are machine-read.
                std::fs::write(e.path(), serde_json::to_string(&s)?)?;
            }
        }
    }

    // Memories: exact duplicates (same target and body) collapse to the
    // earliest. This is inside git, so the removal is a commit you can read.
    let meta = crate::meta::load(repo)?;
    let mut seen: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
    let mut removed = 0usize;
    let mut notes = meta.notes.clone();
    notes.retain(|n| {
        if n.kind != "memory" {
            return true;
        }
        let key = (n.target.clone(), n.body.clone());
        if seen.contains(&key) {
            removed += 1;
            false
        } else {
            seen.insert(key);
            true
        }
    });
    if removed > 0 {
        r.memories_deduped = removed;
        if !dry_run {
            let mut m = meta;
            m.notes = notes;
            crate::meta::save(repo, &m, "gc: remove duplicate memories")?;
        }
    }

    // The store's free pages back to the disk.
    if !dry_run && dir.join("graph.db").exists() {
        if let Ok(c) = rusqlite::Connection::open(dir.join("graph.db")) {
            let _ = c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
        }
    }

    r.size_bytes = size(&dir);
    r.freed_bytes = before.saturating_sub(r.size_bytes);
    Ok(r)
}

#[derive(Debug, Default, Serialize)]
pub struct GcReport {
    /// Rejected research experiments dropped from finished runs.
    pub research_pruned: usize,
    /// Exact-duplicate memories removed (one commit on refs/kula/meta).
    pub memories_deduped: usize,
    pub freed_bytes: u64,
    /// `.kula/` before the pass.
    pub size_bytes_before: u64,
    /// `.kula/` after the pass.
    pub size_bytes: u64,
}

pub fn human(b: u64) -> String {
    let (v, u) = match b {
        b if b >= 1 << 30 => (b as f64 / (1u64 << 30) as f64, "GB"),
        b if b >= 1 << 20 => (b as f64 / (1u64 << 20) as f64, "MB"),
        b if b >= 1 << 10 => (b as f64 / 1024.0, "KB"),
        b => return format!("{b} B"),
    };
    format!("{v:.1} {u}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_old_runs_and_temp_files_only() {
        let tmp = std::env::temp_dir().join(format!("kula-clean-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join(".kula/run/1/src")).unwrap();
        std::fs::write(tmp.join(".kula/run/1/src/a.rs"), "x".repeat(4096)).unwrap();
        std::fs::write(tmp.join(".kula/task.json"), "{}").unwrap();
        std::process::Command::new("git").args(["init", "-q"]).current_dir(&tmp).status().unwrap();
        let repo = Repo::discover(&tmp).unwrap();
        // too young for a 15 minute timer
        let r = run(&repo, Duration::from_secs(900), false).unwrap();
        assert_eq!(r.runs_removed, 0);
        assert!(tmp.join(".kula/run/1").exists());
        // the timer elapsed
        let r = run(&repo, Duration::ZERO, false).unwrap();
        assert_eq!(r.runs_removed, 1);
        assert!(r.freed_bytes >= 4096);
        assert!(!tmp.join(".kula/run").exists());
        assert!(tmp.join(".kula/task.json").exists());
        assert_eq!(policy(&repo).after_min, DEFAULT_AFTER_MIN);
        assert_eq!(set_policy(&repo, Policy { after_min: 5 }).unwrap().after_min, 5);
        assert_eq!(policy(&repo).after_min, 5);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn gc_prunes_superseded_entries_and_reports_bytes() {
        let tmp = std::env::temp_dir().join(format!("kula-gc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join(".kula/research")).unwrap();
        std::process::Command::new("git").args(["init", "-q"]).current_dir(&tmp).status().unwrap();
        // meta::save commits on refs/kula/meta: give this throwaway repo an identity.
        std::process::Command::new("git").args(["config", "user.name", "kula test"]).current_dir(&tmp).status().unwrap();
        std::process::Command::new("git").args(["config", "user.email", "test@kula.local"]).current_dir(&tmp).status().unwrap();
        // A finished run: 2 kept, 20 rejected – 10 of the rejected survive.
        let mut s = crate::research::State { workflow: "fix".into(), ..Default::default() };
        for n in 0..22u32 {
            s.experiments.push(crate::research::Experiment { n, hypothesis: format!("idea {n}"), kept: n % 11 == 0, ..Default::default() });
        }
        std::fs::write(tmp.join(".kula/research/fix.json"), serde_json::to_string_pretty(&s).unwrap()).unwrap();
        // An active run: gc must not touch it.
        let mut live = crate::research::State { workflow: "ship".into(), active: true, ..Default::default() };
        for n in 0..30u32 {
            live.experiments.push(crate::research::Experiment { n, hypothesis: format!("live {n}"), ..Default::default() });
        }
        std::fs::write(tmp.join(".kula/research/ship.json"), serde_json::to_string_pretty(&live).unwrap()).unwrap();
        let repo = Repo::discover(&tmp).unwrap();
        // Two identical memories plus one distinct one.
        crate::meta::memory_add(&repo, "repo", "amounts are integer cents", "claude", None).unwrap();
        crate::meta::memory_add(&repo, "repo", "amounts are integer cents", "cursor", None).unwrap();
        crate::meta::memory_add(&repo, "repo", "always rebase before pushing", "claude", None).unwrap();
        let before = size(&tmp.join(".kula"));
        // Dry run changes nothing.
        let r = gc(&repo, true).unwrap();
        assert_eq!(r.research_pruned, 10);
        assert_eq!(r.memories_deduped, 1);
        assert_eq!(size(&tmp.join(".kula")), before);
        let mut m = crate::meta::load(&repo).unwrap();
        assert_eq!(m.notes.len(), 3);
        // The real pass.
        let r = gc(&repo, false).unwrap();
        assert_eq!(r.research_pruned, 10);
        assert_eq!(r.memories_deduped, 1);
        assert_eq!(r.freed_bytes, before.saturating_sub(r.size_bytes));
        assert!(r.freed_bytes > 0, "pruning must report freed bytes");
        // The finished run keeps both kept experiments and 10 rejected ones.
        let s: crate::research::State =
            serde_json::from_str(&std::fs::read_to_string(tmp.join(".kula/research/fix.json")).unwrap()).unwrap();
        assert_eq!(s.experiments.len(), 12);
        assert_eq!(s.experiments.iter().filter(|x| x.kept).count(), 2);
        // The active run is untouched, exactly 30 experiments.
        let live: crate::research::State =
            serde_json::from_str(&std::fs::read_to_string(tmp.join(".kula/research/ship.json")).unwrap()).unwrap();
        assert_eq!(live.experiments.len(), 30);
        // Dedupe collapsed the duplicate memory and kept the distinct one.
        m = crate::meta::load(&repo).unwrap();
        let memories: Vec<_> = m.notes.iter().filter(|n| n.kind == "memory").collect();
        assert_eq!(memories.len(), 2);
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
