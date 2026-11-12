//! Finding table declarations in one source, and the lexing they need.

/// One table declared in a source: its name (case folded), the model that maps it, and the start byte.
#[derive(Debug, Clone, PartialEq)]
pub struct TableDef {
    pub table: String,
    pub model: Option<String>,
    pub byte: usize,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Style {
    Py,
    Js,
    Sql,
}

pub const CODE: u8 = 0;
pub const STR: u8 = 1;
pub const COM: u8 = 2;

fn find(b: &[u8], from: usize, pat: &[u8]) -> Option<usize> {
    b.get(from..)?.windows(pat.len()).position(|w| w == pat).map(|i| from + i)
}

/// Marks every byte as code, string or comment. SQL `"x"` is an identifier, so code.
pub fn lex(src: &str, style: Style) -> Vec<u8> {
    let b = src.as_bytes();
    let mut m = vec![CODE; b.len()];
    let mut i = 0;
    while i < b.len() {
        let (c, rest) = (b[i], &b[i..]);
        let line_com = match style {
            Style::Py => c == b'#',
            Style::Js => rest.starts_with(b"//"),
            Style::Sql => rest.starts_with(b"--"),
        };
        let (end, kind) = if line_com {
            (find(b, i, b"\n").unwrap_or(b.len()), COM)
        } else if style != Style::Py && rest.starts_with(b"/*") {
            (find(b, i + 2, b"*/").map_or(b.len(), |e| e + 2), COM)
        } else if style == Style::Py && (rest.starts_with(b"\"\"\"") || rest.starts_with(b"'''")) {
            (find(b, i + 3, &rest[..3]).map_or(b.len(), |e| e + 3), STR)
        } else if c == b'\'' || (style != Style::Sql && c == b'"') || (style == Style::Js && c == b'`') {
            let mut j = i + 1;
            while j < b.len() && b[j] != c && (c == b'`' || b[j] != b'\n') {
                j += if b[j] == b'\\' && style != Style::Sql { 2 } else { 1 };
            }
            ((j + 1).min(b.len()), STR)
        } else {
            i += 1;
            continue;
        };
        m[i..end].fill(kind);
        i = end;
    }
    m
}

pub fn ident_len(s: &str) -> usize {
    s.bytes().take_while(|c| c.is_ascii_alphanumeric() || *c == b'_').count()
}

/// Identifiers with their start bytes.
pub fn idents(src: &str) -> Vec<(usize, &str)> {
    let b = src.as_bytes();
    let (mut out, mut i) = (Vec::new(), 0);
    while i < b.len() {
        if b[i].is_ascii_alphabetic() || b[i] == b'_' {
            let n = ident_len(&src[i..]);
            out.push((i, &src[i..i + n]));
            i += n;
        } else {
            i += 1;
        }
    }
    out
}

/// The quoted string right after `at` (skipping spaces, `(`, `=` and a `name:` label).
fn quoted(src: &str, at: usize) -> Option<String> {
    let mut rest = src.get(at..)?.trim_start_matches(|c: char| c.is_whitespace() || c == '(' || c == '=');
    if let Some(r) = rest.strip_prefix("name:") {
        rest = r.trim_start();
    }
    let q = rest.chars().next().filter(|c| matches!(c, '"' | '\'' | '`'))?;
    let s: String = rest[1..].chars().take_while(|c| *c != q).collect();
    (!s.is_empty() && s.len() <= 128).then_some(s)
}

/// A possibly schema-qualified, possibly quoted SQL name at the start of `r`: the last part, folded.
pub fn sql_ref(r: &str) -> Option<String> {
    let mut s = r;
    let last = loop {
        let close = match s.chars().next()? {
            '"' => Some('"'),
            '`' => Some('`'),
            '[' => Some(']'),
            _ => None,
        };
        let (part, rest) = match close {
            Some(q) => {
                let e = s[1..].find(q)?;
                (&s[1..1 + e], &s[e + 2..])
            }
            None => {
                let n = ident_len(s);
                if n == 0 || s.as_bytes()[0].is_ascii_digit() {
                    return None;
                }
                (&s[..n], &s[n..])
            }
        };
        match rest.strip_prefix('.') {
            Some(r) => s = r,
            None => break part,
        }
    };
    let t = last.to_lowercase();
    (!t.is_empty() && t.len() <= 128 && !t.contains('\n')).then_some(t)
}

/// Python classes: `(name, header, start byte, end byte)` by indentation; headers may span lines.
fn py_classes(src: &str) -> Vec<(String, String, usize, usize)> {
    let mut out: Vec<(String, String, usize, usize)> = Vec::new();
    let (mut at, mut depth) = (0, 0i32);
    for line in src.split_inclusive('\n') {
        if depth > 0 {
            depth += line.matches(['(', '[']).count() as i32 - line.matches([')', ']']).count() as i32;
            if let Some(c) = out.last_mut() {
                c.1.push_str(line);
            }
        } else if !line.starts_with(char::is_whitespace) && !line.trim().is_empty() {
            if let Some(c) = out.last_mut().filter(|c| c.3 == usize::MAX) {
                c.3 = at;
            }
            if let Some(rest) = line.strip_prefix("class ") {
                let n = ident_len(rest);
                let head = rest[n..].to_string();
                depth = head.matches('(').count() as i32 - head.matches(')').count() as i32;
                out.push((rest[..n].to_string(), head, at, usize::MAX));
            }
        }
        at += line.len();
    }
    if let Some(c) = out.last_mut().filter(|c| c.3 == usize::MAX) {
        c.3 = src.len();
    }
    out
}

/// The `const X =` binding just before byte `at`.
fn binding_before(src: &str, at: usize) -> Option<String> {
    let before = src[..at].trim_end().strip_suffix('=')?.trim_end();
    let n = before.bytes().rev().take_while(|c| c.is_ascii_alphanumeric() || *c == b'_').count();
    (n > 0).then(|| before[before.len() - n..].to_string())
}

/// Starts of calls to `f(` that are code and not the tail of a longer name.
fn calls(src: &str, mask: &[u8], f: &str) -> Vec<usize> {
    let b = src.as_bytes();
    src.match_indices(f)
        .map(|(i, _)| i)
        .filter(|&i| mask[i] == CODE && (i == 0 || f.starts_with('.') || !(b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_')))
        .collect()
}

fn sql_defs(src: &str, out: &mut Vec<TableDef>) {
    let mask = lex(src, Style::Sql);
    let toks: Vec<(usize, String)> =
        idents(src).into_iter().filter(|(i, _)| mask[*i] == CODE).map(|(i, w)| (i, w.to_ascii_lowercase())).collect();
    const MODS: [&str; 7] = ["or", "replace", "temp", "temporary", "unlogged", "global", "local"];
    for k in 0..toks.len() {
        let mut j = k + 1;
        match toks[k].1.as_str() {
            "create" => {
                while toks.get(j).is_some_and(|t| MODS.contains(&t.1.as_str())) {
                    j += 1;
                }
            }
            "alter" => {}
            _ => continue,
        }
        let Some((p, "table")) = toks.get(j).map(|(p, w)| (*p, w.as_str())) else { continue };
        let mut r = &src[p + 5..];
        'skip: loop {
            let t = r.trim_start();
            let low = t.get(..t.len().min(16)).unwrap_or(t).to_ascii_lowercase();
            for s in ["if not exists", "if exists", "only"] {
                if low.starts_with(s) && ident_len(&low[s.len()..]) == 0 {
                    r = &t[s.len()..];
                    continue 'skip;
                }
            }
            r = t;
            break;
        }
        if let Some(t) = sql_ref(r) {
            out.push(TableDef { table: t, model: None, byte: toks[k].0 });
        }
    }
}

/// Every table declared in one source. Pure: takes path, language id and text.
pub fn scan(path: &str, lang: &str, src: &str) -> Vec<TableDef> {
    let mut out = Vec::new();
    let def = |t: &str, m: Option<String>, byte| TableDef { table: t.to_lowercase(), model: m, byte };
    if path.ends_with(".sql") {
        sql_defs(src, &mut out);
    } else if path.ends_with(".prisma") {
        let (mut at, mut cur) = (0, None::<(String, usize)>);
        for line in src.split_inclusive('\n') {
            let l = line.trim();
            if let Some(rest) = l.strip_prefix("model ") {
                cur = Some((rest[..ident_len(rest)].to_string(), at));
            } else if let (Some(i), Some((m, b))) = (l.find("@@map"), cur.as_ref()) {
                if let Some(t) = quoted(l, i + 5) {
                    out.push(def(&t, Some(m.clone()), *b));
                    cur = None;
                }
            } else if l.starts_with('}') {
                if let Some((m, b)) = cur.take() {
                    out.push(def(&m, Some(m.clone()), b));
                }
            }
            at += line.len();
        }
    } else if lang == "python" {
        let mask = lex(src, Style::Py);
        let dirs: Vec<&str> = path.split('/').collect();
        let n = dirs.len();
        let app = match (n.checked_sub(2).map(|i| dirs[i]), n.checked_sub(3).map(|i| dirs[i])) {
            (Some("models"), Some(a)) => a,
            (Some(a), _) => a,
            _ => "",
        }
        .to_ascii_lowercase();
        let django = src.contains("django");
        let mut known: Vec<String> = Vec::new();
        for (name, head, s, e) in py_classes(src) {
            if mask.get(s) != Some(&CODE) {
                continue;
            }
            let body = &src[s..e];
            let flat: String = body.chars().filter(|c| !c.is_whitespace()).collect();
            let abstract_ = flat.contains("abstract=True") || flat.contains("__abstract__=True");
            if let Some(i) = body.find("__tablename__") {
                if let Some(t) = quoted(body, i + "__tablename__".len()).filter(|_| !abstract_) {
                    out.push(def(&t, Some(name), s));
                }
                continue;
            }
            let dj =
                head.contains("models.Model") || (django && (head.contains("Model") || known.iter().any(|k| head.contains(k.as_str()))));
            if !dj {
                continue;
            }
            known.push(name.clone());
            if abstract_ {
                continue;
            }
            let t = body
                .find("db_table")
                .and_then(|i| quoted(body, i + "db_table".len()))
                .unwrap_or_else(|| format!("{app}_{}", name.to_ascii_lowercase()));
            out.push(def(&t, Some(name), s));
        }
    } else if matches!(lang, "javascript" | "typescript" | "tsx") {
        let mask = lex(src, Style::Js);
        let mut fs: Vec<String> = ["pgTable(", "mysqlTable(", "sqliteTable("].map(String::from).to_vec();
        if src.contains("Schema(") {
            fs.push(".table(".into());
        }
        // `const createTable = pgTableCreator((n) => \`proj_${n}\`)`: calls take the template.
        let mut tmpl: Vec<(String, String)> = vec![(String::new(), String::new()); fs.len()];
        for c in ["pgTableCreator(", "mysqlTableCreator(", "sqliteTableCreator("] {
            for at in calls(src, &mask, c) {
                let Some(name) = binding_before(src, at) else { continue };
                let win = &src[at..(at + 200).min(src.len())];
                let t = win.find('`').and_then(|i| win[i + 1..].split('`').next()).unwrap_or("");
                let (pre, post) = t.split_once("${").map(|(a, b)| (a, b.split_once('}').map_or("", |x| x.1))).unwrap_or(("", ""));
                fs.push(format!("{name}("));
                tmpl.push((pre.to_string(), post.to_string()));
            }
        }
        for (f, (pre, post)) in fs.iter().zip(&tmpl) {
            for at in calls(src, &mask, f) {
                let Some(t) = quoted(src, at + f.len()) else { continue };
                // `app.table(`: the binding sits before the receiver.
                let recv = src[..at].bytes().rev().take_while(|c| c.is_ascii_alphanumeric() || *c == b'_').count();
                let start = if f.starts_with('.') { at - recv } else { at };
                out.push(def(&format!("{pre}{t}{post}"), binding_before(src, start), at));
            }
        }
        out.sort_by_key(|d| d.byte);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(v: &[TableDef]) -> Vec<(String, Option<String>)> {
        v.iter().map(|d| (d.table.clone(), d.model.clone())).collect()
    }
    fn s(t: &str, m: Option<&str>) -> (String, Option<String>) {
        (t.into(), m.map(String::from))
    }

    #[test]
    fn sqlalchemy_and_django() {
        let sa = "class User(Base):\n    __tablename__ = 'users'\n\nclass Invoice(\n    Base\n):\n    __tablename__ = \"invoices\"\n\nclass Other:\n    pass\n";
        assert_eq!(names(&scan("app/db.py", "python", sa)), [s("users", Some("User")), s("invoices", Some("Invoice"))]);
        let dj = "from django.db import models\nclass Stamped(models.Model):\n    class Meta:\n        abstract = True\nclass Order(Stamped):\n    x = 1\nclass Item(\n    models.Model\n):\n    class Meta:\n        db_table = \"line_items\"\n";
        assert_eq!(names(&scan("shop/models.py", "python", dj)), [s("shop_order", Some("Order")), s("line_items", Some("Item"))]);
        let pkg = "from django.db import models\nclass Profile(models.Model):\n    pass\n";
        assert_eq!(names(&scan("core/models/user.py", "python", pkg)), [s("core_profile", Some("Profile"))]);
    }

    #[test]
    fn drizzle_prisma_sql() {
        let dz = "export const users = pgTable(\"users\", { id: serial() });\n// pgTable(\"ghost\")\nconst posts = sqliteTable('posts', {});\nconst app = pgSchema(\"app\");\nexport const accounts = app.table(\"accounts\", {});\nconst createTable = pgTableCreator((n) => `proj_${n}`);\nexport const notes = createTable(\"notes\", {});";
        assert_eq!(
            names(&scan("db/schema.ts", "typescript", dz)),
            [s("users", Some("users")), s("posts", Some("posts")), s("accounts", Some("accounts")), s("proj_notes", Some("notes"))]
        );
        let pr =
            "model User {\n  id Int\n}\nmodel Post {\n  id Int\n  @@map(\"posts\")\n}\nmodel Session {\n  @@map(name: \"sessions\")\n}\n";
        assert_eq!(
            names(&scan("schema.prisma", "", pr)),
            [s("user", Some("User")), s("posts", Some("Post")), s("sessions", Some("Session"))]
        );
        let sql = "-- we will create table ghosts later\nCREATE TABLE IF NOT EXISTS \"public\".\"Users\" (id int);\nalter table only orders add column x int;\nCREATE UNLOGGED\nTABLE logs (x int);\ncreate temp table \"line items\" (x int);";
        assert_eq!(
            names(&scan("migrations/001.sql", "", sql)),
            [s("users", None), s("orders", None), s("logs", None), s("line items", None)]
        );
    }

    #[test]
    fn lex_marks_strings_and_comments() {
        let m = lex("a = 'x' # c\n", Style::Py);
        assert_eq!((m[0], m[4], m[9]), (CODE, STR, COM));
        assert_eq!(sql_ref("public.invoices x"), Some("invoices".into()));
        assert_eq!(sql_ref("\"public\".\"Line Items\""), Some("line items".into()));
    }
}
