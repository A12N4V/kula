//! Thin, dependable wrapper around the system `git` binary.
//!
//! Kula deliberately shells out to git instead of reimplementing it: every git
//! feature (hooks, signing, credential helpers, rebase, LFS…) keeps working.

use anyhow::{anyhow, bail, Context, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Clone, Debug)]
pub struct Repo {
    pub root: PathBuf,
}

impl Repo {
    /// Locate the repository containing `start`.
    pub fn discover(start: &Path) -> Result<Repo> {
        let out = Command::new("git")
            .arg("-C")
            .arg(start)
            .args(["rev-parse", "--show-toplevel"])
            .output()
            .context("failed to run git — is it installed and on PATH?")?;
        if !out.status.success() {
            bail!("not a git repository: {}", start.display());
        }
        let root = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Ok(Repo { root: PathBuf::from(root) })
    }

    pub fn name(&self) -> String {
        self.root.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "repo".into())
    }

    pub fn kula_dir(&self) -> PathBuf {
        self.root.join(".kula")
    }

    fn cmd(&self) -> Command {
        let mut c = Command::new("git");
        c.arg("-C").arg(&self.root);
        c.env("GIT_TERMINAL_PROMPT", "0");
        c
    }

    /// Run git and return stdout; errors carry stderr.
    pub fn run<S: AsRef<str>>(&self, args: &[S]) -> Result<String> {
        let args: Vec<&str> = args.iter().map(|a| a.as_ref()).collect();
        let out = self.cmd().args(&args).output()?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            bail!("git {}: {}", args.join(" "), if err.is_empty() { "failed".into() } else { err });
        }
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    }

    /// Run git capturing stdout+stderr together, never failing (for the console).
    pub fn exec(&self, args: &[String]) -> Result<ExecResult> {
        let out = self.cmd().args(args).stdin(Stdio::null()).output()?;
        Ok(ExecResult {
            code: out.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&out.stdout).to_string(),
            stderr: String::from_utf8_lossy(&out.stderr).to_string(),
        })
    }

    /// Run git with stdin content.
    pub fn run_stdin(&self, args: &[&str], input: &[u8]) -> Result<String> {
        use std::io::Write;
        let mut child = self.cmd().args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
        child.stdin.take().unwrap().write_all(input)?;
        let out = child.wait_with_output()?;
        if !out.status.success() {
            bail!("git {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim());
        }
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    }

    pub fn head(&self) -> Option<String> {
        self.run(&["rev-parse", "HEAD"]).ok().map(|s| s.trim().to_string())
    }

    pub fn branch(&self) -> String {
        self.run(&["rev-parse", "--abbrev-ref", "HEAD"]).map(|s| s.trim().to_string()).unwrap_or_else(|_| "(no commits)".into())
    }

    pub fn user(&self) -> String {
        self.run(&["config", "user.name"])
            .map(|s| s.trim().to_string())
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "anonymous".into())
    }

    pub fn status(&self) -> Result<Vec<FileStatus>> {
        let raw = self.run(&["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
        let mut files = Vec::new();
        let mut parts = raw.split('\0').filter(|s| !s.is_empty());
        while let Some(entry) = parts.next() {
            if entry.len() < 4 {
                continue;
            }
            let x = entry.chars().next().unwrap();
            let y = entry.chars().nth(1).unwrap();
            let path = entry[3..].to_string();
            let mut orig = None;
            if x == 'R' || x == 'C' {
                orig = parts.next().map(|s| s.to_string());
            }
            files.push(FileStatus {
                path,
                orig,
                index: x.to_string(),
                worktree: y.to_string(),
                staged: x != ' ' && x != '?',
                unstaged: y != ' ',
                untracked: x == '?',
            });
        }
        Ok(files)
    }

    pub fn log(&self, limit: usize, rev: Option<&str>) -> Result<Vec<Commit>> {
        let n = format!("-n{limit}");
        let fmt = "--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e";
        let mut args = vec!["log", n.as_str(), fmt, "--topo-order"];
        if let Some(r) = rev {
            args.push(r);
        } else {
            args.push("--all");
        }
        let raw = match self.run(&args) {
            Ok(r) => r,
            Err(_) => return Ok(vec![]), // empty repo
        };
        Ok(raw
            .split('\x1e')
            .filter_map(|rec| {
                let rec = rec.trim_start_matches('\n');
                let f: Vec<&str> = rec.split('\x1f').collect();
                if f.len() < 8 {
                    return None;
                }
                Some(Commit {
                    sha: f[0].into(),
                    short: f[1].into(),
                    parents: f[2].split_whitespace().map(String::from).collect(),
                    author: f[3].into(),
                    email: f[4].into(),
                    time: f[5].parse().unwrap_or(0),
                    refs: f[6].split(", ").filter(|s| !s.is_empty() && !s.starts_with("refs/kula")).map(String::from).collect(),
                    subject: f[7].into(),
                })
            })
            .collect())
    }

    pub fn branches(&self) -> Result<Vec<Branch>> {
        let raw = self.run(&[
            "for-each-ref",
            "--format=%(refname)%1f%(refname:short)%1f%(objectname:short)%1f%(committerdate:unix)%1f%(upstream:short)%1f%(upstream:track)%1f%(HEAD)%1f%(contents:subject)",
            "refs/heads",
            "refs/remotes",
        ])?;
        Ok(raw
            .lines()
            .filter_map(|l| {
                let f: Vec<&str> = l.split('\x1f').collect();
                if f.len() < 8 || f[0].ends_with("/HEAD") {
                    return None;
                }
                Some(Branch {
                    name: f[1].into(),
                    remote: f[0].starts_with("refs/remotes/"),
                    sha: f[2].into(),
                    time: f[3].parse().unwrap_or(0),
                    upstream: f[4].into(),
                    track: f[5].into(),
                    current: f[6] == "*",
                    subject: f[7].into(),
                })
            })
            .collect())
    }

    pub fn diff(&self, path: Option<&str>, staged: bool) -> Result<String> {
        let mut args = vec!["diff", "--no-color", "--no-ext-diff"];
        if staged {
            args.push("--cached");
        }
        if let Some(p) = path {
            args.push("--");
            args.push(p);
        }
        let d = self.run(&args)?;
        if d.is_empty() {
            if let Some(p) = path {
                // Untracked file: show it as an all-added diff.
                let full = self.root.join(p);
                if full.is_file() && !staged {
                    let body = std::fs::read_to_string(&full).unwrap_or_default();
                    let mut s = format!("--- /dev/null\n+++ b/{p}\n@@ -0,0 +1,{} @@\n", body.lines().count());
                    for l in body.lines() {
                        s.push('+');
                        s.push_str(l);
                        s.push('\n');
                    }
                    return Ok(s);
                }
            }
        }
        Ok(d)
    }

    pub fn show(&self, sha: &str) -> Result<String> {
        validate_rev(sha)?;
        self.run(&["show", "--no-color", "--stat", "--patch", "--format=fuller", sha])
    }

    /// Files and changed line ranges between two revisions (merge-base aware).
    pub fn changed_ranges(&self, base: &str, head: &str) -> Result<Vec<ChangedFile>> {
        validate_rev(base)?;
        validate_rev(head)?;
        let range = format!("{base}...{head}");
        let ns = self.run(&["diff", "--name-status", "--no-renames", &range])?;
        let patch = self.run(&["diff", "-U0", "--no-color", "--no-renames", &range])?;
        let mut ranges: std::collections::HashMap<String, Vec<(u32, u32)>> = Default::default();
        let mut cur = String::new();
        for line in patch.lines() {
            if let Some(p) = line.strip_prefix("+++ b/") {
                cur = p.to_string();
            } else if line.starts_with("@@") {
                // @@ -a,b +c,d @@
                if let Some(plus) = line.split_whitespace().find(|t| t.starts_with('+')) {
                    let t = &plus[1..];
                    let mut it = t.split(',');
                    let start: u32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                    let len: u32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(1);
                    ranges.entry(cur.clone()).or_default().push((start, start + len.max(1) - 1));
                }
            }
        }
        Ok(ns
            .lines()
            .filter_map(|l| {
                let mut it = l.split('\t');
                let st = it.next()?.to_string();
                let p = it.next()?.to_string();
                let r = ranges.remove(&p).unwrap_or_default();
                Some((st, p, r))
            })
            .collect())
    }

    pub fn ahead_behind(&self, base: &str, head: &str) -> (usize, usize) {
        let range = format!("{base}...{head}");
        self.run(&["rev-list", "--left-right", "--count", &range])
            .ok()
            .and_then(|s| {
                let mut it = s.split_whitespace();
                Some((it.next()?.parse().ok()?, it.next()?.parse().ok()?))
            })
            .map(|(behind, ahead)| (ahead, behind))
            .unwrap_or((0, 0))
    }

    pub fn is_clean(&self) -> bool {
        self.run(&["status", "--porcelain", "--untracked-files=no"]).map(|s| s.trim().is_empty()).unwrap_or(false)
    }
}

/// Reject revisions that could be interpreted as options.
pub fn validate_rev(r: &str) -> Result<()> {
    if r.is_empty() || r.starts_with('-') || r.contains(char::is_whitespace) {
        return Err(anyhow!("invalid revision: {r:?}"));
    }
    Ok(())
}

/// (status, path, changed line ranges in the head revision)
pub type ChangedFile = (String, String, Vec<(u32, u32)>);

#[derive(Serialize, Debug, Clone)]
pub struct ExecResult {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct FileStatus {
    pub path: String,
    pub orig: Option<String>,
    pub index: String,
    pub worktree: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
}

#[derive(Serialize, Debug, Clone)]
pub struct Commit {
    pub sha: String,
    pub short: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub refs: Vec<String>,
    pub subject: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct Branch {
    pub name: String,
    pub remote: bool,
    pub sha: String,
    pub time: i64,
    pub upstream: String,
    pub track: String,
    pub current: bool,
    pub subject: String,
}
