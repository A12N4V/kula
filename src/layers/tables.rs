//! Database tables: ORM models and SQL migrations → `table` nodes.
//!
//! Declared by SQLAlchemy (`__tablename__`), Django (`models.Model`, `db_table`
//! or `<app>_<model>`; abstract models skipped), Prisma (`model X`, `@@map`),
//! Drizzle (`pgTable("t")`, schema `.table`, `pgTableCreator` templates) and SQL
//! (`CREATE`/`ALTER TABLE`). Table names are case folded. Edges:
//! - `MAPS_TABLE` model symbol (the schema file for Prisma) → table; weight is the line.
//! - `MIGRATES_TABLE` `.sql` file → table.
//! - `USES_TABLE` symbol (or file) → table, where code names a model it imports
//!   (Prisma's `prisma.user`/`db.user`), or a string holds raw SQL against the
//!   table after `FROM`, `JOIN`, `INTO` or `UPDATE`.
//!
//! `kula impact table:<name>` starts from these users and walks their callers.

mod scan;

use crate::index::Reader;
use crate::store::{Edge, Node, Store};
use anyhow::Result;
pub use scan::scan;
use scan::{idents, lex, sql_ref, Style, CODE, STR};
use serde::Serialize;
use std::collections::{HashMap, HashSet};

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

/// Innermost def around a byte, by binary search over defs sorted by start with parent links.
struct Owners {
    spans: Vec<(usize, usize, usize, Option<usize>)>,
}

impl Owners {
    fn new(p: &crate::index::ParsedFile, ids: &[usize]) -> Self {
        Self::of(p.defs.iter().zip(ids).map(|(d, id)| (d.start_byte, d.end_byte, *id)).collect())
    }
    fn of(mut v: Vec<(usize, usize, usize)>) -> Self {
        v.sort_by_key(|(s, e, _)| (*s, std::cmp::Reverse(*e)));
        let mut spans: Vec<(usize, usize, usize, Option<usize>)> = Vec::with_capacity(v.len());
        let mut stack: Vec<usize> = Vec::new();
        for (s, e, id) in v {
            while stack.last().is_some_and(|&k| spans[k].1 <= s) {
                stack.pop();
            }
            spans.push((s, e, id, stack.last().copied()));
            stack.push(spans.len() - 1);
        }
        Owners { spans }
    }
    fn at(&self, b: usize) -> Option<usize> {
        let mut k = self.spans.partition_point(|x| x.0 <= b).checked_sub(1)?;
        loop {
            let (s, e, id, up) = self.spans[k];
            if s <= b && b < e {
                return Some(id);
            }
            k = up?;
        }
    }
}

fn family(path: &str, lang: &str) -> Option<Style> {
    match lang {
        "python" => Some(Style::Py),
        "javascript" | "typescript" | "tsx" => Some(Style::Js),
        _ if path.ends_with(".prisma") => Some(Style::Js),
        _ => None,
    }
}

/// Byte spans of a source's import statements (multi-line ones joined).
fn imports(src: &str, style: Style) -> Vec<(usize, usize)> {
    let mut out: Vec<(usize, usize)> = Vec::new();
    let (mut at, mut open, mut depth) = (0, false, 0i32);
    for line in src.split_inclusive('\n') {
        let l = line.trim();
        let starts = match style {
            Style::Py => l.starts_with("import ") || l.starts_with("from "),
            _ => l.starts_with("import ") || l.starts_with("import{") || l.contains("require("),
        };
        if open || starts {
            match out.last_mut().filter(|_| open) {
                Some(s) => s.1 = at + line.len(),
                None => out.push((at, at + line.len())),
            }
            depth += l.matches(['(', '{']).count() as i32 - l.matches([')', '}']).count() as i32;
            open = depth > 0 && (style == Style::Py || !(l.contains(" from ") || l.contains("require(")));
            if !open {
                depth = 0;
            }
        }
        at += line.len();
    }
    out
}

/// The name a module is imported by: its file stem, or its directory for an index file.
fn stem(path: &str) -> &str {
    let mut parts = path.rsplit('/');
    let f = parts.next().unwrap_or(path);
    let s = f.split('.').next().unwrap_or(f);
    if matches!(s, "index" | "__init__" | "mod") {
        parts.next().unwrap_or(s)
    } else {
        s
    }
}

struct Model {
    file: String,
    name: String,
    style: Style,
    prisma: bool,
    table: usize,
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
    let pidx: HashMap<&str, usize> = parsed.iter().enumerate().map(|(i, p)| (p.path.as_str(), i)).collect();
    let mut owners: HashMap<usize, Owners> = HashMap::new();
    let mut owner = |p: &str, b: usize, fid: usize| match pidx.get(p) {
        Some(&pi) => owners.entry(pi).or_insert_with(|| Owners::new(&parsed[pi], &sym_ids[pi])).at(b).unwrap_or(fid),
        None => fid,
    };
    let mut ids: HashMap<String, usize> = HashMap::new();
    let mut models: Vec<Model> = Vec::new();
    let mut definers: HashSet<(usize, usize)> = HashSet::new();
    let mut linked: HashSet<(usize, usize, &str)> = HashSet::new();
    let mut code: Vec<(&str, usize, Style)> = Vec::new();
    // Pass one: declarations. Texts are dropped as we go.
    for (p, lang) in files {
        let lang = lang.unwrap_or("");
        let sql = p.ends_with(".sql");
        let style = family(p, lang);
        if !sql && style.is_none() {
            continue;
        }
        let Some(fid) = file_id.get(p).copied() else { continue };
        if let Some(st) = style.filter(|_| !p.ends_with(".prisma")) {
            code.push((p.as_str(), fid, st));
        }
        let Some(src) = read(p) else { continue };
        let nl: Vec<usize> = src.match_indices('\n').map(|(i, _)| i).collect();
        for d in scan(p, lang, &src) {
            let t = table_node(&d.table, nodes, hashes, &mut ids);
            let (by, kind) = match &d.model {
                Some(_) if !p.ends_with(".prisma") => (owner(p, d.byte, fid), "MAPS_TABLE"),
                Some(_) => (fid, "MAPS_TABLE"),
                None => (fid, "MIGRATES_TABLE"),
            };
            if linked.insert((by, t, kind)) {
                edges.push(Edge::new(by as i64, t as i64, kind, (1 + nl.partition_point(|&i| i < d.byte)) as f64));
            }
            definers.insert((by, t));
            if let (Some(m), Some(st)) = (d.model.filter(|m| m.len() > 2), style) {
                models.push(Model { file: p.clone(), name: m, style: st, prisma: p.ends_with(".prisma"), table: t });
            }
        }
    }
    if ids.is_empty() {
        return;
    }
    let mut by_name: HashMap<String, Vec<usize>> = HashMap::new();
    for (k, m) in models.iter().enumerate() {
        let key = if m.prisma {
            let mut c = m.name.chars();
            c.next().map(|f| f.to_ascii_lowercase()).into_iter().chain(c).collect()
        } else {
            m.name.clone()
        };
        by_name.entry(key).or_default().push(k);
    }
    // Pass two: uses, in code files only.
    for (p, fid, style) in code {
        let Some(src) = read(p) else { continue };
        let mask = lex(&src, style);
        let imp = imports(&src, style);
        let in_imp = |b: usize| imp.iter().any(|&(s, e)| s <= b && b < e);
        let imp_ids: HashSet<&str> = imp.iter().flat_map(|&(s, e)| idents(&src[s..e]).into_iter().map(|(_, w)| w)).collect();
        let nl: Vec<usize> = src.match_indices('\n').map(|(i, _)| i).collect();
        let mut kw: Option<usize> = None;
        for (b, w) in idents(&src) {
            let t = match mask[b] {
                CODE => {
                    kw = None;
                    let Some(ms) = by_name.get(w) else { continue };
                    let before = src[..b].trim_end_matches(|c: char| c.is_ascii_alphanumeric() || c == '_');
                    let hit = ms.iter().map(|&k| &models[k]).find(|m| {
                        if m.prisma {
                            style == Style::Js && (before.ends_with("prisma.") || before.ends_with("db."))
                        } else {
                            m.style == style && (m.file == p || imp_ids.contains(m.name.as_str()) || imp_ids.contains(stem(&m.file)))
                        }
                    });
                    let Some(m) = hit.filter(|_| !in_imp(b)) else { continue };
                    m.table
                }
                STR => {
                    let prev = kw.take();
                    if matches!(w.to_ascii_lowercase().as_str(), "from" | "join" | "into" | "update") {
                        kw = Some(b);
                        continue;
                    }
                    // The keyword and the name sit in the same string literal.
                    if !prev.is_some_and(|k| mask[k..b].iter().all(|&x| x == STR)) {
                        continue;
                    }
                    let Some(t) = sql_ref(&src[b..]).and_then(|n| ids.get(&n).copied()) else { continue };
                    t
                }
                _ => {
                    kw = None;
                    continue;
                }
            };
            let by = owner(p, b, fid);
            if definers.contains(&(by, t)) {
                continue;
            }
            if linked.insert((by, t, "USES_TABLE")) {
                edges.push(Edge::new(by as i64, t as i64, "USES_TABLE", (1 + nl.partition_point(|&i| i < b)) as f64).with("inferred"));
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
    let Some(t) = store.nodes_where("kind = 'table' AND name = ?1", [name.to_lowercase()])?.into_iter().next() else { return Ok(vec![]) };
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

    #[test]
    fn import_spans_and_stems() {
        let py = "from x import (\n    User,\n)\nimport y\nz = 1\n";
        let sp = imports(py, Style::Py);
        assert_eq!(sp.len(), 2);
        assert!(py[sp[0].0..sp[0].1].contains("User") && !py[sp[1].0..sp[1].1].contains('z'));
        let js = "import {\n  users,\n} from './schema';\nconst a = 1;\n";
        assert_eq!(imports(js, Style::Js), [(0, 37)]);
        // Class 0..100 holds methods 10..40 and 50..90; byte 45 is the class's.
        let o = Owners::of(vec![(50, 90, 3), (0, 100, 1), (10, 40, 2), (120, 130, 4)]);
        assert_eq!([o.at(20), o.at(45), o.at(60), o.at(110), o.at(125)], [Some(2), Some(1), Some(3), None, Some(4)]);
        assert_eq!((stem("db/schema.ts"), stem("core/models/__init__.py")), ("schema", "models"));
    }
}
