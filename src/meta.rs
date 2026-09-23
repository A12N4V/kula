//! Issues, proposals (local pull requests) and notes – stored *inside git*.
//!
//! Everything lives in a single JSON document committed to `refs/kula/meta`.
//! Each change is a new commit on that ref, so the history is auditable and
//! `git push origin refs/kula/meta` shares it with collaborators – no server.

use crate::git::{validate_rev, Repo};
use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};

pub const REF: &str = "refs/kula/meta";
const FILE: &str = "kula.json";

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct Meta {
    #[serde(default)]
    pub next_id: u64,
    #[serde(default)]
    pub issues: Vec<Issue>,
    #[serde(default)]
    pub proposals: Vec<Proposal>,
    #[serde(default)]
    pub notes: Vec<Note>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Comment {
    pub author: String,
    pub body: String,
    pub at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Issue {
    pub id: u64,
    pub title: String,
    #[serde(default)]
    pub body: String,
    pub status: String, // open | closed
    #[serde(default)]
    pub labels: Vec<String>,
    /// Symbols/files this issue is about, e.g. "src/git.rs:status".
    #[serde(default)]
    pub anchors: Vec<String>,
    pub author: String,
    pub created: i64,
    #[serde(default)]
    pub comments: Vec<Comment>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Proposal {
    pub id: u64,
    pub title: String,
    #[serde(default)]
    pub body: String,
    pub base: String,
    pub head: String,
    pub status: String, // open | merged | closed
    pub author: String,
    pub created: i64,
    #[serde(default)]
    pub comments: Vec<Comment>,
    #[serde(default)]
    pub merged_sha: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Note {
    pub id: u64,
    /// `repo`, `file:<path>`, `symbol:<path>:<name>`, `commit:<sha>`, `community:<label>`.
    pub target: String,
    pub body: String,
    pub author: String,
    pub created: i64,
    pub updated: i64,
}

pub fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

pub fn load(repo: &Repo) -> Result<Meta> {
    match repo.run(&["show", &format!("{REF}:{FILE}")]) {
        Ok(s) => Ok(serde_json::from_str(&s)?),
        Err(_) => Ok(Meta::default()),
    }
}

/// Commit a new version of the metadata document onto `refs/kula/meta`.
pub fn save(repo: &Repo, meta: &Meta, message: &str) -> Result<()> {
    let json = serde_json::to_vec_pretty(meta)?;
    let blob = repo.run_stdin(&["hash-object", "-w", "--stdin"], &json)?.trim().to_string();
    let tree = repo.run_stdin(&["mktree"], format!("100644 blob {blob}\t{FILE}\n").as_bytes())?.trim().to_string();
    let parent = repo.run(&["rev-parse", "--verify", "--quiet", REF]).ok().map(|s| s.trim().to_string());
    let mut args = vec!["commit-tree".to_string(), tree, "-m".into(), format!("kula: {message}")];
    if let Some(p) = parent.as_ref().filter(|p| !p.is_empty()) {
        args.push("-p".into());
        args.push(p.clone());
    }
    let commit = repo.run(&args)?.trim().to_string();
    repo.run(&["update-ref", REF, &commit])?;
    Ok(())
}

fn next(meta: &mut Meta) -> u64 {
    meta.next_id += 1;
    meta.next_id
}

pub fn issue_new(repo: &Repo, title: &str, body: &str, labels: Vec<String>, anchors: Vec<String>) -> Result<Issue> {
    let mut m = load(repo)?;
    let issue = Issue {
        id: next(&mut m),
        title: title.into(),
        body: body.into(),
        status: "open".into(),
        labels,
        anchors,
        author: repo.user(),
        created: now(),
        comments: vec![],
    };
    m.issues.push(issue.clone());
    save(repo, &m, &format!("open issue #{} {}", issue.id, title))?;
    Ok(issue)
}

pub fn issue_set_status(repo: &Repo, id: u64, status: &str) -> Result<Issue> {
    let mut m = load(repo)?;
    let i = m.issues.iter_mut().find(|i| i.id == id).ok_or_else(|| anyhow!("no issue #{id}"))?;
    i.status = status.into();
    let out = i.clone();
    save(repo, &m, &format!("{status} issue #{id}"))?;
    Ok(out)
}

pub fn comment(repo: &Repo, id: u64, body: &str) -> Result<()> {
    let mut m = load(repo)?;
    let c = Comment { author: repo.user(), body: body.into(), at: now() };
    if let Some(i) = m.issues.iter_mut().find(|i| i.id == id) {
        i.comments.push(c);
    } else if let Some(p) = m.proposals.iter_mut().find(|p| p.id == id) {
        p.comments.push(c);
    } else {
        bail!("no issue or proposal #{id}");
    }
    save(repo, &m, &format!("comment on #{id}"))
}

pub fn proposal_new(repo: &Repo, title: &str, body: &str, base: &str, head: &str) -> Result<Proposal> {
    validate_rev(base)?;
    validate_rev(head)?;
    repo.run(&["rev-parse", "--verify", base]).map_err(|_| anyhow!("unknown base {base}"))?;
    repo.run(&["rev-parse", "--verify", head]).map_err(|_| anyhow!("unknown head {head}"))?;
    let mut m = load(repo)?;
    let p = Proposal {
        id: next(&mut m),
        title: title.into(),
        body: body.into(),
        base: base.into(),
        head: head.into(),
        status: "open".into(),
        author: repo.user(),
        created: now(),
        comments: vec![],
        merged_sha: None,
    };
    m.proposals.push(p.clone());
    save(repo, &m, &format!("propose #{} {head} → {base}", p.id))?;
    Ok(p)
}

pub fn proposal_set_status(repo: &Repo, id: u64, status: &str) -> Result<Proposal> {
    let mut m = load(repo)?;
    let p = m.proposals.iter_mut().find(|p| p.id == id).ok_or_else(|| anyhow!("no proposal #{id}"))?;
    p.status = status.into();
    let out = p.clone();
    save(repo, &m, &format!("{status} proposal #{id}"))?;
    Ok(out)
}

/// Merge a proposal: switch to base, `git merge --no-ff head`, record the result.
pub fn proposal_merge(repo: &Repo, id: u64) -> Result<Proposal> {
    let m = load(repo)?;
    let p = m.proposals.iter().find(|p| p.id == id).ok_or_else(|| anyhow!("no proposal #{id}"))?.clone();
    if p.status != "open" {
        bail!("proposal #{id} is {}", p.status);
    }
    if !repo.is_clean() {
        bail!("working tree has uncommitted changes – commit or stash them first");
    }
    if repo.branch() != p.base {
        repo.run(&["switch", &p.base])?;
    }
    let msg = format!("Merge proposal #{id}: {}\n\n{} → {}", p.title, p.head, p.base);
    if let Err(e) = repo.run(&["merge", "--no-ff", "-m", &msg, &p.head]) {
        let _ = repo.run(&["merge", "--abort"]);
        bail!("merge failed and was aborted: {e}");
    }
    let sha = repo.head();
    let mut m = load(repo)?;
    let p = m.proposals.iter_mut().find(|p| p.id == id).unwrap();
    p.status = "merged".into();
    p.merged_sha = sha;
    let out = p.clone();
    save(repo, &m, &format!("merge proposal #{id}"))?;
    Ok(out)
}

pub fn note_add(repo: &Repo, target: &str, body: &str) -> Result<Note> {
    let mut m = load(repo)?;
    let t = now();
    let n = Note { id: next(&mut m), target: target.into(), body: body.into(), author: repo.user(), created: t, updated: t };
    m.notes.push(n.clone());
    save(repo, &m, &format!("note #{} on {target}", n.id))?;
    Ok(n)
}

pub fn note_edit(repo: &Repo, id: u64, body: &str) -> Result<Note> {
    let mut m = load(repo)?;
    let n = m.notes.iter_mut().find(|n| n.id == id).ok_or_else(|| anyhow!("no note #{id}"))?;
    n.body = body.into();
    n.updated = now();
    let out = n.clone();
    save(repo, &m, &format!("edit note #{id}"))?;
    Ok(out)
}

pub fn note_rm(repo: &Repo, id: u64) -> Result<()> {
    let mut m = load(repo)?;
    let before = m.notes.len();
    m.notes.retain(|n| n.id != id);
    if m.notes.len() == before {
        bail!("no note #{id}");
    }
    save(repo, &m, &format!("remove note #{id}"))
}

/// Share metadata with a remote (fetch + push the meta ref).
pub fn sync(repo: &Repo, remote: &str) -> Result<String> {
    validate_rev(remote)?;
    let mut log = String::new();
    // Fetch theirs into a side ref and fast-forward if we have nothing local.
    match repo.run(&["fetch", remote, &format!("+{REF}:refs/kula/remote-meta")]) {
        Ok(_) => {
            let local = repo.run(&["rev-parse", "--verify", "--quiet", REF]).ok();
            if local.as_deref().map(str::trim).unwrap_or("").is_empty() {
                repo.run(&["update-ref", REF, "refs/kula/remote-meta"])?;
                log.push_str("fetched remote metadata\n");
            } else {
                // Merge by union: keep every item, newer wins on id clash.
                let theirs: Meta = serde_json::from_str(&repo.run(&["show", &format!("refs/kula/remote-meta:{FILE}")])?)?;
                let mut ours = load(repo)?;
                merge_meta(&mut ours, theirs);
                save(repo, &ours, "sync")?;
                log.push_str("merged remote metadata\n");
            }
        }
        Err(_) => log.push_str("remote has no kula metadata yet\n"),
    }
    repo.run(&["push", remote, &format!("{REF}:{REF}")])?;
    log.push_str("pushed refs/kula/meta\n");
    Ok(log)
}

fn merge_meta(ours: &mut Meta, theirs: Meta) {
    ours.next_id = ours.next_id.max(theirs.next_id);
    for i in theirs.issues {
        if !ours.issues.iter().any(|o| o.id == i.id && o.created == i.created) {
            ours.issues.push(i);
        }
    }
    for p in theirs.proposals {
        if !ours.proposals.iter().any(|o| o.id == p.id && o.created == p.created) {
            ours.proposals.push(p);
        }
    }
    for n in theirs.notes {
        match ours.notes.iter_mut().find(|o| o.id == n.id && o.created == n.created) {
            Some(o) if n.updated > o.updated => *o = n,
            Some(_) => {}
            None => ours.notes.push(n),
        }
    }
}
