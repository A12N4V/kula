//! Turning a user reference (name, path, path:name, path:Owner.name) into one node.

use crate::store::{Node, Store};
use anyhow::{bail, Result};

/// Pick the single best node for a reference, preferring definitions.
pub fn resolve_one(store: &Store, r: &str) -> Result<Node> {
    // `table:users` names a table node from an ORM model or migration.
    if let Some(t) = r.strip_prefix("table:") {
        let t = t.to_lowercase();
        return store
            .nodes_where("kind = 'table' AND name = ?1", [&t])?
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("no table {t:?}"));
    }
    let mut hits = store.resolve(r)?;
    // A file named by its full path wins over longer paths ending in it.
    if hits.len() > 1 && hits[0].kind == "file" && hits[0].path == r {
        hits.truncate(1);
    }
    match hits.len() {
        1 => Ok(hits.remove(0)),
        0 => {
            // No guessing: name the closest symbols and let the caller pick.
            let near: Vec<String> = store.search(r, 3)?.iter().map(|n| format!("{}:{}", n.path, n.name)).collect();
            if near.is_empty() {
                bail!("no symbol matches {r:?}")
            }
            bail!("no symbol matches {r:?}; did you mean {}", near.join(", "))
        }
        n => {
            // Name the owner too when it is what tells the matches apart.
            let owner = |h: &Node| h.parent.and_then(|p| store.node(p).ok().flatten()).filter(|p| p.kind != "file");
            let list: Vec<String> = hits
                .iter()
                .take(5)
                .map(|h| match owner(h) {
                    Some(o) => format!("{}:{}.{}", h.path, o.name, h.name),
                    None => format!("{}:{}", h.path, h.name),
                })
                .collect();
            bail!("ambiguous: {n} matches for {r:?}, use path:name ({}{})", list.join(", "), if n > 5 { ", ..." } else { "" })
        }
    }
}
