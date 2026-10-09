//! The repo's agent setup – `.agents/` (skills, MCP servers), `kula.toml` and
//! the instruction files – as a snapshot on `refs/kula/setup`.
//!
//! Private by default: nothing leaves the machine until `kula share` pushes the
//! snapshot (with the issues and memories on `refs/kula/meta`). Whoever clones
//! or forks runs `kula sync` (or `kula sync upstream` for a fork – GitHub does
//! not copy custom refs) and gets the files back, then every agent's own copy
//! is regenerated from them. Files they already changed are never overwritten.

use crate::git::Repo;
use anyhow::{bail, Result};
use std::path::Path;
use std::process::Command;

pub const REF: &str = "refs/kula/setup";
const REMOTE: &str = "refs/kula/remote-setup";

/// The sources of truth; each agent's own folder is generated from these.
pub const SOURCES: &[&str] = &[".agents", "kula.toml", "AGENTS.md", "CLAUDE.md", "GEMINI.md", ".mcp.json"];

fn tree_of(repo: &Repo, dir: &Path) -> Result<Option<String>> {
    let mut rows = String::new();
    let mut entries: Vec<_> = std::fs::read_dir(dir)?.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let name = e.file_name().to_string_lossy().to_string();
        let ft = e.file_type()?;
        if ft.is_dir() {
            if let Some(t) = tree_of(repo, &e.path())? {
                rows.push_str(&format!("040000 tree {t}\t{name}\n"));
            }
        } else if ft.is_file() {
            let b = repo.run_stdin(&["hash-object", "-w", "--stdin"], &std::fs::read(e.path())?)?;
            rows.push_str(&format!("100644 blob {}\t{name}\n", b.trim()));
        }
    }
    if rows.is_empty() {
        return Ok(None);
    }
    Ok(Some(repo.run_stdin(&["mktree"], rows.as_bytes())?.trim().to_string()))
}

/// Commit the current setup onto `refs/kula/setup`. Returns the files included.
pub fn snapshot(repo: &Repo) -> Result<Vec<String>> {
    let mut rows = String::new();
    for s in SOURCES {
        let p = repo.root.join(s);
        if p.is_dir() {
            if let Some(t) = tree_of(repo, &p)? {
                rows.push_str(&format!("040000 tree {t}\t{s}\n"));
            }
        } else if p.is_file() {
            let b = repo.run_stdin(&["hash-object", "-w", "--stdin"], &std::fs::read(&p)?)?;
            rows.push_str(&format!("100644 blob {}\t{s}\n", b.trim()));
        }
    }
    if rows.is_empty() {
        bail!("nothing to share: no .agents/, kula.toml or instruction files here");
    }
    let tree = repo.run_stdin(&["mktree"], rows.as_bytes())?.trim().to_string();
    let parent = repo.run(&["rev-parse", "--verify", "--quiet", REF]).ok().map(|s| s.trim().to_string());
    if let Some(p) = parent.as_ref().filter(|p| !p.is_empty()) {
        if repo.run(&["rev-parse", &format!("{p}^{{tree}}")])?.trim() == tree {
            return files(repo, REF);
        }
    }
    let mut args = vec!["commit-tree".to_string(), tree, "-m".into(), "kula: share agent setup".into()];
    if let Some(p) = parent.filter(|p| !p.is_empty()) {
        args.push("-p".into());
        args.push(p);
    }
    let commit = repo.run(&args)?.trim().to_string();
    repo.run(&["update-ref", REF, &commit])?;
    files(repo, REF)
}

fn files(repo: &Repo, rev: &str) -> Result<Vec<String>> {
    Ok(repo.run(&["ls-tree", "-r", "--name-only", rev])?.lines().map(String::from).collect())
}

fn blob(repo: &Repo, rev: &str, path: &str) -> Result<Vec<u8>> {
    let out = Command::new("git").arg("-C").arg(&repo.root).args(["show", &format!("{rev}:{path}")]).output()?;
    if !out.status.success() {
        bail!("git show {rev}:{path}: {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(out.stdout)
}

#[derive(Default, Debug)]
pub struct Restored {
    pub written: Vec<String>,
    /// Changed here since the snapshot; left alone.
    pub kept: Vec<String>,
}

/// Write the snapshot at `rev` into the working tree. A file that exists with
/// different content is kept unless it is unchanged since our last restore.
pub fn restore(repo: &Repo, rev: &str, overwrite: bool) -> Result<Restored> {
    let mut r = Restored::default();
    let ours = repo.run(&["rev-parse", "--verify", "--quiet", REF]).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    for f in files(repo, rev)? {
        if f.split('/').any(|c| c == ".." || c == ".git") {
            continue;
        }
        let dst = repo.root.join(&f);
        let theirs = blob(repo, rev, &f)?;
        match std::fs::read(&dst) {
            Ok(cur) if cur == theirs => continue,
            Ok(cur) => {
                // Untouched since the last restore -> safe to update.
                let base = ours.as_ref().and_then(|o| blob(repo, o, &f).ok());
                if !overwrite && base.as_deref() != Some(cur.as_slice()) {
                    r.kept.push(f);
                    continue;
                }
            }
            Err(_) => {}
        }
        if let Some(d) = dst.parent() {
            std::fs::create_dir_all(d)?;
        }
        std::fs::write(&dst, theirs)?;
        r.written.push(f);
    }
    Ok(r)
}

/// Pull the remote's shared setup, if any, into the working tree.
pub fn pull(repo: &Repo, remote: &str, overwrite: bool) -> Result<Option<Restored>> {
    if repo.run(&["fetch", remote, &format!("+{REF}:{REMOTE}")]).is_err() {
        return Ok(None);
    }
    let r = restore(repo, REMOTE, overwrite)?;
    repo.run(&["update-ref", REF, REMOTE])?;
    Ok(Some(r))
}

pub fn push(repo: &Repo, remote: &str) -> Result<()> {
    if let Err(e) = repo.run(&["push", remote, &format!("{REF}:{REF}")]) {
        bail!("{e}\nsomeone shared a newer setup – run `kula sync {remote}` first, then share again");
    }
    Ok(())
}
