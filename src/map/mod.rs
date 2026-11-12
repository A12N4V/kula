//! Semantic map (K2): module tree, cluster naming, entry points. Pure modules;
//! no LLM, fully offline and deterministic.

pub mod arch;
pub mod entries;
pub mod names;
pub mod tree;

use crate::store::{Node, Store};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

/// A community together with its member symbols, for naming and explain.
#[derive(Debug, Clone, Serialize)]
pub struct Cluster {
    pub id: i64,
    pub label: String,
    pub members: Vec<Node>,
}

/// Group the indexed symbols by their community, ordered by community id.
pub fn clusters(db: &Store) -> Vec<Cluster> {
    let nodes = db.nodes_where("kind != 'file' AND kind != 'package'", []).unwrap_or_default();
    let mut by: BTreeMap<i64, Cluster> = BTreeMap::new();
    for n in nodes {
        let c = by.entry(n.community).or_insert_with(|| Cluster { id: n.community, label: String::new(), members: vec![] });
        c.members.push(n);
    }
    let labels = db.communities().unwrap_or_default();
    let mut out: Vec<Cluster> = by.into_values().collect();
    for c in &mut out {
        if let Some(l) = labels.iter().find(|x| x.id == c.id) {
            c.label = l.label.clone();
        }
    }
    out
}

/// The file a node lives in, walking owner links (class -> method) up to the file.
pub fn file_of(id: i64, by_id: &HashMap<i64, Node>) -> Option<String> {
    let mut cur = by_id.get(&id)?;
    for _ in 0..8 {
        match cur.parent {
            Some(p) => {
                let n = by_id.get(&p)?;
                if n.kind == "file" {
                    return Some(n.path.clone());
                }
                cur = n;
            }
            None => return if cur.kind == "file" { Some(cur.path.clone()) } else { None },
        }
    }
    None
}
