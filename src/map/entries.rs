//! Entry points: CLI mains, HTTP handlers, test roots, exported public API.
//! Found from indexed symbols plus plain-text patterns in their files.

use super::file_of;
use crate::store::{Node, Store};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Entry {
    pub symbol: String,
    pub kind: String,
    pub file: String,
}

pub fn entry_points(db: &Store) -> Vec<Entry> {
    let nodes = db.nodes_where("id >= 0", []).unwrap_or_default();
    let by_id: HashMap<i64, Node> = nodes.iter().map(|n| (n.id, n.clone())).collect();
    let file_id: HashMap<&str, i64> = nodes.iter().filter(|n| n.kind == "file").map(|n| (n.path.as_str(), n.id)).collect();
    let mut file_syms: BTreeMap<i64, Vec<Node>> = BTreeMap::new();
    for n in &nodes {
        if matches!(n.kind.as_str(), "file" | "package" | "route" | "dependency" | "env" | "table") {
            continue;
        }
        if let Some(id) = file_of(n.id, &by_id).and_then(|f| file_id.get(f.as_str()).copied()) {
            file_syms.entry(id).or_default().push(n.clone());
        }
    }

    let mut out: Vec<Entry> = Vec::new();
    // Indexed HTTP routes: a HANDLES edge runs route → handler.
    for e in db.all_edges().unwrap_or_default().iter().filter(|e| e.kind == "HANDLES") {
        if let Some(h) = by_id.get(&e.dst) {
            let file = file_of(h.id, &by_id).unwrap_or_else(|| h.path.clone());
            push(&mut out, &h.name, "http", &file);
        }
    }
    for f in nodes.iter().filter(|n| n.kind == "file") {
        let text = std::fs::read_to_string(db.root.join(&f.path)).unwrap_or_default();
        let lang = f.lang.as_str();
        let file = f.path.rsplit('/').next().unwrap_or(&f.path);
        let syms = file_syms.get(&f.id).cloned().unwrap_or_default();
        for s in &syms {
            let n = s.name.as_str();
            if n == "main" && matches!(lang, "rust" | "go" | "c" | "cpp" | "java") {
                push(&mut out, n, if file == "build.rs" { "build" } else { "cli" }, &f.path);
            }
            if matches!(lang, "python" | "javascript" | "typescript" | "go") && http_name(n) {
                push(&mut out, n, "http", &f.path);
            }
            if test_file(&f.path) && n.to_lowercase().contains("test") {
                push(&mut out, n, "test", &f.path);
            }
        }
        // Rust tests marked `#[test]`, wherever they live.
        if lang == "rust" {
            for n in rust_tests(&text) {
                push(&mut out, &n, "test", &f.path);
            }
        }
        // Python mains: `if __name__ == "__main__":` guards.
        if lang == "python" && text.contains("if __name__") {
            let sym = if syms.iter().any(|s| s.name == "main") { "main".to_string() } else { stem(&f.path) };
            push(&mut out, &sym, "cli", &f.path);
        }
        // Decorator-routed HTTP handlers (`@app.route`, `@get`, …).
        if matches!(lang, "python" | "javascript" | "typescript") {
            for n in decorated_handlers(&text) {
                push(&mut out, &n, "http", &f.path);
            }
        }
        // Exported public API: crate roots and index/mod modules.
        match (lang, file) {
            ("rust", "lib.rs" | "main.rs") => {
                for n in pub_names(&text) {
                    push(&mut out, &n, "api", &f.path);
                }
            }
            ("typescript", "index.ts" | "index.tsx" | "mod.ts") | ("javascript", "index.js" | "index.mjs" | "mod.js") => {
                for n in export_names(&text) {
                    push(&mut out, &n, "api", &f.path);
                }
            }
            _ => {}
        }
    }
    let files: Vec<&str> = file_id.keys().copied().collect();
    super::manifests::manifest_entries(&db.root, &files, &mut |s, k, f| push(&mut out, s, k, f));
    out.sort_by(|a, b| (a.file.as_str(), a.kind.as_str(), a.symbol.as_str()).cmp(&(b.file.as_str(), b.kind.as_str(), b.symbol.as_str())));
    out.dedup();
    out
}

fn push(out: &mut Vec<Entry>, symbol: &str, kind: &str, file: &str) {
    out.push(Entry { symbol: symbol.into(), kind: kind.into(), file: file.into() });
}

/// Handler by name alone. `get_*` style prefixes are not enough without a
/// route or decorator: they match plain getters.
fn http_name(n: &str) -> bool {
    n.starts_with("handle") || n.ends_with("Handler") || n.ends_with("_handler")
}

/// Names of Rust fns under `#[test]` or `#[tokio::test]`.
fn rust_tests(text: &str) -> Vec<String> {
    let lines: Vec<&str> = text.lines().collect();
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim();
        if t != "#[test]" && !t.starts_with("#[tokio::test") {
            continue;
        }
        for l in lines[i + 1..].iter().take(4) {
            let l = l.trim_start();
            let l = l.strip_prefix("pub ").unwrap_or(l);
            let l = l.strip_prefix("async ").unwrap_or(l);
            if let Some(rest) = l.strip_prefix("fn ") {
                out.push(ident(rest));
                break;
            }
        }
    }
    out
}

fn test_file(path: &str) -> bool {
    let (dir, file) = path.rsplit_once('/').unwrap_or(("", path));
    let stem = stem(path).to_lowercase();
    let dir = dir.to_lowercase();
    dir.ends_with("test")
        || dir.ends_with("tests")
        || file.starts_with("test_")
        || file.ends_with("_test.go")
        || file.contains(".test.")
        || stem.ends_with("_spec")
}

fn stem(path: &str) -> String {
    let file = path.rsplit('/').next().unwrap_or(path);
    file.rsplit_once('.').map(|(s, _)| s.to_string()).unwrap_or_else(|| file.to_string())
}

/// Function names whose decorator line marks them as HTTP handlers.
fn decorated_handlers(text: &str) -> Vec<String> {
    let lines: Vec<&str> = text.lines().collect();
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim_start();
        if !t.starts_with('@') || !is_http_decorator(t) {
            continue;
        }
        for l in lines[i + 1..].iter().take(4) {
            let t = l.trim_start();
            if t.is_empty() || t.starts_with('@') {
                continue;
            }
            if let Some(n) = def_name(t) {
                out.push(n);
            }
            break;
        }
    }
    out
}

fn is_http_decorator(d: &str) -> bool {
    let d = d.to_lowercase();
    d.contains(".route(")
        || d.contains("route(")
        || d.contains(".get(")
        || d.contains(".post(")
        || d.contains(".put(")
        || d.contains(".delete(")
        || d.contains(".patch(")
        || ["@get(", "@post(", "@put(", "@delete(", "@patch("].iter().any(|p| d.starts_with(p))
}

fn def_name(line: &str) -> Option<String> {
    for kw in ["async def ", "def ", "function ", "async function "] {
        if let Some(rest) = line.strip_prefix(kw) {
            return Some(ident(rest));
        }
    }
    None
}

/// `pub` items in a Rust crate root (lib.rs / main.rs).
fn pub_names(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let t = line.trim_start();
        let Some(rest) = t.strip_prefix("pub ") else { continue };
        if rest.starts_with('(') || rest.starts_with("use ") {
            continue;
        }
        let rest = rest.strip_prefix("async ").unwrap_or(rest);
        let kw = rest.split_whitespace().next().unwrap_or("");
        if matches!(kw, "fn" | "struct" | "enum" | "trait" | "const" | "static" | "type" | "mod") {
            let after = rest.strip_prefix(kw).unwrap_or(rest);
            out.push(ident(after));
        }
    }
    out
}

/// Exported names in an index/mod module (TypeScript / JavaScript).
fn export_names(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let t = line.trim_start();
        let Some(rest) = t.strip_prefix("export ") else { continue };
        if let Some(braced) = rest.strip_prefix('{') {
            let Some(end) = braced.split_once('}') else { continue };
            for item in end.0.split(',') {
                let n = ident(item.trim());
                if !n.is_empty() {
                    out.push(n);
                }
            }
            continue;
        }
        let rest = rest.strip_prefix("default ").unwrap_or(rest);
        let rest = rest.strip_prefix("async ").unwrap_or(rest);
        let kw = rest.split_whitespace().next().unwrap_or("");
        if matches!(kw, "function" | "class" | "const" | "let" | "var" | "interface" | "type" | "enum") {
            let after = rest.strip_prefix(kw).unwrap_or(rest);
            let n = ident(after);
            if !n.is_empty() {
                out.push(n);
            }
        }
    }
    out
}

/// First identifier in a string: `fn run() -> …` → `run`.
fn ident(s: &str) -> String {
    s.trim_start_matches(|c: char| !c.is_alphanumeric() && c != '_').chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_names_and_api() {
        assert!(http_name("handleLogin"));
        assert!(!http_name("post_user"));
        assert_eq!(rust_tests("#[test]\nfn a() {}\n#[tokio::test]\nasync fn b() {}\nfn c() {}"), vec!["a", "b"]);
        assert!(!http_name("getUser"));
        assert_eq!(ident("run() -> u32 {"), "run");
        assert_eq!(pub_names("pub async fn go();\npub use x;\npub struct S;").len(), 2);
        assert_eq!(export_names("export default make();\nexport function render() {}").len(), 1);
    }
}
