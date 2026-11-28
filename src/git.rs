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
            .context("failed to run git – is it installed and on PATH?")?;
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

    /// Run kula itself (this binary) in the repository, as the web console does:
    /// kula's own commands, and anything else passed through to git. Commands
    /// that hold the terminal or serve forever are refused; editors and
    /// credential prompts are switched off, so nothing waits on input.
    pub fn exec_kula(&self, args: &[String]) -> Result<ExecResult> {
        let first = args.iter().find(|a| !a.starts_with('-')).map(String::as_str).unwrap_or("");
        if matches!(first, "view" | "mcp") || args.iter().any(|a| a == "-i" || a == "--interactive") {
            bail!("`kula {}` needs a real terminal; run it in one", args.join(" "));
        }
        let exe = std::env::current_exe()?;
        let out = Command::new(exe)
            .arg("-C")
            .arg(&self.root)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_EDITOR", "true")
            .env("GIT_PAGER", "cat")
            .env("NO_COLOR", "1")
            .stdin(Stdio::null())
            .output()?;
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

    /// Read many blobs at `rev` through one `git cat-file --batch` process.
    pub fn cat_files(&self, rev: &str, paths: &[&str]) -> Result<std::collections::HashMap<String, String>> {
        use std::io::{BufRead, BufReader, Read, Write};
        validate_rev(rev)?;
        let mut child =
            self.cmd().args(["cat-file", "--batch"]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()?;
        let mut stdin = child.stdin.take().unwrap();
        let input: String = paths.iter().map(|p| format!("{rev}:{p}\n")).collect();
        // Write on a thread so a large batch can't deadlock against our reads.
        let writer = std::thread::spawn(move || stdin.write_all(input.as_bytes()));
        let mut out = BufReader::new(child.stdout.take().unwrap());
        let mut map = std::collections::HashMap::new();
        for p in paths {
            let mut header = String::new();
            if out.read_line(&mut header)? == 0 {
                break;
            }
            if header.trim_end().ends_with("missing") {
                continue;
            }
            let size: usize = header.split_whitespace().nth(2).and_then(|s| s.parse().ok()).unwrap_or(0);
            let mut buf = vec![0u8; size + 1]; // content + trailing LF
            out.read_exact(&mut buf)?;
            buf.pop();
            if let Ok(text) = String::from_utf8(buf) {
                map.insert(p.to_string(), text);
            }
        }
        let _ = writer.join();
        let _ = child.wait();
        Ok(map)
    }

    pub fn head(&self) -> Option<String> {
        self.run(&["rev-parse", "HEAD"]).ok().map(|s| s.trim().to_string())
    }

    /// The checked-out branch – named even before the first commit – or `HEAD`
    /// when detached (callers pass it to git as a ref).
    pub fn branch(&self) -> String {
        if let Ok(b) = self.run(&["symbolic-ref", "--short", "-q", "HEAD"]) {
            if !b.trim().is_empty() {
                return b.trim().to_string();
            }
        }
        "HEAD".into()
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
            // Every branch and tag – but not kula's own bookkeeping on refs/kula/*.
            args.extend(["--exclude=refs/kula/*", "--all"]);
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
        // A three-dot range needs a merge base; unrelated histories (an orphan
        // main beside a team branch) have none – fall back to the two-dot diff
        // rather than failing the whole comparison.
        let range3 = format!("{base}...{head}");
        let range2 = format!("{base}..{head}");
        let ns = match self.run(&["diff", "--name-status", "--no-renames", &range3]) {
            Ok(ns) => ns,
            Err(_) => self.run(&["diff", "--name-status", "--no-renames", &range2])?,
        };
        let patch = match self.run(&["diff", "-U0", "--no-color", "--no-renames", &range3]) {
            Ok(p) => p,
            Err(_) => self.run(&["diff", "-U0", "--no-color", "--no-renames", &range2])?,
        };
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

    /// Ahead and behind `base` for every branch, local and remote, in one git call
    /// (git 2.41+); older git falls back to one `rev-list` per branch.
    pub fn ahead_behind_all(&self, base: &str) -> std::collections::HashMap<String, (usize, usize)> {
        let fmt = format!("--format=%(refname:short)%1f%(ahead-behind:{base})");
        if let Ok(raw) = self.run(&["for-each-ref", fmt.as_str(), "refs/heads", "refs/remotes"]) {
            return raw
                .lines()
                .filter_map(|l| {
                    let (name, ab) = l.split_once('\x1f')?;
                    let (a, b) = ab.split_once(' ')?;
                    Some((name.to_string(), (a.parse().ok()?, b.parse().ok()?)))
                })
                .collect();
        }
        let names = self.run(&["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]).unwrap_or_default();
        names.lines().map(|n| (n.to_string(), self.ahead_behind(base, n))).collect()
    }

    pub fn is_clean(&self) -> bool {
        self.run(&["status", "--porcelain", "--untracked-files=no"]).map(|s| s.trim().is_empty()).unwrap_or(false)
    }

    /// The branch others merge into: origin/HEAD, else main, else master, else HEAD's.
    pub fn default_branch(&self) -> String {
        if let Ok(s) = self.run(&["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]) {
            let s = s.trim();
            if !s.is_empty() {
                return s.to_string();
            }
        }
        for b in ["main", "master"] {
            if self.run(&["rev-parse", "--verify", "--quiet", &format!("refs/heads/{b}")]).is_ok() {
                return b.into();
            }
        }
        self.branch()
    }

    /// Every worktree, from `git worktree list --porcelain`, with its dirty count.
    pub fn worktrees(&self) -> Result<Vec<Worktree>> {
        let raw = self.run(&["worktree", "list", "--porcelain"])?;
        let mut out = vec![];
        for (i, block) in raw.split("\n\n").filter(|b| !b.trim().is_empty()).enumerate() {
            let mut w = Worktree { main: i == 0, ..Default::default() };
            for l in block.lines() {
                let (k, v) = l.split_once(' ').unwrap_or((l, ""));
                match k {
                    "worktree" => w.path = v.into(),
                    "HEAD" => w.head = v.chars().take(12).collect(),
                    "branch" => w.branch = v.trim_start_matches("refs/heads/").into(),
                    "detached" => w.detached = true,
                    "bare" => w.bare = true,
                    "locked" => w.locked = true,
                    "prunable" => w.prunable = true,
                    _ => {}
                }
            }
            w.name = if w.main { "main".into() } else { Path::new(&w.path).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default() };
            w.current = Path::new(&w.path).canonicalize().ok() == self.root.canonicalize().ok();
            if !w.bare && !w.prunable && Path::new(&w.path).is_dir() {
                let st = Command::new("git").arg("-C").arg(&w.path).args(["status", "--porcelain"]).env("GIT_TERMINAL_PROMPT", "0").output();
                if let Ok(o) = st {
                    w.dirty = String::from_utf8_lossy(&o.stdout).lines().filter(|l| !l.is_empty()).count();
                }
            }
            out.push(w);
        }
        Ok(out)
    }

    /// One look at all worktrees and branches: where each branch is checked
    /// out, how far it sits from the default branch, and whether it is merged.
    pub fn overview(&self) -> Result<Overview> {
        let base = self.default_branch();
        let worktrees = self.worktrees()?;
        let merged: std::collections::HashSet<String> = self
            .run(&["for-each-ref", "--merged", &base, "--format=%(refname:short)", "refs/heads", "refs/remotes"])
            .unwrap_or_default()
            .lines()
            .map(String::from)
            .collect();
        let counts = self.ahead_behind_all(&base);
        let mut branches = vec![];
        for b in self.branches()? {
            let (ahead, behind) = if b.name == base { (0, 0) } else { counts.get(&b.name).copied().unwrap_or((0, 0)) };
            let worktree = if b.remote { None } else { worktrees.iter().find(|w| w.branch == b.name).map(|w| w.name.clone()) };
            branches.push(OverviewBranch { merged: b.name != base && merged.contains(&b.name), ahead, behind, worktree, branch: b });
        }
        let local = branches.iter().filter(|b| !b.branch.remote).count();
        Ok(Overview {
            stale: branches.iter().filter(|b| !b.branch.remote && b.merged && b.worktree.is_none()).count(),
            dirty: worktrees.iter().map(|w| w.dirty).sum(),
            remote: branches.len() - local,
            local,
            base,
            worktrees,
            branches,
        })
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

#[derive(Serialize, Debug, Clone, Default)]
pub struct Worktree {
    pub name: String,
    pub path: String,
    pub branch: String,
    pub head: String,
    pub main: bool,
    pub current: bool,
    pub detached: bool,
    pub bare: bool,
    pub locked: bool,
    pub prunable: bool,
    pub dirty: usize,
}

#[derive(Serialize, Debug, Clone)]
pub struct OverviewBranch {
    #[serde(flatten)]
    pub branch: Branch,
    pub ahead: usize,
    pub behind: usize,
    pub merged: bool,
    pub worktree: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct Overview {
    pub base: String,
    pub local: usize,
    pub remote: usize,
    pub dirty: usize,
    /// merged local branches no worktree holds: safe to delete
    pub stale: usize,
    pub worktrees: Vec<Worktree>,
    pub branches: Vec<OverviewBranch>,
}

// –– Swarm saves (B2): object and worktree helpers used by the op log ––

/// Snapshot a worktree into a tree object without touching its HEAD, branch or
/// real index: a temporary `GIT_INDEX_FILE` gets `add -A`, then `write-tree`.
/// The snapshot is content addressed – same worktree state, same tree id.
pub fn commit_tree_temp_index(_repo: &Repo, wt: &Path) -> Result<String> {
    let tmp = std::env::temp_dir().join(format!(
        "kula-save-{}-{}.idx",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()
    ));
    let mut step = |args: &[&str]| -> Result<String> {
        let mut c = Command::new("git");
        c.arg("-C").arg(wt).env("GIT_INDEX_FILE", &tmp).env("GIT_TERMINAL_PROMPT", "0");
        let out = c.args(args).output().context("failed to run git")?;
        if !out.status.success() {
            bail!("git {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim());
        }
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    };
    let tree = step(&["add", "-A", "--", "."])
        .and_then(|_| step(&["write-tree"]))
        .map(|s| s.trim().to_string());
    let _ = std::fs::remove_file(&tmp);
    tree.with_context(|| format!("could not snapshot {}", wt.display()))
}

/// Commit an already-written tree (kula's identity, never the repo's config).
pub fn save_commit(repo: &Repo, tree: &str, message: &str) -> Result<String> {
    let out = repo
        .run(&["-c", "user.name=kula", "-c", "user.email=kula@localhost", "commit-tree", tree, "-m", message])?;
    Ok(out.trim().to_string())
}

/// Bring a worktree's index and files to `commit` without moving HEAD or its
/// branch: `read-tree -u --reset` updates tracked files, `clean` drops the
/// rest. Untracked `.kula/` bookkeeping stays.
pub fn reset_worktree_to(wt: &Path, commit: &str) -> Result<()> {
    validate_rev(commit)?;
    let r = Repo::discover(wt)?;
    r.run(&["read-tree", "-u", "--reset", commit])?;
    r.run(&["clean", "-fd", "--exclude=.kula"])?;
    Ok(())
}
