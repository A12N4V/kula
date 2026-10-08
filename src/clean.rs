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
}
