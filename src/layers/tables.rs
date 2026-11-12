//! Database tables: ORM models and SQL migrations → `table` nodes.
//!
//! Declared by SQLAlchemy (`__tablename__`), Django (`models.Model`, `db_table`
//! or `<app>_<model>`), Prisma (`model X`, `@@map`), Drizzle (`pgTable("t")` and
//! friends) and SQL (`CREATE TABLE`). Edges:
//! - `MAPS_TABLE` model symbol (or file) → table; weight is the line.
//! - `MIGRATES_TABLE` `.sql` file → table, for `CREATE`/`ALTER TABLE`.
//! - `USES_TABLE` symbol (or file) → table, where the code names the model or
//!   writes raw SQL against the table (`FROM`, `JOIN`, `INTO`, `UPDATE`).
//!
//! `kula impact table:<name>` starts from these users and walks their callers.

use crate::index::Reader;
use crate::store::{Edge, Node, Store};
use anyhow::Result;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

/// One table declared in a source: its name, the model that maps it, and the start byte.
#[derive(Debug, Clone, PartialEq)]
pub struct TableDef {
    pub table: String,
    pub model: Option<String>,
    pub byte: usize,
}

fn ident(s: &str) -> String {
    s.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').collect()
}

/// The quoted string right after `at` (skipping spaces and `(`).
fn quoted(src: &str, at: usize) -> Option<String> {
    let rest = src[at..].trim_start_matches(|c: char| c.is_whitespace() || c == '(' || c == '=');
    let q = rest.chars().next().filter(|c| matches!(c, '"' | '\'' | '`'))?;
    let s: String = rest[1..].chars().take_while(|c| *c != q).collect();
    (!s.is_empty() && s.len() <= 128).then_some(s)
}

/// SQL names lose quotes and schema: `"public"."users"` → `users`.
fn sql_name(raw: &str) -> String {
    let last = raw.rsplit('.').next().unwrap_or(raw);
    last.trim_matches(|c| matches!(c, '"' | '`' | '[' | ']' | '\'')).to_ascii_lowercase()
}

/// Python classes: `(name, bases, start byte, end byte)` by indentation.
fn py_classes(src: &str) -> Vec<(String, String, usize, usize)> {
    let mut out: Vec<(String, String, usize, usize)> = Vec::new();
    let mut at = 0;
    for line in src.split_inclusive('\n') {
        let top = !line.starts_with(char::is_whitespace) && !line.trim().is_empty();
        if top {
            if let Some(c) = out.last_mut().filter(|c| c.3 == usize::MAX) {
                c.3 = at;
            }
            if let Some(rest) = line.strip_prefix("class ") {
                let name = ident(rest);
                let bases = rest[name.len()..].split(':').next().unwrap_or("").to_string();
                out.push((name, bases, at, usize::MAX));
            }
        }
        at += line.len();
    }
    if let Some(c) = out.last_mut().filter(|c| c.3 == usize::MAX) {
        c.3 = src.len();
    }
    out
}

fn snake(s: &str) -> String {
    s.to_ascii_lowercase()
}

/// Every table declared in one source. Pure: takes path, language id and text.
pub fn scan(path: &str, lang: &str, src: &str) -> Vec<TableDef> {
    let mut out = Vec::new();
    if path.ends_with(".sql") {
        let low = src.to_ascii_lowercase();
        for kw in ["create table", "alter table"] {
            let mut from = 0;
            while let Some(i) = low[from..].find(kw) {
                let at = from + i + kw.len();
                from = at;
                let mut rest = low[at..].trim_start();
                for skip in ["if not exists", "if exists", "only"] {
                    rest = rest.strip_prefix(skip).map(str::trim_start).unwrap_or(rest);
                }
                let raw: String = rest.chars().take_while(|c| !c.is_whitespace() && *c != '(' && *c != ';').collect();
                let t = sql_name(&raw);
                if !t.is_empty() && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                    out.push(TableDef { table: t, model: None, byte: at });
                }
            }
        }
    }
    match lang {
        "python" => {
            let app = path.rsplit('/').nth(1).unwrap_or("").to_ascii_lowercase();
            for (name, bases, s, e) in py_classes(src) {
                let body = &src[s..e];
                if let Some(i) = body.find("__tablename__") {
                    if let Some(t) = quoted(body, i + "__tablename__".len()) {
                        out.push(TableDef { table: t, model: Some(name), byte: s });
                        continue;
                    }
                }
                if bases.contains("models.Model") || (path.ends_with("models.py") && bases.contains("Model") && src.contains("django")) {
                    let t = body
                        .find("db_table")
                        .and_then(|i| quoted(body, i + "db_table".len()))
                        .unwrap_or_else(|| format!("{app}_{}", snake(&name)));
                    out.push(TableDef { table: t, model: Some(name), byte: s });
                }
            }
        }
        "javascript" | "typescript" | "tsx" => {
            for f in ["pgTable(", "mysqlTable(", "sqliteTable("] {
                let mut from = 0;
                while let Some(i) = src[from..].find(f) {
                    let at = from + i;
                    from = at + f.len();
                    let Some(t) = quoted(src, from) else { continue };
                    // `export const users = pgTable(...)`: the binding is the model.
                    let before = src[..at].trim_end().strip_suffix('=').unwrap_or("").trim_end();
                    let model: String = before
                        .chars()
                        .rev()
                        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                        .collect::<String>()
                        .chars()
                        .rev()
                        .collect();
                    out.push(TableDef { table: t, model: (!model.is_empty()).then_some(model), byte: at });
                }
            }
        }
        "prisma" => {
            let mut at = 0;
            let mut cur: Option<(String, usize)> = None;
            for line in src.split_inclusive('\n') {
                let l = line.trim();
                if let Some(rest) = l.strip_prefix("model ") {
                    cur = Some((ident(rest), at));
                } else if let (Some(i), Some((m, b))) = (l.find("@@map"), cur.as_ref()) {
                    if let Some(t) = quoted(l, i + 5) {
                        out.push(TableDef { table: t, model: Some(m.clone()), byte: *b });
                        cur = None;
                    }
                } else if l.starts_with('}') {
                    if let Some((m, b)) = cur.take() {
                        out.push(TableDef { table: m.clone(), model: Some(m), byte: b });
                    }
                }
                at += line.len();
            }
        }
        _ => {}
    }
    out
}

/// Identifiers in a source with their start bytes, and the keyword before each.
fn words(src: &str) -> Vec<(usize, &str, &str)> {
    let mut out = Vec::new();
    let (mut prev, mut i) = ("", 0);
    let b = src.as_bytes();
    while i < b.len() {
        if b[i].is_ascii_alphabetic() || b[i] == b'_' {
            let s = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') {
                i += 1;
            }
            let w = &src[s..i];
            out.push((s, w, prev));
            prev = w;
        } else {
            i += 1;
        }
    }
    out
}

fn table_node(t: &str, nodes: &mut Vec<Node>, hashes: &mut Vec<u64>, ids: &mut HashMap<String, usize>) -> usize {
    if let Some(id) = ids.get(t) {
        return *id;
    }
    let id = nodes.len();
    nodes.push(Node {
        id: id as i64,
        kind: "table".into(),
        name: t.to_string(),
        path: format!("table:{t}"),
        lang: String::new(),
        start_line: 0,
        end_line: 0,
        parent: None,
        community: 0,
    });
    hashes.push(0);
    ids.insert(t.to_string(), id);
    id
}

/// Insert table nodes and their edges into a graph under construction.
#[allow(clippy::too_many_arguments)]
pub(crate) fn apply(
    parsed: &[crate::index::ParsedFile],
    sym_ids: &[Vec<usize>],
    files: &[(String, Option<&'static str>)],
    read: Reader,
    nodes: &mut Vec<Node>,
    edges: &mut Vec<Edge>,
    file_id: &HashMap<String, usize>,
    hashes: &mut Vec<u64>,
) {
    let line_of = |src: &str, b: usize| 1 + src[..b.min(src.len())].matches('\n').count() as i64;
    // Innermost symbol of parsed file `pi` around byte `b`, else the file.
    let owner = |pi: Option<usize>, b: usize, fid: usize| {
        pi.and_then(|pi| {
            parsed[pi]
                .defs
                .iter()
                .enumerate()
                .filter(|(_, d)| d.start_byte <= b && b < d.end_byte)
                .min_by_key(|(_, d)| d.end_byte - d.start_byte)
                .map(|(i, _)| sym_ids[pi][i])
        })
        .unwrap_or(fid)
    };
    let pidx: HashMap<&str, usize> = parsed.iter().enumerate().map(|(i, p)| (p.path.as_str(), i)).collect();
    let mut ids: HashMap<String, usize> = HashMap::new();
    let mut models: HashMap<String, usize> = HashMap::new();
    let mut definers: HashSet<(usize, usize)> = HashSet::new();
    let mut linked: HashSet<(usize, usize, &str)> = HashSet::new();
    let mut texts: Vec<(String, usize, Option<usize>, String)> = Vec::new();
    for (p, lang) in files {
        let lang = lang.unwrap_or("");
        if !p.ends_with(".sql") && !matches!(lang, "python" | "javascript" | "typescript" | "tsx" | "prisma") {
            continue;
        }
        let (Some(src), Some(fid)) = (read(p), file_id.get(p).copied()) else { continue };
        let pi = pidx.get(p.as_str()).copied();
        for d in scan(p, lang, &src) {
            let t = table_node(&d.table, nodes, hashes, &mut ids);
            let by = owner(pi, d.byte, fid);
            let kind = if d.model.is_some() { "MAPS_TABLE" } else { "MIGRATES_TABLE" };
            if linked.insert((by, t, kind)) {
                edges.push(Edge::new(by as i64, t as i64, kind, line_of(&src, d.byte) as f64));
            }
            definers.insert((by, t));
            if let Some(m) = d.model.filter(|m| m.len() > 2) {
                // Prisma's client names a model in lower camel case: `prisma.user`.
                if lang == "prisma" {
                    let mut c = m.chars();
                    let low: String = c.next().map(|f| f.to_ascii_lowercase()).into_iter().chain(c).collect();
                    models.insert(low, t);
                }
                models.insert(m, t);
            }
        }
        if lang != "prisma" {
            texts.push((p.clone(), fid, pi, src));
        }
    }
    if ids.is_empty() {
        return;
    }
    let sql_kw = ["from", "join", "into", "update", "table"];
    for (p, fid, pi, src) in &texts {
        let sql = p.ends_with(".sql");
        for (b, w, prev) in words(src) {
            let t = match models.get(w) {
                Some(t) if !sql => *t,
                _ if sql_kw.contains(&prev.to_ascii_lowercase().as_str()) => match ids.get(&w.to_ascii_lowercase()) {
                    Some(t) if !sql => *t,
                    _ => continue,
                },
                _ => continue,
            };
            let by = owner(*pi, b, *fid);
            if definers.contains(&(by, t))
                || (by == *fid
                    && src[..b]
                        .rsplit('\n')
                        .next()
                        .is_some_and(|l| l.trim_start().starts_with("import") || l.trim_start().starts_with("from")))
            {
                continue;
            }
            if linked.insert((by, t, "USES_TABLE")) {
                edges.push(Edge::new(by as i64, t as i64, "USES_TABLE", line_of(src, b) as f64));
            }
        }
    }
}

#[derive(Serialize)]
pub struct TableUser {
    pub file: String,
    /// The symbol, or None for the whole file.
    pub symbol: Option<String>,
    pub line: i64,
    /// `maps`, `migrates` or `uses`.
    pub how: String,
}

/// Who declares and uses one table: `kula query table:NAME`.
pub fn users(store: &Store, name: &str) -> Result<Vec<TableUser>> {
    let Some(t) = store.nodes_where("kind = 'table' AND name = ?1", [name])?.into_iter().next() else { return Ok(vec![]) };
    let mut out = Vec::new();
    for (kind, how) in [("MAPS_TABLE", "maps"), ("MIGRATES_TABLE", "migrates"), ("USES_TABLE", "uses")] {
        for (n, line) in store.neighbours(t.id, kind, false)? {
            out.push(TableUser {
                file: n.path.clone(),
                symbol: (n.kind != "file").then(|| n.name.clone()),
                line: line as i64,
                how: how.into(),
            });
        }
    }
    Ok(out)
}

/// Prints `kula query table:NAME`.
pub fn print(users: &[TableUser], name: &str, json: bool) {
    if json {
        println!("{}", serde_json::to_string_pretty(users).unwrap_or_default());
        return;
    }
    if users.is_empty() {
        println!("{}", crate::term::dim(&format!("no table {name}")));
    }
    for u in users {
        let s = u.symbol.clone().unwrap_or_default();
        println!("  {} {s} {} {}", crate::term::bold(&u.file), crate::term::dim(&format!("line {}", u.line)), crate::term::dim(&u.how));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(v: &[TableDef]) -> Vec<(String, Option<String>)> {
        v.iter().map(|d| (d.table.clone(), d.model.clone())).collect()
    }

    #[test]
    fn sqlalchemy_and_django() {
        let sa = "class User(Base):\n    __tablename__ = 'users'\n    id = Column(Integer)\n\nclass Other:\n    pass\n";
        assert_eq!(names(&scan("app/db.py", "python", sa)), [("users".into(), Some("User".into()))]);
        let dj = "from django.db import models\nclass Order(models.Model):\n    x = 1\nclass Item(models.Model):\n    class Meta:\n        db_table = \"line_items\"\n";
        assert_eq!(
            names(&scan("shop/models.py", "python", dj)),
            [("shop_order".into(), Some("Order".into())), ("line_items".into(), Some("Item".into()))]
        );
    }

    #[test]
    fn drizzle_prisma_sql() {
        let dz = "export const users = pgTable(\"users\", { id: serial() });\nconst posts = sqliteTable('posts', {});";
        assert_eq!(
            names(&scan("db/schema.ts", "typescript", dz)),
            [("users".into(), Some("users".into())), ("posts".into(), Some("posts".into()))]
        );
        let pr = "model User {\n  id Int\n}\nmodel Post {\n  id Int\n  @@map(\"posts\")\n}\n";
        assert_eq!(
            names(&scan("schema.prisma", "prisma", pr)),
            [("User".into(), Some("User".into())), ("posts".into(), Some("Post".into()))]
        );
        let sql = "CREATE TABLE IF NOT EXISTS \"public\".\"Users\" (id int);\nalter table orders add column x int;";
        assert_eq!(names(&scan("migrations/001.sql", "", sql)), [("users".into(), None), ("orders".into(), None)]);
    }
}
