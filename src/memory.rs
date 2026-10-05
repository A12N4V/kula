//! Agent memory, anchored to the code graph.
//!
//! Agent memory systems keep conversations: facts about a user, distilled and
//! retrieved by similarity. A codebase needs something narrower – what an agent
//! learned about *this code* (why a function is shaped the way it is, what broke
//! last time, which test is flaky) – and it needs to know when that knowledge
//! has gone out of date. So a kula memory is a note pinned to a symbol, file or
//! the repo, carrying a hash of the code it was written about. When that code
//! changes the memory is marked stale instead of being trusted silently.
//!
//! Memories live with the notes in `refs/kula/meta` – in git, auditable, shared
//! with `kula sync` – never in a separate service. Recall ranks by the graph:
//! the target's own memories, then its file's, then its callers' and callees'.

use crate::git::Repo;
use crate::graph::{self, read_lines};
use crate::guard::Guards;
use crate::meta::{self, Note};
use crate::store::{Node, Store};
use anyhow::{bail, Result};
use serde::Serialize;
use std::collections::HashMap;

pub const MAX_LEN: usize = 2000;

fn fnv(s: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

/// A target, resolved: its canonical form, and the node it names (none for `repo`).
pub fn resolve_target(store: &Store, target: &str) -> Result<(String, Option<Node>)> {
    let t = target.trim();
    if t.is_empty() || t == "repo" {
        return Ok(("repo".into(), None));
    }
    let raw = t.strip_prefix("symbol:").or_else(|| t.strip_prefix("file:")).unwrap_or(t);
    let n = graph::resolve_one(store, raw)?;
    let canon = if n.kind == "file" { format!("file:{}", n.path) } else { format!("symbol:{}:{}", n.path, n.name) };
    Ok((canon, Some(n)))
}

/// The hash of a node's source right now; files hash whole.
pub fn anchor_of(repo: &Repo, n: &Node) -> String {
    if n.kind == "file" {
        fnv(&std::fs::read_to_string(repo.root.join(&n.path)).unwrap_or_default())
    } else {
        fnv(&read_lines(repo, &n.path, n.start_line, n.end_line))
    }
}

pub fn remember(repo: &Repo, store: &Store, target: &str, text: &str, by: &str) -> Result<Note> {
    let text = text.trim();
    if text.is_empty() {
        bail!("a memory needs text");
    }
    if text.chars().count() > MAX_LEN {
        bail!("a memory is at most {MAX_LEN} characters: keep the fact, not the transcript");
    }
    let (canon, node) = resolve_target(store, target)?;
    if let Some(n) = &node {
        let v = Guards::load(repo)?.node(n);
        if !v.level.readable() {
            bail!("{} is hidden from agents: {}", canon, v.reason);
        }
    }
    meta::memory_add(repo, &canon, text, by, node.as_ref().map(|n| anchor_of(repo, n)))
}

#[derive(Serialize, Clone)]
pub struct Recalled {
    pub id: u64,
    pub target: String,
    pub body: String,
    pub author: String,
    pub created: i64,
    /// The code it was written about has changed since.
    pub stale: bool,
    /// How it relates to what was asked: self, file, caller, callee, repo, match.
    pub via: String,
}

fn words(s: &str) -> Vec<String> {
    crate::store::split_ident(s).to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| w.len() > 2).map(String::from).collect()
}

/// Memories for a target (and its neighbourhood), or matching a query, or all.
pub fn recall(repo: &Repo, store: &Store, target: Option<&str>, query: Option<&str>, limit: usize) -> Result<Vec<Recalled>> {
    let m = meta::load(repo)?;
    let mems: Vec<&Note> = m.notes.iter().filter(|n| n.kind == "memory").collect();
    let guards = Guards::load(repo)?;
    let mut nodes: HashMap<String, Option<Node>> = HashMap::new();
    let mut node_of = |t: &str| -> Option<Node> {
        nodes
            .entry(t.to_string())
            .or_insert_with(|| if t == "repo" { None } else { resolve_target(store, t).ok().and_then(|x| x.1) })
            .clone()
    };

    // Rank: the target itself, its file, its direct neighbours; else query overlap.
    let mut want: HashMap<String, (u8, &'static str)> = HashMap::new();
    if let Some(t) = target {
        let (canon, node) = resolve_target(store, t)?;
        want.insert(canon, (0, "self"));
        if let Some(n) = node {
            if n.kind != "file" {
                want.insert(format!("file:{}", n.path), (1, "file"));
            }
            for (c, _) in store.neighbours(n.id, "CALLS", false)? {
                want.entry(format!("symbol:{}:{}", c.path, c.name)).or_insert((2, "caller"));
            }
            for (c, _) in store.neighbours(n.id, "CALLS", true)? {
                want.entry(format!("symbol:{}:{}", c.path, c.name)).or_insert((2, "callee"));
            }
        }
        want.insert("repo".into(), (3, "repo"));
    }
    let q = query.map(words).unwrap_or_default();

    let mut out: Vec<(u8, usize, Recalled)> = vec![];
    for n in mems {
        let node = node_of(&n.target);
        if node.as_ref().is_some_and(|x| !guards.node(x).level.readable()) {
            continue;
        }
        let (rank, via) = match (target, want.get(&n.target)) {
            (Some(_), Some(&(r, v))) => (r, v),
            (Some(_), None) if q.is_empty() => continue,
            _ if q.is_empty() => (4, ""),
            _ => (4, "match"),
        };
        let hay = format!("{} {}", n.target, n.body).to_lowercase();
        let hits = q.iter().filter(|w| hay.contains(w.as_str())).count();
        if !q.is_empty() && hits == 0 && rank == 4 {
            continue;
        }
        let stale = match (&n.anchor, &node) {
            (Some(a), Some(x)) => *a != anchor_of(repo, x),
            (Some(_), None) => n.target != "repo", // its target is gone from the graph
            _ => false,
        };
        out.push((
            rank,
            hits,
            Recalled {
                id: n.id,
                target: n.target.clone(),
                body: n.body.clone(),
                author: n.author.clone(),
                created: n.created,
                stale,
                via: via.into(),
            },
        ));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)).then(a.2.stale.cmp(&b.2.stale)).then(b.2.created.cmp(&a.2.created)));
    Ok(out.into_iter().take(limit).map(|x| x.2).collect())
}

/// Re-anchor a memory to the code as it is now (a human or agent confirmed it still holds).
pub fn confirm(repo: &Repo, store: &Store, id: u64) -> Result<Note> {
    let mut m = meta::load(repo)?;
    let Some(n) = m.notes.iter_mut().find(|n| n.id == id && n.kind == "memory") else { bail!("no memory #{id}") };
    let node = if n.target == "repo" { None } else { resolve_target(store, &n.target)?.1 };
    n.anchor = node.as_ref().map(|x| anchor_of(repo, x));
    n.updated = meta::now();
    let out = n.clone();
    meta::save(repo, &m, &format!("memory #{id} confirmed"))?;
    Ok(out)
}
