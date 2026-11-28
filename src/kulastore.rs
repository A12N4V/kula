//! The kulastore: agent memory, skills, config and extensions, versioned on
//! `refs/kula/store`.
//!
//! `refs/kula/setup` carries the shared setup a clone needs. The store goes
//! further: it keeps what agents write for themselves (Claude Code's project
//! memory lives outside the repo, per worktree), every agent's skill folder,
//! each agent's settings, and the extensions this repo installed or authored.
//! Refs are shared by every worktree, so one store sums them all: memory is
//! filed per worktree, everything else per path. Private until `kula store push`.
//!
//! Layout of the tree on the ref:
//!   memory/kula.json               kula's graph anchored memories (export only)
//!   memory/claude/<worktree>/…     Claude Code project memory for that worktree
//!   memory/local/<worktree>/…      CLAUDE.local.md and friends
//!   skills/<agent>/…               .agents/skills, .claude/skills, .gemini/skills, .cursor/rules
//!   config/<repo path>             kula.toml, instruction files, agent settings, MCP files
//!   extensions/<kind>/<name>/…     entries authored here (see `extensions.rs`)
//!
//! A snapshot replaces each source's subtree with what is on disk now; a source
//! missing on disk keeps its stored copy, so nothing is lost by snapshotting
//! from a worktree that lacks it.

use crate::git::Repo;
use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const REF: &str = "refs/kula/store";
const REMOTE: &str = "refs/kula/remote-store";
const MAX_FILE: u64 = 2 * 1024 * 1024;
const MAX_FILES: usize = 4000;
pub const SECTIONS: &[&str] = &["memory", "skills", "config", "extensions"];

/// Files under `config/`, by repo path.
const CONFIG_FILES: &[&str] = &[
    "kula.toml",
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    ".mcp.json",
    ".agents/mcp.json",
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".codex/config.toml",
    ".gemini/settings.json",
    ".cursor/mcp.json",
];
/// Folders under `config/`, by repo path.
const CONFIG_DIRS: &[&str] = &[".claude/agents", ".claude/commands", ".claude/rules", ".agents/prompts"];
const SKILL_DIRS: &[(&str, &str)] =
    &[("agents", ".agents/skills"), ("claude", ".claude/skills"), ("gemini", ".gemini/skills"), ("cursor", ".cursor/rules")];
const LOCAL_FILES: &[&str] = &["CLAUDE.local.md", "AGENTS.local.md"];

/// One place on disk the store mirrors.
#[derive(Debug, Clone, Serialize)]
pub struct Source {
    pub section: &'static str,
    /// Prefix in the store tree.
    pub prefix: String,
    pub live: PathBuf,
    pub dir: bool,
    /// Written by kula from other data; never restored.
    pub generated: bool,
}

/// The name a worktree is filed under: `main` for the main one, else its folder.
pub fn worktree_id(repo: &Repo) -> String {
    let common = repo.run(&["rev-parse", "--path-format=absolute", "--git-common-dir"]).unwrap_or_default();
    let gitdir = repo.run(&["rev-parse", "--path-format=absolute", "--git-dir"]).unwrap_or_default();
    if common.trim() == gitdir.trim() {
        "main".into()
    } else {
        safe(&repo.name())
    }
}

fn safe(s: &str) -> String {
    let t: String = s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '-' }).collect();
    let t = t.trim_matches('.').to_string();
    if t.is_empty() {
        "x".into()
    } else {
        t
    }
}

/// Claude Code keeps project memory in `~/.claude/projects/<slug>/memory`, the
/// slug being the project path with every other character turned into `-`.
pub fn claude_memory_dir(root: &Path) -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let slug: String = root.to_string_lossy().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    Some(PathBuf::from(home).join(".claude/projects").join(slug).join("memory"))
}

pub fn sources(repo: &Repo) -> Vec<Source> {
    let root = &repo.root;
    let wt = worktree_id(repo);
    let mut v = vec![Source {
        section: "memory",
        prefix: "memory/kula.json".into(),
        live: repo.kula_dir().join("memory.json"),
        dir: false,
        generated: true,
    }];
    if let Some(d) = claude_memory_dir(root) {
        v.push(Source { section: "memory", prefix: format!("memory/claude/{wt}"), live: d, dir: true, generated: false });
    }
    for f in LOCAL_FILES {
        v.push(Source { section: "memory", prefix: format!("memory/local/{wt}/{f}"), live: root.join(f), dir: false, generated: false });
    }
    for (agent, d) in SKILL_DIRS {
        v.push(Source { section: "skills", prefix: format!("skills/{agent}"), live: root.join(d), dir: true, generated: false });
    }
    for f in CONFIG_FILES {
        v.push(Source { section: "config", prefix: format!("config/{f}"), live: root.join(f), dir: false, generated: false });
    }
    for d in CONFIG_DIRS {
        v.push(Source { section: "config", prefix: format!("config/{d}"), live: root.join(d), dir: true, generated: false });
    }
    v.push(Source {
        section: "extensions",
        prefix: "extensions".into(),
        live: repo.kula_dir().join("extensions"),
        dir: true,
        generated: false,
    });
    v
}

/// Live files of a source: (store path, absolute path).
fn walk(s: &Source, out: &mut Vec<(String, PathBuf)>) {
    if !s.dir {
        if s.live.is_file() {
            out.push((s.prefix.clone(), s.live.clone()));
        }
        return;
    }
    fn rec(dir: &Path, rel: &str, depth: usize, out: &mut Vec<(String, PathBuf)>) {
        if depth > 8 || out.len() >= MAX_FILES {
            return;
        }
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        let mut es: Vec<_> = rd.flatten().collect();
        es.sort_by_key(|e| e.file_name());
        for e in es {
            let name = e.file_name().to_string_lossy().to_string();
            if name == ".DS_Store" || name == ".git" || name == "node_modules" {
                continue;
            }
            let Ok(ft) = e.file_type() else { continue };
            let r = format!("{rel}/{name}");
            if ft.is_dir() {
                rec(&e.path(), &r, depth + 1, out);
            } else if ft.is_file() && e.metadata().map(|m| m.len() <= MAX_FILE).unwrap_or(false) {
                out.push((r, e.path()));
            }
        }
    }
    rec(&s.live, &s.prefix, 0, out);
}

/// Write kula's own memories out so the store holds them next to the agents'.
fn export_kula_memory(repo: &Repo) -> Result<()> {
    let m = crate::meta::load(repo)?;
    let mems: Vec<_> = m.notes.into_iter().filter(|n| n.kind == "memory").collect();
    if mems.is_empty() {
        return Ok(());
    }
    std::fs::create_dir_all(repo.kula_dir())?;
    std::fs::write(repo.kula_dir().join("memory.json"), serde_json::to_vec_pretty(&mems)?)?;
    Ok(())
}

/// Store path -> (mode, blob) at `rev`, empty when the ref does not exist.
pub fn tree(repo: &Repo, rev: &str) -> Result<BTreeMap<String, (String, String)>> {
    let mut m = BTreeMap::new();
    if !exists(repo, rev) {
        return Ok(m);
    }
    for l in repo.run(&["ls-tree", "-r", "-z", rev])?.split('\0') {
        // "<mode> blob <sha>\t<path>"
        let Some((head, path)) = l.split_once('\t') else { continue };
        let f: Vec<&str> = head.split(' ').collect();
        if f.len() == 3 && f[1] == "blob" {
            m.insert(path.to_string(), (f[0].to_string(), f[2].to_string()));
        }
    }
    Ok(m)
}

fn exists(repo: &Repo, rev: &str) -> bool {
    repo.run(&["rev-parse", "--verify", "--quiet", &format!("{rev}^{{commit}}")]).map(|s| !s.trim().is_empty()).unwrap_or(false)
}

/// Hash files (optionally writing blobs) in one git process.
fn hash(repo: &Repo, paths: &[PathBuf], write: bool) -> Result<Vec<String>> {
    if paths.is_empty() {
        return Ok(vec![]);
    }
    let input: String = paths.iter().map(|p| format!("{}\n", p.display())).collect();
    let mut args = vec!["hash-object", "--no-filters", "--stdin-paths"];
    if write {
        args.insert(1, "-w");
    }
    let out = repo.run_stdin(&args, input.as_bytes())?;
    let v: Vec<String> = out.lines().map(String::from).collect();
    if v.len() != paths.len() {
        bail!("git hash-object returned {} hashes for {} files", v.len(), paths.len());
    }
    Ok(v)
}

/// A folder under the system temp dir, removed when dropped.
pub(crate) struct TempDir(PathBuf);
impl TempDir {
    pub(crate) fn new() -> Result<Self> {
        let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let p = std::env::temp_dir().join(format!("kula-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&p)?;
        Ok(TempDir(p))
    }
    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Build a tree object from a flat path map through a throwaway index.
fn write_tree(repo: &Repo, files: &BTreeMap<String, (String, String)>) -> Result<String> {
    let dir = TempDir::new()?;
    let idx = dir.path().join("index");
    let git = |args: &[&str], input: Option<&[u8]>| -> Result<String> {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let mut c = Command::new("git");
        c.arg("-C").arg(&repo.root).args(args).env("GIT_INDEX_FILE", &idx).stdout(Stdio::piped()).stderr(Stdio::piped());
        if input.is_some() {
            c.stdin(Stdio::piped());
        }
        let mut ch = c.spawn()?;
        if let Some(i) = input {
            ch.stdin.take().unwrap().write_all(i)?;
        }
        let o = ch.wait_with_output()?;
        if !o.status.success() {
            bail!("git {}: {}", args.join(" "), String::from_utf8_lossy(&o.stderr).trim());
        }
        Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
    };
    git(&["read-tree", "--empty"], None)?;
    let mut info = String::new();
    for (p, (mode, sha)) in files {
        info.push_str(&format!("{mode} {sha}\t{p}\n"));
    }
    if !info.is_empty() {
        git(&["update-index", "--add", "--index-info"], Some(info.as_bytes()))?;
    }
    git(&["write-tree"], None)
}

fn commit(repo: &Repo, tree: &str, parents: &[String], msg: &str) -> Result<String> {
    let mut args = vec!["commit-tree".to_string(), tree.to_string(), "-m".into(), format!("kula store: {msg}")];
    for p in parents {
        args.push("-p".into());
        args.push(p.clone());
    }
    Ok(repo.run(&args)?.trim().to_string())
}

fn head(repo: &Repo) -> Option<String> {
    exists(repo, REF).then(|| repo.run(&["rev-parse", REF]).ok().map(|s| s.trim().to_string())).flatten()
}

#[derive(Debug, Serialize, Default)]
pub struct Snapshot {
    pub commit: Option<String>,
    pub changed: usize,
    pub files: usize,
}

/// Commit what is on disk now for `only` sections (all when empty).
pub fn snapshot(repo: &Repo, only: &[String], msg: Option<&str>) -> Result<Snapshot> {
    for s in only {
        if !SECTIONS.contains(&s.as_str()) {
            bail!("unknown store section {s:?}; one of {}", SECTIONS.join(", "));
        }
    }
    let want = |sec: &str| only.is_empty() || only.iter().any(|o| o == sec);
    if want("memory") {
        export_kula_memory(repo)?;
    }
    let parent = head(repo);
    let mut files = match &parent {
        Some(p) => tree(repo, p)?,
        None => BTreeMap::new(),
    };
    let before = files.clone();
    for s in sources(repo).iter().filter(|s| want(s.section)) {
        let present = if s.dir { s.live.is_dir() } else { s.live.is_file() };
        if !present {
            continue;
        }
        let pre = format!("{}/", s.prefix);
        files.retain(|k, _| k != &s.prefix && !k.starts_with(&pre));
        let mut live = vec![];
        walk(s, &mut live);
        let shas = hash(repo, &live.iter().map(|(_, p)| p.clone()).collect::<Vec<_>>(), true)?;
        for ((path, abs), sha) in live.into_iter().zip(shas) {
            let mode = exec_mode(&abs);
            files.insert(path, (mode.into(), sha));
        }
    }
    let changed =
        files.iter().filter(|(k, v)| before.get(*k) != Some(v)).count() + before.keys().filter(|k| !files.contains_key(*k)).count();
    if changed == 0 && parent.is_some() {
        return Ok(Snapshot { commit: parent, changed: 0, files: files.len() });
    }
    if files.is_empty() {
        bail!("nothing to store: no agent memory, skills, config or extensions found");
    }
    let t = write_tree(repo, &files)?;
    let label = if only.is_empty() { "all".to_string() } else { only.join(", ") };
    let msg = msg.map(String::from).unwrap_or_else(|| format!("snapshot {label} from {} on {}", worktree_id(repo), repo.branch()));
    let c = commit(repo, &t, &parent.into_iter().collect::<Vec<_>>(), &msg)?;
    repo.run(&["update-ref", REF, &c])?;
    Ok(Snapshot { commit: Some(c), changed, files: files.len() })
}

#[cfg(unix)]
fn exec_mode(p: &Path) -> &'static str {
    use std::os::unix::fs::PermissionsExt;
    match std::fs::metadata(p) {
        Ok(m) if m.permissions().mode() & 0o111 != 0 => "100755",
        _ => "100644",
    }
}
#[cfg(not(unix))]
fn exec_mode(_: &Path) -> &'static str {
    "100644"
}

/// Where a store path lives on disk, if it maps to a restorable source.
fn live_of(srcs: &[Source], path: &str) -> Option<PathBuf> {
    if path.split('/').any(|c| c == ".." || c == ".git" || c.is_empty()) {
        return None;
    }
    // the longest matching prefix wins (config/.claude/agents over config/...)
    let s = srcs
        .iter()
        .filter(|s| !s.generated && (path == s.prefix || path.starts_with(&format!("{}/", s.prefix))))
        .max_by_key(|s| s.prefix.len())?;
    if path == s.prefix {
        return Some(s.live.clone());
    }
    Some(s.live.join(&path[s.prefix.len() + 1..]))
}

#[derive(Debug, Serialize)]
pub struct Entry {
    pub path: String,
    pub section: String,
    /// "same", "changed" (disk differs), "stored" (only in the store), "new" (only on disk)
    pub state: &'static str,
    pub live: Option<String>,
    pub restorable: bool,
}

/// Compare the store with disk, file by file.
pub fn status(repo: &Repo) -> Result<Vec<Entry>> {
    let srcs = sources(repo);
    let stored = match head(repo) {
        Some(h) => tree(repo, &h)?,
        None => BTreeMap::new(),
    };
    let mut live = vec![];
    for s in &srcs {
        walk(s, &mut live);
    }
    let shas = hash(repo, &live.iter().map(|(_, p)| p.clone()).collect::<Vec<_>>(), false)?;
    let mut out = vec![];
    let mut seen = std::collections::HashSet::new();
    for ((path, abs), sha) in live.into_iter().zip(shas) {
        let state = match stored.get(&path) {
            Some((_, s)) if *s == sha => "same",
            Some(_) => "changed",
            None => "new",
        };
        seen.insert(path.clone());
        out.push(Entry {
            section: section_of(&path),
            restorable: live_of(&srcs, &path).is_some(),
            path,
            state,
            live: Some(abs.display().to_string()),
        });
    }
    for path in stored.keys().filter(|p| !seen.contains(*p)) {
        let l = live_of(&srcs, path);
        out.push(Entry {
            section: section_of(path),
            state: "stored",
            restorable: l.is_some(),
            live: l.map(|p| p.display().to_string()),
            path: path.clone(),
        });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

fn section_of(p: &str) -> String {
    p.split('/').next().unwrap_or("").to_string()
}

pub fn show(repo: &Repo, path: &str, rev: Option<&str>) -> Result<String> {
    let rev = rev.unwrap_or(REF);
    crate::git::validate_rev(rev)?;
    if path.split('/').any(|c| c == "..") {
        bail!("bad store path");
    }
    repo.run(&["show", &format!("{rev}:{path}")])
}

#[derive(Debug, Serialize)]
pub struct LogEntry {
    pub sha: String,
    pub time: i64,
    pub subject: String,
    pub files: usize,
}

pub fn log(repo: &Repo, limit: usize) -> Result<Vec<LogEntry>> {
    if head(repo).is_none() {
        return Ok(vec![]);
    }
    let raw = repo.run(&["log", &format!("-{}", limit.clamp(1, 200)), "--format=%x1e%H%x1f%ct%x1f%s", "--name-only", REF])?;
    Ok(raw
        .split('\x1e')
        .filter_map(|c| {
            let mut lines = c.lines();
            let f: Vec<&str> = lines.next()?.split('\x1f').collect();
            if f.len() < 3 {
                return None;
            }
            Some(LogEntry {
                sha: f[0].into(),
                time: f[1].parse().unwrap_or(0),
                subject: f[2].trim_start_matches("kula store: ").into(),
                files: lines.filter(|l| !l.trim().is_empty()).count(),
            })
        })
        .collect())
}

#[derive(Debug, Serialize, Default)]
pub struct Restored {
    pub written: Vec<String>,
    pub kept: Vec<String>,
}

/// Write stored files back to disk. `paths` are store paths or prefixes (all
/// when empty). A file changed on disk is kept unless `overwrite`.
pub fn restore(repo: &Repo, paths: &[String], rev: Option<&str>, overwrite: bool) -> Result<Restored> {
    let rev = rev.unwrap_or(REF);
    crate::git::validate_rev(rev)?;
    let srcs = sources(repo);
    let files = tree(repo, rev)?;
    let mut r = Restored::default();
    for (path, (_, sha)) in &files {
        if !paths.is_empty() && !paths.iter().any(|p| path == p || path.starts_with(&format!("{}/", p.trim_end_matches('/')))) {
            continue;
        }
        let Some(dst) = live_of(&srcs, path) else { continue };
        let blob = std::process::Command::new("git").arg("-C").arg(&repo.root).args(["cat-file", "blob", sha]).output()?;
        if !blob.status.success() {
            bail!("missing blob {sha} for {path}");
        }
        match std::fs::read(&dst) {
            Ok(cur) if cur == blob.stdout => continue,
            Ok(_) if !overwrite => {
                r.kept.push(path.clone());
                continue;
            }
            _ => {}
        }
        if let Some(d) = dst.parent() {
            std::fs::create_dir_all(d).with_context(|| format!("create {}", d.display()))?;
        }
        std::fs::write(&dst, &blob.stdout)?;
        r.written.push(path.clone());
    }
    Ok(r)
}

/// Fetch the remote store and merge it: union of files, ours wins a clash.
pub fn pull(repo: &Repo, remote: &str) -> Result<String> {
    crate::git::validate_rev(remote)?;
    if repo.run(&["fetch", remote, &format!("+{REF}:{REMOTE}")]).is_err() {
        return Ok("remote has no kula store yet".into());
    }
    let theirs = repo.run(&["rev-parse", REMOTE])?.trim().to_string();
    let Some(ours) = head(repo) else {
        repo.run(&["update-ref", REF, &theirs])?;
        return Ok("fetched the remote store".into());
    };
    let anc = |a: &str, b: &str| repo.run(&["merge-base", "--is-ancestor", a, b]).is_ok();
    if anc(&theirs, &ours) {
        return Ok("store already up to date".into());
    }
    if anc(&ours, &theirs) {
        repo.run(&["update-ref", REF, &theirs])?;
        return Ok("fast forwarded the store".into());
    }
    let mut files = tree(repo, &theirs)?;
    files.extend(tree(repo, &ours)?);
    let t = write_tree(repo, &files)?;
    let c = commit(repo, &t, &[ours, theirs], &format!("merge {remote}"))?;
    repo.run(&["update-ref", REF, &c])?;
    Ok(format!("merged the store from {remote}"))
}

pub fn push(repo: &Repo, remote: &str) -> Result<String> {
    crate::git::validate_rev(remote)?;
    if head(repo).is_none() {
        bail!("the store is empty; run `kula store snapshot` first");
    }
    if let Err(e) = repo.run(&["push", remote, &format!("{REF}:{REF}")]) {
        bail!("{e}\nthe remote store moved on; run `kula store pull {remote}` first");
    }
    Ok(format!("pushed {REF} to {remote}"))
}

/// Put one file straight into the store (used by extensions authored here).
pub fn put(repo: &Repo, files_in: &[(String, Vec<u8>)], remove_prefix: Option<&str>, msg: &str) -> Result<String> {
    let parent = head(repo);
    let mut files = match &parent {
        Some(p) => tree(repo, p)?,
        None => BTreeMap::new(),
    };
    if let Some(pre) = remove_prefix {
        let pp = format!("{pre}/");
        files.retain(|k, _| k != pre && !k.starts_with(&pp));
    }
    for (path, data) in files_in {
        if path.split('/').any(|c| c == ".." || c.is_empty()) {
            bail!("bad store path {path:?}");
        }
        let sha = repo.run_stdin(&["hash-object", "-w", "--stdin"], data)?.trim().to_string();
        files.insert(path.clone(), ("100644".into(), sha));
    }
    let t = write_tree(repo, &files)?;
    let c = commit(repo, &t, &parent.into_iter().collect::<Vec<_>>(), msg)?;
    repo.run(&["update-ref", REF, &c])?;
    Ok(c)
}

#[derive(Debug, Serialize)]
pub struct Summary {
    pub head: Option<String>,
    pub worktree: String,
    pub sections: BTreeMap<String, usize>,
    pub changed: usize,
    pub commits: usize,
}

pub fn summary(repo: &Repo) -> Result<Summary> {
    let st = status(repo)?;
    let mut sections = BTreeMap::new();
    for e in st.iter().filter(|e| e.state != "new") {
        *sections.entry(e.section.clone()).or_insert(0) += 1;
    }
    let commits = head(repo).and_then(|_| repo.run(&["rev-list", "--count", REF]).ok()).and_then(|s| s.trim().parse().ok()).unwrap_or(0);
    Ok(Summary {
        head: head(repo),
        worktree: worktree_id(repo),
        sections,
        changed: st.iter().filter(|e| e.state == "changed" || e.state == "new").count(),
        commits,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn repo() -> (tempfile::TempDir, Repo) {
        let d = tempfile::tempdir().unwrap();
        let g = |a: &[&str]| assert!(Command::new("git").arg("-C").arg(d.path()).args(a).output().unwrap().status.success());
        g(&["init", "-q"]);
        g(&["config", "user.email", "t@t"]);
        g(&["config", "user.name", "t"]);
        std::fs::write(d.path().join("a"), "a").unwrap();
        g(&["add", "a"]);
        g(&["commit", "-qm", "a"]);
        let r = Repo { root: d.path().canonicalize().unwrap() };
        (d, r)
    }

    #[test]
    fn snapshot_status_restore_round_trip() {
        let (_d, r) = repo();
        std::fs::create_dir_all(r.root.join(".agents/skills/triage")).unwrap();
        std::fs::write(r.root.join(".agents/skills/triage/SKILL.md"), "one").unwrap();
        std::fs::write(r.root.join("kula.toml"), "[project]\n").unwrap();
        let s = snapshot(&r, &["skills".into(), "config".into()], None).unwrap();
        assert!(s.commit.is_some());
        assert_eq!(s.files, 2);
        // same content again is not a new commit
        assert_eq!(snapshot(&r, &[], None).unwrap().changed, 0);
        std::fs::write(r.root.join(".agents/skills/triage/SKILL.md"), "two").unwrap();
        let st = status(&r).unwrap();
        assert_eq!(st.iter().find(|e| e.path == "skills/agents/triage/SKILL.md").unwrap().state, "changed");
        let k = restore(&r, &["skills".into()], None, false).unwrap();
        assert_eq!(k.kept, vec!["skills/agents/triage/SKILL.md".to_string()]);
        restore(&r, &["skills".into()], None, true).unwrap();
        assert_eq!(std::fs::read_to_string(r.root.join(".agents/skills/triage/SKILL.md")).unwrap(), "one");
        // a source missing on disk keeps its stored copy
        std::fs::remove_file(r.root.join("kula.toml")).unwrap();
        snapshot(&r, &[], None).unwrap();
        assert!(tree(&r, REF).unwrap().contains_key("config/kula.toml"));
        assert_eq!(log(&r, 10).unwrap().len(), 1);
    }

    #[test]
    fn put_and_paths_never_escape() {
        let (_d, r) = repo();
        put(&r, &[("extensions/prompt/x/PROMPT.md".into(), b"hi".to_vec())], None, "add x").unwrap();
        assert_eq!(show(&r, "extensions/prompt/x/PROMPT.md", None).unwrap(), "hi");
        assert!(put(&r, &[("../evil".into(), vec![])], None, "x").is_err());
        assert!(live_of(&sources(&r), "config/../../etc").is_none());
    }
}
