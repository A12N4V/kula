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
    /// Orchestration plans by id, newest last, as `kula plan` and `kula run-plan` left them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub plans: Vec<serde_json::Value>,
    /// Hub canvas positions by node id (`seat:team/key`, `team:name`), so moving
    /// a node never touches the working tree.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub layout: std::collections::BTreeMap<String, [f64; 2]>,
    /// Run ledgers (`crate::launch::Run`), newest last, the last 200 kept.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub runs: Vec<serde_json::Value>,
    /// Issue templates, the label set and milestones.
    #[serde(default, skip_serializing_if = "IssueConfig::is_empty")]
    pub issue_config: IssueConfig,
}

/// How issues are filed and sorted: templates, labels and milestones.
#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
pub struct IssueConfig {
    #[serde(default)]
    pub templates: Vec<IssueTemplate>,
    #[serde(default)]
    pub labels: Vec<LabelDef>,
    #[serde(default)]
    pub milestones: Vec<Milestone>,
    /// Who may be assigned, besides anyone already named on an issue.
    #[serde(default)]
    pub people: Vec<String>,
}

impl IssueConfig {
    pub fn is_empty(&self) -> bool {
        self.templates.is_empty() && self.labels.is_empty() && self.milestones.is_empty() && self.people.is_empty()
    }
}

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
pub struct IssueTemplate {
    pub name: String,
    #[serde(default)]
    pub about: String,
    /// Prefilled title, e.g. "bug: ".
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub assignees: Vec<String>,
    #[serde(default)]
    pub priority: String,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
pub struct LabelDef {
    pub name: String,
    /// `#rrggbb`.
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
pub struct Milestone {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// Unix seconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due: Option<i64>,
    /// open | closed
    #[serde(default = "open")]
    pub state: String,
}

fn open() -> String {
    "open".into()
}

/// One line of an issue's timeline: who changed what, when.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct IssueEvent {
    pub by: String,
    pub at: i64,
    pub what: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Comment {
    pub author: String,
    pub body: String,
    pub at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edited: Option<i64>,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub assignees: Vec<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub milestone: String,
    /// "" | urgent | high | medium | low
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub priority: String,
    /// Why it closed: completed | not_planned | duplicate.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub reason: String,
    /// Linked work: `proposal:3`, `issue:5`, `branch:name`, `commit:sha`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub locked: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub pinned: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub template: String,
    #[serde(default)]
    pub updated: i64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub events: Vec<IssueEvent>,
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
    /// "" for a person's note, "memory" for an agent's memory (see `memory.rs`).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub kind: String,
    /// For memories: a hash of the target's source when it was written, so a
    /// later change to that code marks the memory stale.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<String>,
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
        assignees: vec![],
        milestone: String::new(),
        priority: String::new(),
        reason: String::new(),
        links: vec![],
        locked: false,
        pinned: false,
        template: String::new(),
        updated: now(),
        events: vec![],
    };
    m.issues.push(issue.clone());
    save(repo, &m, &format!("open issue #{} {}", issue.id, title))?;
    Ok(issue)
}

pub fn issue_set_status(repo: &Repo, id: u64, status: &str) -> Result<Issue> {
    let mut m = load(repo)?;
    let i = m.issues.iter_mut().find(|i| i.id == id).ok_or_else(|| anyhow!("no issue #{id}"))?;
    i.status = status.into();
    if status == "open" {
        i.reason.clear();
    }
    i.updated = now();
    i.events.push(IssueEvent { by: repo.user(), at: now(), what: format!("{status} the issue") });
    let out = i.clone();
    save(repo, &m, &format!("{status} issue #{id}"))?;
    Ok(out)
}

pub fn comment(repo: &Repo, id: u64, body: &str) -> Result<()> {
    let mut m = load(repo)?;
    let c = Comment { author: repo.user(), body: body.into(), at: now(), edited: None };
    if let Some(i) = m.issues.iter_mut().find(|i| i.id == id) {
        if i.locked {
            bail!("issue #{id} is locked");
        }
        i.updated = now();
        i.comments.push(c);
    } else if let Some(p) = m.proposals.iter_mut().find(|p| p.id == id) {
        p.comments.push(c);
    } else {
        bail!("no issue or proposal #{id}");
    }
    save(repo, &m, &format!("comment on #{id}"))
}

/// A change to one or more issues; `None` leaves a field as it is. Labels and
/// assignees may also be added or removed one at a time, for bulk edits.
#[derive(Deserialize, Default, Clone, Debug)]
pub struct IssuePatch {
    pub title: Option<String>,
    pub body: Option<String>,
    pub status: Option<String>,
    pub reason: Option<String>,
    pub labels: Option<Vec<String>>,
    #[serde(default)]
    pub add_labels: Vec<String>,
    #[serde(default)]
    pub remove_labels: Vec<String>,
    pub assignees: Option<Vec<String>>,
    #[serde(default)]
    pub add_assignees: Vec<String>,
    #[serde(default)]
    pub remove_assignees: Vec<String>,
    pub milestone: Option<String>,
    pub priority: Option<String>,
    pub anchors: Option<Vec<String>>,
    pub links: Option<Vec<String>>,
    pub locked: Option<bool>,
    pub pinned: Option<bool>,
}

const PRIORITIES: &[&str] = &["", "urgent", "high", "medium", "low"];
const REASONS: &[&str] = &["", "completed", "not_planned", "duplicate"];

fn clean(v: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for x in v.into_iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()) {
        if !out.contains(&x) {
            out.push(x);
        }
    }
    out
}

/// Apply `p` to issue `i`, returning a timeline line per real change.
fn apply_patch(i: &mut Issue, p: &IssuePatch) -> Result<Vec<String>> {
    let mut log = vec![];
    if let Some(t) = p.title.as_ref().map(|t| t.trim()).filter(|t| !t.is_empty() && *t != i.title) {
        log.push(format!("renamed from \"{}\"", i.title));
        i.title = t.into();
    }
    if let Some(b) = p.body.as_ref().filter(|b| **b != i.body) {
        i.body = b.clone();
        log.push("edited the description".into());
    }
    if let Some(r) = &p.reason {
        if !REASONS.contains(&r.as_str()) {
            bail!("unknown close reason {r}");
        }
    }
    if let Some(st) = &p.status {
        if st != "open" && st != "closed" {
            bail!("status is open or closed, not {st}");
        }
        if *st != i.status {
            i.status = st.clone();
            if st == "open" {
                i.reason.clear();
            }
            log.push(if st == "open" { "reopened".into() } else { format!("closed{}", p.reason.as_ref().filter(|r| !r.is_empty()).map(|r| format!(" as {}", r.replace('_', " "))).unwrap_or_default()) });
        }
    }
    if let Some(r) = p.reason.as_ref().filter(|_| i.status == "closed") {
        i.reason = r.clone();
    }
    let mut labels = p.labels.clone().map(clean).unwrap_or_else(|| i.labels.clone());
    labels.extend(clean(p.add_labels.clone()).into_iter().filter(|l| !i.labels.contains(l)));
    labels.retain(|l| !p.remove_labels.contains(l));
    let labels = clean(labels);
    if labels != i.labels {
        log.push(format!("set labels to {}", if labels.is_empty() { "none".into() } else { labels.join(", ") }));
        i.labels = labels;
    }
    let mut who = p.assignees.clone().map(clean).unwrap_or_else(|| i.assignees.clone());
    who.extend(clean(p.add_assignees.clone()));
    who.retain(|a| !p.remove_assignees.contains(a));
    let who = clean(who);
    if who != i.assignees {
        log.push(if who.is_empty() { "unassigned everyone".into() } else { format!("assigned {}", who.join(", ")) });
        i.assignees = who;
    }
    if let Some(ms) = p.milestone.as_ref().map(|m| m.trim().to_string()).filter(|m| *m != i.milestone) {
        log.push(if ms.is_empty() { "cleared the milestone".into() } else { format!("moved to milestone {ms}") });
        i.milestone = ms;
    }
    if let Some(pr) = p.priority.as_ref().filter(|pr| **pr != i.priority) {
        if !PRIORITIES.contains(&pr.as_str()) {
            bail!("unknown priority {pr}");
        }
        log.push(if pr.is_empty() { "cleared the priority".into() } else { format!("set priority {pr}") });
        i.priority = pr.clone();
    }
    if let Some(a) = p.anchors.clone().map(clean).filter(|a| *a != i.anchors) {
        log.push("changed the anchors".into());
        i.anchors = a;
    }
    if let Some(l) = p.links.clone().map(clean).filter(|l| *l != i.links) {
        log.push(format!("linked {}", if l.is_empty() { "nothing".into() } else { l.join(", ") }));
        i.links = l;
    }
    if let Some(v) = p.locked.filter(|v| *v != i.locked) {
        i.locked = v;
        log.push(if v { "locked the thread".into() } else { "unlocked the thread".into() });
    }
    if let Some(v) = p.pinned.filter(|v| *v != i.pinned) {
        i.pinned = v;
        log.push(if v { "pinned".into() } else { "unpinned".into() });
    }
    Ok(log)
}

/// Change several issues at once; one commit on the meta ref.
pub fn issue_patch(repo: &Repo, ids: &[u64], p: &IssuePatch) -> Result<Vec<Issue>> {
    anyhow::ensure!(!ids.is_empty(), "no issues given");
    let mut m = load(repo)?;
    let (by, at) = (repo.user(), now());
    let mut out = vec![];
    for id in ids {
        let i = m.issues.iter_mut().find(|i| i.id == *id).ok_or_else(|| anyhow!("no issue #{id}"))?;
        for what in apply_patch(i, p)? {
            i.events.push(IssueEvent { by: by.clone(), at, what });
            i.updated = at;
        }
        out.push(i.clone());
    }
    let list = ids.iter().map(|i| format!("#{i}")).collect::<Vec<_>>().join(" ");
    save(repo, &m, &format!("edit issue {list}"))?;
    Ok(out)
}

/// A new issue with every field, usually from a template.
#[derive(Deserialize, Default, Clone, Debug)]
pub struct IssueDraft {
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub anchors: Vec<String>,
    #[serde(default)]
    pub assignees: Vec<String>,
    #[serde(default)]
    pub milestone: String,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub links: Vec<String>,
    #[serde(default)]
    pub template: String,
}

pub fn issue_create(repo: &Repo, d: IssueDraft) -> Result<Issue> {
    let title = d.title.trim();
    anyhow::ensure!(!title.is_empty(), "an issue needs a title");
    anyhow::ensure!(PRIORITIES.contains(&d.priority.as_str()), "unknown priority {}", d.priority);
    let mut m = load(repo)?;
    let t = now();
    let issue = Issue {
        id: next(&mut m),
        title: title.into(),
        body: d.body,
        status: "open".into(),
        labels: clean(d.labels),
        anchors: clean(d.anchors),
        author: repo.user(),
        created: t,
        comments: vec![],
        assignees: clean(d.assignees),
        milestone: d.milestone.trim().into(),
        priority: d.priority,
        reason: String::new(),
        links: clean(d.links),
        locked: false,
        pinned: false,
        template: d.template.clone(),
        updated: t,
        events: vec![IssueEvent { by: repo.user(), at: t, what: if d.template.is_empty() { "opened".into() } else { format!("opened from {}", d.template) } }],
    };
    m.issues.push(issue.clone());
    save(repo, &m, &format!("open issue #{} {}", issue.id, title))?;
    Ok(issue)
}

/// Edit (Some) or delete (None) comment `idx` of issue `id`.
pub fn issue_comment_edit(repo: &Repo, id: u64, idx: usize, body: Option<&str>) -> Result<Issue> {
    let mut m = load(repo)?;
    let i = m.issues.iter_mut().find(|i| i.id == id).ok_or_else(|| anyhow!("no issue #{id}"))?;
    anyhow::ensure!(idx < i.comments.len(), "issue #{id} has no comment {idx}");
    match body {
        Some(b) => {
            i.comments[idx].body = b.into();
            i.comments[idx].edited = Some(now());
        }
        None => {
            i.comments.remove(idx);
            i.events.push(IssueEvent { by: repo.user(), at: now(), what: "deleted a comment".into() });
        }
    }
    i.updated = now();
    let out = i.clone();
    save(repo, &m, &format!("edit comment on #{id}"))?;
    Ok(out)
}

pub fn issue_delete(repo: &Repo, ids: &[u64]) -> Result<usize> {
    let mut m = load(repo)?;
    let before = m.issues.len();
    m.issues.retain(|i| !ids.contains(&i.id));
    let n = before - m.issues.len();
    anyhow::ensure!(n > 0, "no such issues");
    save(repo, &m, &format!("delete {n} issue(s)"))?;
    Ok(n)
}

/// Replace templates, labels, milestones and people. Renamed labels or
/// milestones are carried onto the issues that used the old name.
pub fn issue_config_save(repo: &Repo, mut cfg: IssueConfig, renames: &[(String, String, String)]) -> Result<IssueConfig> {
    for t in &mut cfg.templates {
        t.name = t.name.trim().into();
        anyhow::ensure!(!t.name.is_empty(), "every template needs a name");
        anyhow::ensure!(PRIORITIES.contains(&t.priority.as_str()), "unknown priority {}", t.priority);
        t.labels = clean(std::mem::take(&mut t.labels));
    }
    for l in &mut cfg.labels {
        l.name = l.name.trim().into();
        anyhow::ensure!(!l.name.is_empty(), "every label needs a name");
        anyhow::ensure!(l.color.is_empty() || (l.color.len() == 7 && l.color.starts_with('#') && l.color[1..].chars().all(|c| c.is_ascii_hexdigit())), "label colour {} is not #rrggbb", l.color);
    }
    for ms in &mut cfg.milestones {
        ms.name = ms.name.trim().into();
        anyhow::ensure!(!ms.name.is_empty(), "every milestone needs a name");
        anyhow::ensure!(ms.state == "open" || ms.state == "closed", "milestone state is open or closed");
    }
    for (what, list) in [("template", cfg.templates.iter().map(|x| &x.name).collect::<Vec<_>>()), ("label", cfg.labels.iter().map(|x| &x.name).collect()), ("milestone", cfg.milestones.iter().map(|x| &x.name).collect())] {
        let mut seen = std::collections::HashSet::new();
        for n in list {
            anyhow::ensure!(seen.insert(n.to_lowercase()), "two {what}s are named {n}");
        }
    }
    cfg.people = clean(std::mem::take(&mut cfg.people));
    let mut m = load(repo)?;
    for (kind, from, to) in renames {
        for i in &mut m.issues {
            match kind.as_str() {
                "label" => {
                    for l in &mut i.labels {
                        if l == from {
                            *l = to.clone();
                        }
                    }
                    i.labels = clean(std::mem::take(&mut i.labels));
                }
                "milestone" if i.milestone == *from => i.milestone = to.clone(),
                _ => {}
            }
        }
    }
    m.issue_config = cfg.clone();
    save(repo, &m, "issue settings")?;
    Ok(cfg)
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
    let n = Note {
        id: next(&mut m),
        kind: String::new(),
        anchor: None,
        target: target.into(),
        body: body.into(),
        author: repo.user(),
        created: t,
        updated: t,
    };
    m.notes.push(n.clone());
    save(repo, &m, &format!("note #{} on {target}", n.id))?;
    Ok(n)
}

/// Save an agent memory: a note of kind "memory", authored by `by`, anchored to the target's current source.
pub fn memory_add(repo: &Repo, target: &str, body: &str, by: &str, anchor: Option<String>) -> Result<Note> {
    let mut m = load(repo)?;
    let t = now();
    let n = Note {
        id: next(&mut m),
        kind: "memory".into(),
        anchor,
        target: target.into(),
        body: body.into(),
        author: by.into(),
        created: t,
        updated: t,
    };
    m.notes.push(n.clone());
    save(repo, &m, &format!("memory #{} on {}", n.id, target))?;
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

/// Fetch the remote's metadata and merge it in; push ours back only when
/// `share` is set (`kula share`) – by default nothing leaves the machine.
pub fn sync(repo: &Repo, remote: &str, share: bool) -> Result<String> {
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
    if share && repo.run(&["rev-parse", "--verify", "--quiet", REF]).is_ok() {
        repo.run(&["push", remote, &format!("{REF}:{REF}")])?;
        log.push_str("pushed refs/kula/meta\n");
    }
    Ok(log)
}

fn merge_meta(ours: &mut Meta, theirs: Meta) {
    ours.next_id = ours.next_id.max(theirs.next_id);
    if ours.issue_config.is_empty() {
        ours.issue_config = theirs.issue_config.clone();
    }
    for i in theirs.issues {
        match ours.issues.iter_mut().find(|o| o.id == i.id && o.created == i.created) {
            Some(o) if i.updated > o.updated => *o = i,
            Some(_) => {}
            None => ours.issues.push(i),
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

#[cfg(test)]
mod layout_tests {
    use super::Meta;

    #[test]
    fn layout_round_trips_and_old_meta_still_parses() {
        let old: Meta = serde_json::from_str("{}").unwrap();
        assert!(old.layout.is_empty());
        assert!(!serde_json::to_string(&old).unwrap().contains("layout"));
        let mut m = Meta::default();
        m.layout.insert("seat:ship/claude".into(), [12.5, -40.0]);
        let back: Meta = serde_json::from_str(&serde_json::to_string(&m).unwrap()).unwrap();
        assert_eq!(back.layout.get("seat:ship/claude"), Some(&[12.5, -40.0]));
    }

    #[test]
    fn old_issues_parse_and_patches_log_changes() {
        let i: super::Issue = serde_json::from_str(r#"{"id":1,"title":"t","status":"open","author":"a","created":1}"#).unwrap();
        assert!(i.assignees.is_empty() && i.priority.is_empty() && !i.locked);
        let mut i = i;
        let p = super::IssuePatch { status: Some("closed".into()), reason: Some("not_planned".into()), add_labels: vec!["bug".into(), "bug".into()], priority: Some("high".into()), ..Default::default() };
        let log = super::apply_patch(&mut i, &p).unwrap();
        assert_eq!(i.status, "closed");
        assert_eq!(i.reason, "not_planned");
        assert_eq!(i.labels, vec!["bug".to_string()]);
        assert_eq!(log.len(), 3);
        assert!(super::apply_patch(&mut i, &p).unwrap().is_empty(), "same patch twice changes nothing");
        let bad = super::IssuePatch { priority: Some("whenever".into()), ..Default::default() };
        assert!(super::apply_patch(&mut i, &bad).is_err());
        let re = super::IssuePatch { status: Some("open".into()), ..Default::default() };
        super::apply_patch(&mut i, &re).unwrap();
        assert!(i.reason.is_empty());
    }

    #[test]
    fn issue_config_skips_when_empty() {
        let m = Meta::default();
        assert!(!serde_json::to_string(&m).unwrap().contains("issue_config"));
    }
}
