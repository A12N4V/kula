//! SQLite-backed graph store (`.kula/graph.db`).

use crate::git::Repo;
use anyhow::{bail, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Node {
    pub id: i64,
    pub kind: String,
    pub name: String,
    pub path: String,
    pub lang: String,
    pub start_line: i64,
    pub end_line: i64,
    pub parent: Option<i64>,
    pub community: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Edge {
    pub src: i64,
    pub dst: i64,
    pub kind: String,
    pub weight: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Community {
    pub id: i64,
    pub label: String,
    pub size: i64,
}

pub struct Store {
    pub conn: Connection,
}

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL,
  lang TEXT, start_line INTEGER, end_line INTEGER, parent INTEGER, community INTEGER
);
CREATE TABLE IF NOT EXISTS edges (src INTEGER, dst INTEGER, kind TEXT, weight REAL);
CREATE TABLE IF NOT EXISTS communities (id INTEGER PRIMARY KEY, label TEXT, size INTEGER);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS edges_src ON edges(src, kind);
CREATE INDEX IF NOT EXISTS edges_dst ON edges(dst, kind);
CREATE INDEX IF NOT EXISTS nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS nodes_path ON nodes(path);
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(name, path, tokenize = 'unicode61 remove_diacritics 2');
"#;

fn row_node(r: &rusqlite::Row) -> rusqlite::Result<Node> {
    Ok(Node {
        id: r.get(0)?,
        kind: r.get(1)?,
        name: r.get(2)?,
        path: r.get(3)?,
        lang: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
        start_line: r.get(5)?,
        end_line: r.get(6)?,
        parent: r.get(7)?,
        community: r.get::<_, Option<i64>>(8)?.unwrap_or(0),
    })
}

pub const NODE_COLS: &str = "id, kind, name, path, lang, start_line, end_line, parent, community";

impl Store {
    pub fn path(repo: &Repo) -> std::path::PathBuf {
        repo.kula_dir().join("graph.db")
    }

    /// Fresh database for a full (re)index.
    pub fn create(repo: &Repo) -> Result<Store> {
        let dir = repo.kula_dir();
        std::fs::create_dir_all(&dir)?;
        // Keep the index out of version control without touching the user's .gitignore.
        std::fs::write(dir.join(".gitignore"), "*\n").ok();
        let p = Self::path(repo);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{}", p.display(), suffix));
        }
        let conn = Connection::open(&p)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Store { conn })
    }

    pub fn open(repo: &Repo) -> Result<Store> {
        let p = Self::path(repo);
        if !p.exists() {
            bail!("no index yet – run `kula index` first");
        }
        let conn = Connection::open(&p)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(Store { conn })
    }

    pub fn write_all(&self, nodes: &[Node], edges: &[Edge], communities: &[Community]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        {
            let mut n = tx.prepare("INSERT INTO nodes VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)")?;
            let mut f = tx.prepare("INSERT INTO nodes_fts(rowid, name, path) VALUES (?1, ?2, ?3)")?;
            for x in nodes {
                n.execute(params![x.id, x.kind, x.name, x.path, x.lang, x.start_line, x.end_line, x.parent, x.community])?;
                // Split camelCase / snake_case so partial words match.
                f.execute(params![x.id, format!("{} {}", x.name, split_ident(&x.name)), x.path.replace('/', " ")])?;
            }
            let mut e = tx.prepare("INSERT INTO edges VALUES (?1,?2,?3,?4)")?;
            for x in edges {
                e.execute(params![x.src, x.dst, x.kind, x.weight])?;
            }
            let mut c = tx.prepare("INSERT INTO communities VALUES (?1,?2,?3)")?;
            for x in communities {
                c.execute(params![x.id, x.label, x.size])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn set_meta(&self, k: &str, v: &str) -> Result<()> {
        self.conn.execute("INSERT OR REPLACE INTO meta VALUES (?1, ?2)", params![k, v])?;
        Ok(())
    }

    pub fn meta(&self, k: &str) -> Option<String> {
        self.conn.query_row("SELECT value FROM meta WHERE key = ?1", [k], |r| r.get(0)).optional().ok().flatten()
    }

    pub fn node(&self, id: i64) -> Result<Option<Node>> {
        Ok(self.conn.query_row(&format!("SELECT {NODE_COLS} FROM nodes WHERE id = ?1"), [id], row_node).optional()?)
    }

    pub fn nodes_where(&self, clause: &str, p: impl rusqlite::Params) -> Result<Vec<Node>> {
        let mut st = self.conn.prepare(&format!("SELECT {NODE_COLS} FROM nodes WHERE {clause}"))?;
        let rows = st.query_map(p, row_node)?.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn all_edges(&self) -> Result<Vec<Edge>> {
        let mut st = self.conn.prepare("SELECT src, dst, kind, weight FROM edges")?;
        let rows = st
            .query_map([], |r| Ok(Edge { src: r.get(0)?, dst: r.get(1)?, kind: r.get(2)?, weight: r.get(3)? }))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn communities(&self) -> Result<Vec<Community>> {
        let mut st = self.conn.prepare("SELECT id, label, size FROM communities ORDER BY size DESC")?;
        let rows = st
            .query_map([], |r| Ok(Community { id: r.get(0)?, label: r.get(1)?, size: r.get(2)? }))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Neighbours along `kind` edges. `out` = follow src→dst.
    pub fn neighbours(&self, id: i64, kind: &str, out: bool) -> Result<Vec<(Node, f64)>> {
        let sql = if out {
            "SELECT n.id, n.kind, n.name, n.path, n.lang, n.start_line, n.end_line, n.parent, n.community, e.weight FROM edges e JOIN nodes n ON n.id = e.dst WHERE e.src = ?1 AND e.kind = ?2"
        } else {
            "SELECT n.id, n.kind, n.name, n.path, n.lang, n.start_line, n.end_line, n.parent, n.community, e.weight FROM edges e JOIN nodes n ON n.id = e.src WHERE e.dst = ?1 AND e.kind = ?2"
        };
        let mut st = self.conn.prepare(sql)?;
        let rows = st.query_map(params![id, kind], |r| Ok((row_node(r)?, r.get(9)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Full-text search with prefix matching; falls back to LIKE.
    pub fn search(&self, q: &str, limit: usize) -> Result<Vec<Node>> {
        let terms: Vec<String> = q
            .split(|c: char| !c.is_alphanumeric() && c != '_')
            .filter(|t| !t.is_empty())
            .map(|t| format!("\"{}\"*", t.replace('"', "")))
            .collect();
        if terms.is_empty() {
            return Ok(vec![]);
        }
        let fts = terms.join(" ");
        let sql = "SELECT n.id, n.kind, n.name, n.path, n.lang, n.start_line, n.end_line, n.parent, n.community
             FROM nodes_fts f JOIN nodes n ON n.id = f.rowid
             WHERE nodes_fts MATCH ?1
             ORDER BY (lower(n.name) = lower(?2)) DESC, (n.kind = 'file') ASC, bm25(nodes_fts, 5.0, 1.0) LIMIT ?3";
        let mut st = self.conn.prepare(sql)?;
        let mut rows = st.query_map(params![fts, q.trim(), limit as i64], row_node)?.collect::<rusqlite::Result<Vec<_>>>()?;
        if rows.is_empty() {
            rows = self.nodes_where("name LIKE ?1 LIMIT ?2", params![format!("%{}%", q.trim()), limit as i64])?;
        }
        Ok(rows)
    }

    /// Resolve a user-supplied symbol reference: numeric id, `path:name`, or name.
    pub fn resolve(&self, r: &str) -> Result<Vec<Node>> {
        if let Ok(id) = r.parse::<i64>() {
            return Ok(self.node(id)?.into_iter().collect());
        }
        if let Some((path, name)) = r.rsplit_once(':') {
            let hits = self.nodes_where("name = ?1 AND path LIKE ?2 AND kind != 'file'", params![name, format!("%{path}")])?;
            if !hits.is_empty() {
                return Ok(hits);
            }
        }
        let exact = self.nodes_where("name = ?1 AND kind != 'file' ORDER BY id", [r])?;
        if !exact.is_empty() {
            return Ok(exact);
        }
        self.nodes_where("kind = 'file' AND (path = ?1 OR path LIKE ?2) ORDER BY length(path)", params![r, format!("%/{r}")])
    }
}

/// `parseHttpRequest` → `parse http request`, `load_user_v2` → `load user v2`.
pub fn split_ident(s: &str) -> String {
    let mut out = String::new();
    let mut prev_lower = false;
    for c in s.chars() {
        if c == '_' || c == '-' {
            out.push(' ');
            prev_lower = false;
            continue;
        }
        if c.is_uppercase() && prev_lower {
            out.push(' ');
        }
        prev_lower = c.is_lowercase() || c.is_ascii_digit();
        out.extend(c.to_lowercase());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::split_ident;

    #[test]
    fn splits_identifiers() {
        assert_eq!(split_ident("parseHttpRequest"), "parse http request");
        assert_eq!(split_ident("load_user_v2"), "load user v2");
        assert_eq!(split_ident("URL"), "url");
    }
}
