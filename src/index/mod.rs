//! The indexer: files → tree-sitter → symbols, calls, imports → knowledge graph.

pub mod langs;
pub mod packs;

use crate::git::Repo;
use crate::store::{Edge, Node, Store};
use anyhow::Result;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, AtomicUsize, Ordering::Relaxed};
use std::time::Instant;
use streaming_iterator::StreamingIterator;
use tree_sitter::{Parser, QueryCursor};

const MAX_FILE_BYTES: u64 = 1_000_000;

/// Live progress of the stored index build (`run`), polled by the web UI's loader.
/// Snapshot and worktree builds for contrast views don't report here.
pub struct Progress {
    active: AtomicBool,
    phase: AtomicU8,
    done: AtomicUsize,
    total: AtomicUsize,
    started_ms: AtomicU64,
}

pub static PROGRESS: Progress = Progress {
    active: AtomicBool::new(false),
    phase: AtomicU8::new(0),
    done: AtomicUsize::new(0),
    total: AtomicUsize::new(0),
    started_ms: AtomicU64::new(0),
};

const PHASES: [&str; 6] = ["idle", "walk", "parse", "link", "cluster", "write"];

impl Progress {
    fn phase(&self, p: u8, total: usize) {
        self.phase.store(p, Relaxed);
        self.done.store(0, Relaxed);
        self.total.store(total, Relaxed);
    }

    pub fn json(&self) -> serde_json::Value {
        let active = self.active.load(Relaxed);
        let started = self.started_ms.load(Relaxed);
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        serde_json::json!({
            "active": active,
            "phase": PHASES[self.phase.load(Relaxed) as usize % PHASES.len()],
            "done": self.done.load(Relaxed),
            "total": self.total.load(Relaxed),
            "elapsed_ms": if active { now.saturating_sub(started) } else { 0 },
        })
    }
}

/// Marks the build finished even if it bails out early.
struct ProgressGuard;
impl Drop for ProgressGuard {
    fn drop(&mut self) {
        PROGRESS.phase(0, 0);
        PROGRESS.active.store(false, Relaxed);
    }
}

/// Names so generic that a cross-file, name-only match is almost always wrong
/// (iterator/collection/stdlib methods). Same-file matches are still linked.
const COMMON: &[&str] = &[
    "new",
    "next",
    "get",
    "set",
    "push",
    "pop",
    "map",
    "iter",
    "len",
    "clone",
    "unwrap",
    "to_string",
    "insert",
    "remove",
    "contains",
    "join",
    "split",
    "find",
    "filter",
    "collect",
    "open",
    "close",
    "read",
    "write",
    "run",
    "load",
    "save",
    "update",
    "delete",
    "add",
    "append",
    "keys",
    "values",
    "items",
    "format",
    "parse",
    "send",
    "emit",
    "call",
    "apply",
    "bind",
    "then",
    "catch",
    "log",
    "print",
    "println",
    "init",
    "start",
    "stop",
    "reset",
    "clear",
    "size",
    "is_empty",
    "from",
    "into",
    "default",
    "fmt",
    "eq",
    "hash",
    "cmp",
    "toString",
    "forEach",
    "reduce",
    "some",
    "every",
    "slice",
    "splice",
    "resolve",
    "reject",
    "render",
    "use",
    // Standard-library methods that a local definition of the same name would otherwise capture.
    "as_str",
    "as_ref",
    "as_mut",
    "as_bytes",
    "as_deref",
    "as_slice",
    "to_owned",
    "to_vec",
    "trim",
    "ok",
    "err",
    "expect",
    "unwrap_or",
    "unwrap_or_default",
    "unwrap_or_else",
    "map_err",
    "and_then",
    "or_else",
    "is_some",
    "is_none",
    "lock",
    "borrow",
    "path",
    "name",
    "value",
    "text",
    "json",
    "kind",
    "id",
    "display",
    "replace",
    "starts_with",
    "ends_with",
    "lines",
    "chars",
    "bytes",
    "extend",
    "sort",
    "dedup",
    "first",
    "last",
    "entry",
    "count",
    "sum",
    "max",
    "min",
    "abs",
    "includes",
    "indexOf",
    "push_str",
    "toLowerCase",
    "toUpperCase",
    "trim_start_matches",
    "trim_end_matches",
    "handle",
    "main",
    "test",
    "string",
    "list",
    "dict",
    "str",
    "int",
    "len",
];

#[derive(Debug, Default)]
struct Def {
    name: String,
    kind: &'static str,
    start_line: u32,
    end_line: u32,
    start_byte: usize,
    end_byte: usize,
    parent_name: Option<String>,
    /// Hash of the definition's source text, used to detect modified symbols.
    hash: u64,
}

#[derive(Debug, Default)]
struct ParsedFile {
    path: String,
    lang: &'static str,
    loc: u32,
    defs: Vec<Def>,
    calls: Vec<(String, usize)>,
    imports: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct IndexStats {
    pub files: usize,
    pub parsed: usize,
    pub symbols: usize,
    pub edges: usize,
    pub communities: usize,
    pub millis: u128,
}

/// Collect candidate source files, honouring .gitignore.
fn walk(root: &Path) -> Vec<(String, Option<&'static str>)> {
    let mut out = Vec::new();
    // kula.toml: extra excludes (gitignore-style) and the size ceiling.
    let cfg = crate::config::Config::load(root).unwrap_or_default();
    let max_bytes = if cfg.index.max_file_kb > 0 { cfg.index.max_file_kb * 1024 } else { MAX_FILE_BYTES };
    let mut ov = ignore::overrides::OverrideBuilder::new(root);
    for g in &cfg.index.exclude {
        let _ = ov.add(&format!("!{g}"));
    }
    let mut walker = ignore::WalkBuilder::new(root);
    if let Ok(o) = ov.build() {
        walker.overrides(o);
    }
    let walker = walker
        .hidden(true)
        .git_ignore(true)
        .filter_entry(|e| {
            let n = e.file_name().to_string_lossy();
            !SKIP_DIRS.contains(&n.as_ref())
        })
        .build();
    for entry in walker.flatten() {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        if entry.metadata().map(|m| m.len() > max_bytes).unwrap_or(true) {
            continue;
        }
        let rel = match entry.path().strip_prefix(root) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        let lang = langs::for_path(&rel);
        out.push((rel, lang));
    }
    out.sort();
    out
}

fn parse_source(rel: &str, src: &str, lang: &langs::Lang, parser: &mut Parser) -> Option<ParsedFile> {
    let tree = parser.parse(src, None)?;
    let bytes = src.as_bytes();
    let mut pf = ParsedFile { path: rel.to_string(), lang: lang.id, loc: src.lines().count() as u32, ..Default::default() };
    let mut seen_defs: HashSet<(usize, usize)> = HashSet::new();

    for q in &lang.queries {
        let names = q.capture_names();
        let mut cursor = QueryCursor::new();
        let mut matches = cursor.matches(q, tree.root_node(), bytes);
        while let Some(m) = matches.next() {
            // tags.scm style: @name plus @definition.<kind> / @reference.call on the
            // enclosing node; kula style: @def.<kind> / @call / @import, with an
            // optional @scope for the definition's extent.
            let mut scope = None;
            let mut tag_def = None;
            let mut tag_call = false;
            for cap in m.captures() {
                let cname = names[cap.index as usize];
                if cname == "scope" {
                    scope = Some(cap.node);
                } else if let Some(k) = cname.strip_prefix("definition.") {
                    scope = Some(cap.node);
                    tag_def = Some(k);
                } else if cname == "reference.call" {
                    tag_call = true;
                }
            }
            for cap in m.captures() {
                let cname = names[cap.index as usize];
                if cname.starts_with('_') {
                    continue;
                }
                let cname = match (cname, tag_def, tag_call) {
                    ("name", Some(k), _) => match k {
                        "method" => "def.method",
                        "class" | "module" | "type" | "struct" | "enum" | "object" | "record" | "namespace" => "def.class",
                        "interface" | "trait" | "protocol" => "def.interface",
                        "function" | "macro" | "procedure" | "subroutine" | "rule" | "task" => "def.function",
                        // constants, fields, variables: not symbols kula tracks
                        _ => continue,
                    },
                    ("name", None, true) => "call",
                    (c, _, _) => c,
                };
                let node = cap.node;
                let raw = node.utf8_text(bytes).unwrap_or("");
                // Names some grammars only have as strings (`define "helper"`) lose their quotes.
                let text = if cname == "import" { raw } else { raw.trim().trim_matches(|c| c == '"' || c == '\'' || c == '`') }.to_string();
                if let Some(kind) = cname.strip_prefix("def.") {
                    // Definition range: the @scope capture, else the nearest ancestor that is a def kind.
                    let mut def_node = scope.unwrap_or_else(|| node.parent().unwrap_or(node));
                    let mut cur = if scope.is_some() { None } else { Some(node) };
                    let mut found = false;
                    while let Some(n) = cur {
                        if lang.def_kinds.contains(&n.kind()) {
                            def_node = n;
                            found = true;
                            break;
                        }
                        cur = n.parent();
                    }
                    if !found && scope.is_none() {
                        def_node = enclosing_def(node).unwrap_or(def_node);
                    }
                    let key = (def_node.start_byte(), node.start_byte());
                    if !seen_defs.insert(key) {
                        continue;
                    }
                    // Method detection and owner resolution.
                    let mut kind: &'static str = match kind {
                        "method" => "method",
                        "class" => "class",
                        "interface" => "interface",
                        _ => "function",
                    };
                    let mut parent_name = None;
                    let mut anc = def_node.parent();
                    while let Some(a) = anc {
                        if lang.class_kinds.contains(&a.kind()) {
                            if kind == "function" {
                                kind = "method";
                            }
                            let owner = a
                                .child_by_field_name("type")
                                .or_else(|| a.child_by_field_name("name"))
                                .or_else(|| {
                                    let mut c = a.walk();
                                    let first =
                                        a.named_children(&mut c).find(|n| n.kind().contains("identifier") || n.kind().ends_with("name"));
                                    first
                                })
                                .and_then(|n| n.utf8_text(bytes).ok())
                                .map(|s| s.split('<').next().unwrap_or(s).trim().to_string());
                            parent_name = owner;
                            break;
                        }
                        anc = a.parent();
                    }
                    if lang.id == "go" && kind == "method" {
                        // func (r *Recv) Name() – owner is the receiver type.
                        parent_name = def_node.child_by_field_name("receiver").and_then(|r| r.utf8_text(bytes).ok()).and_then(|t| {
                            t.split_whitespace().last().map(|s| s.trim_matches(|c: char| !c.is_alphanumeric() && c != '_').to_string())
                        });
                    }
                    // A name is one token; anything else is a pattern that captured too much.
                    if text.is_empty() || text.len() > 120 || text.contains('\n') {
                        continue;
                    }
                    pf.defs.push(Def {
                        name: text,
                        kind,
                        start_line: def_node.start_position().row as u32 + 1,
                        end_line: def_node.end_position().row as u32 + 1,
                        start_byte: def_node.start_byte(),
                        end_byte: def_node.end_byte(),
                        parent_name,
                        hash: fnv(&bytes[def_node.start_byte()..def_node.end_byte()]),
                    });
                } else if cname == "call" {
                    if !text.is_empty() && text.len() <= 100 && !text.contains('\n') {
                        pf.calls.push((text, node.start_byte()));
                    }
                } else if cname == "import" {
                    let t = text.trim();
                    let t = t.strip_prefix("import ").map(str::trim).unwrap_or(t);
                    if !t.is_empty() && t.len() <= 300 && t.lines().count() <= 4 {
                        pf.imports.push(t.to_string());
                    }
                }
            }
        }
    }
    pf.defs.sort_by_key(|d| (d.start_byte, std::cmp::Reverse(d.end_byte)));
    Some(pf)
}

/// For grammars without `def_kinds`: the nearest ancestor that reads like a
/// definition, else the top-level statement holding the name.
fn enclosing_def(name: tree_sitter::Node) -> Option<tree_sitter::Node> {
    const HINTS: &[&str] = &[
        "function",
        "method",
        "def",
        "decl",
        "proc",
        "sub",
        "fn",
        "macro",
        "rule",
        "class",
        "struct",
        "module",
        "item",
        "form",
        "_lit",
        "tup",
        "binding",
        "signature",
    ];
    let mut cur = name.parent();
    let mut top = None;
    while let Some(n) = cur {
        if n.end_byte() - n.start_byte() > name.end_byte() - name.start_byte() && HINTS.iter().any(|h| n.kind().contains(h)) {
            return Some(n);
        }
        if n.parent().is_some_and(|p| p.parent().is_none()) {
            top = Some(n);
        }
        cur = n.parent();
    }
    top
}

fn strip_ext(p: &str) -> &str {
    match p.rfind('.') {
        Some(i) if p[i..].len() <= 5 && !p[i..].contains('/') => &p[..i],
        _ => p,
    }
}

fn normalize(parts: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for seg in parts.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            s => out.push(s),
        }
    }
    out.join("/")
}

/// The package an unresolved import names, or None when it points inside the repo.
/// `@scope/pkg/x` → `@scope/pkg`, `lodash/fp` → `lodash`, `numpy.linalg` → `numpy`,
/// `serde::Deserialize` → `serde`, `github.com/a/b/c` → `github.com/a/b`.
pub(crate) fn package_name(raw: &str, lang: &str) -> Option<String> {
    let s = raw.trim().trim_matches(|c| c == '"' || c == '\'' || c == '`');
    if s.is_empty() {
        return None;
    }
    let name = match lang {
        "javascript" | "typescript" | "tsx" => {
            if s.starts_with('.')
                || s.starts_with('/')
                || s.starts_with('@') && !s.contains('/')
                || s.starts_with("~/")
                || s.starts_with("@/")
            {
                return None;
            }
            let s = s.strip_prefix("node:").map(|b| format!("node:{}", b.split('/').next().unwrap_or(b))).unwrap_or_else(|| s.to_string());
            let mut it = s.split('/');
            let first = it.next()?;
            if first.starts_with('@') { format!("{first}/{}", it.next()?) } else { first.to_string() }
        }
        "python" => {
            if s.starts_with('.') {
                return None;
            }
            s.split('.').next()?.to_string()
        }
        "rust" => {
            let first = s.split("::").next()?.trim();
            if matches!(first, "crate" | "self" | "super" | "") || !s.contains("::") {
                return None;
            }
            first.to_string()
        }
        "go" => {
            let segs: Vec<&str> = s.split('/').collect();
            if segs[0].contains('.') { segs.iter().take(3).copied().collect::<Vec<_>>().join("/") } else { segs[0].to_string() }
        }
        _ => return None,
    };
    let ok = !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || "-_.@/:".contains(c));
    ok.then_some(name)
}

/// Resolve an import string to indexed files.
fn resolve_import(
    raw: &str,
    from: &str,
    lang: &str,
    by_stem: &HashMap<String, Vec<usize>>,
    by_dir: &HashMap<String, Vec<usize>>,
) -> Vec<usize> {
    let s = raw.trim().trim_matches(|c| c == '"' || c == '\'' || c == '`');
    let dir = from.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    let suffix_lookup = |key: &str| -> Vec<usize> {
        if key.is_empty() {
            return vec![];
        }
        if let Some(v) = by_stem.get(key) {
            return v.clone();
        }
        let tail = format!("/{key}");
        let mut hits: Vec<usize> = by_stem.iter().filter(|(k, _)| k.ends_with(&tail)).flat_map(|(_, v)| v.clone()).collect();
        hits.sort();
        hits.truncate(4);
        hits
    };
    match lang {
        "javascript" | "typescript" | "tsx" => {
            if s.starts_with('.') {
                let joined = normalize(&format!("{dir}/{s}"));
                let key = strip_ext(&joined).to_string();
                by_stem.get(&key).or_else(|| by_stem.get(&format!("{key}/index"))).cloned().unwrap_or_default()
            } else {
                vec![]
            }
        }
        "python" => {
            let lead = s.chars().take_while(|c| *c == '.').count();
            let body = s[lead..].replace('.', "/");
            if lead > 0 {
                let mut base = dir.to_string();
                for _ in 1..lead {
                    base = base.rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_default();
                }
                let key = normalize(&format!("{base}/{body}"));
                by_stem.get(&key).or_else(|| by_stem.get(&format!("{key}/__init__"))).cloned().unwrap_or_default()
            } else {
                let mut r = suffix_lookup(&body);
                if r.is_empty() {
                    r = suffix_lookup(&format!("{body}/__init__"));
                }
                r
            }
        }
        "rust" => {
            // `use crate::a::b::{C, D}` or `mod name;`
            let path = s.split('{').next().unwrap_or(s).trim_end_matches("::");
            let segs: Vec<&str> = path.split("::").filter(|p| !matches!(*p, "crate" | "self" | "super" | "" | "*")).collect();
            if segs.len() == 1 && !s.contains("::") {
                // mod item: sibling file
                let base = if from.ends_with("mod.rs") || from.ends_with("main.rs") || from.ends_with("lib.rs") {
                    dir.to_string()
                } else {
                    strip_ext(from).to_string()
                };
                let key = normalize(&format!("{base}/{}", segs[0]));
                return by_stem.get(&key).or_else(|| by_stem.get(&format!("{key}/mod"))).cloned().unwrap_or_default();
            }
            for n in (1..=segs.len()).rev() {
                let key = segs[..n].join("/");
                let mut r = suffix_lookup(&key);
                if r.is_empty() {
                    r = suffix_lookup(&format!("{key}/mod"));
                }
                if !r.is_empty() {
                    return r;
                }
            }
            vec![]
        }
        "go" => {
            let tail = s.rsplit('/').take(2).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("/");
            let last = s.rsplit('/').next().unwrap_or(s);
            by_dir
                .iter()
                .filter(|(d, _)| {
                    d.ends_with(&format!("/{tail}")) || d.as_str() == tail || d.ends_with(&format!("/{last}")) || d.as_str() == last
                })
                .flat_map(|(_, v)| v.iter().copied().take(12))
                .collect()
        }
        "java" | "c" | "cpp" | "csharp" | "ruby" | "php" => vec![],
        _ => {
            // Generic: `./x/y`, `"pkg/mod.ext"`, `<a/b.h>`, `Data.List`, `a::b`, `a:b`.
            let s = s.trim_matches(|c| matches!(c, '<' | '>' | '(' | ')' | ' '));
            if s.is_empty() || s.contains(char::is_whitespace) {
                return vec![];
            }
            if s.starts_with("./") || s.starts_with("../") {
                let joined = normalize(&format!("{dir}/{s}"));
                return by_stem.get(strip_ext(&joined)).cloned().unwrap_or_default();
            }
            let path = if s.contains('/') { strip_ext(s).to_string() } else { s.replace("::", "/").replace([':', '.'], "/") };
            let segs: Vec<&str> = path.split('/').filter(|p| !p.is_empty() && *p != "*").collect();
            // A bare first segment (`kotlin` of `kotlin.math.max`) is too vague to match on.
            let floor = if segs.len() > 2 { 2 } else { 1 };
            for n in (floor..=segs.len()).rev() {
                let r = suffix_lookup(&segs[..n].join("/"));
                if !r.is_empty() {
                    return r;
                }
            }
            vec![]
        }
    }
}

/// FNV-1a, stable across runs and platforms.
fn fnv(b: &[u8]) -> u64 {
    b.iter().fold(0xcbf29ce484222325u64, |h, x| (h ^ *x as u64).wrapping_mul(0x100000001b3))
}

/// A fully built (not yet stored) knowledge graph.
pub struct Built {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub communities: Vec<crate::store::Community>,
    /// Source hash per node id (0 for files).
    pub hashes: Vec<u64>,
    pub files: usize,
    pub parsed: usize,
}

pub type Reader<'a> = &'a (dyn Fn(&str) -> Option<String> + Sync);

/// Build a graph from a file list and a content reader (working tree or git objects).
pub fn build(files: &[(String, Option<&'static str>)], read: Reader) -> Built {
    build_with(files, read, None)
}

fn build_with(files: &[(String, Option<&'static str>)], read: Reader, progress: Option<&'static Progress>) -> Built {
    let source: Vec<(String, &'static str)> = files.iter().filter_map(|(p, l)| l.map(|l| (p.clone(), l))).collect();

    if let Some(p) = progress {
        p.phase(2, source.len());
    }
    langs::warm(source.iter().map(|(_, l)| *l));
    // Parse in parallel.
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(16);
    let chunk = source.len().div_ceil(threads).max(1);
    let parsed: Vec<ParsedFile> = std::thread::scope(|s| {
        let handles: Vec<_> = source
            .chunks(chunk)
            .map(|batch| {
                s.spawn(move || {
                    let read = read;
                    let mut parser = Parser::new();
                    let mut out = Vec::new();
                    for (path, lid) in batch {
                        let Some(src) = read(path) else { continue };
                        let Some(lang) = langs::get(langs::refine(lid, &src)) else { continue };
                        if parser.set_language(&lang.language).is_err() {
                            continue;
                        }
                        if let Some(pf) = parse_source(path, &langs::prepare(lang.id, &src), lang, &mut parser) {
                            out.push(pf);
                        }
                        if let Some(p) = progress {
                            p.done.fetch_add(1, Relaxed);
                        }
                    }
                    out
                })
            })
            .collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    });

    if let Some(p) = progress {
        p.phase(3, 0);
    }
    // ---- Build nodes ----------------------------------------------------
    let mut nodes: Vec<Node> = Vec::new();
    let mut edges: Vec<Edge> = Vec::new();
    let mut file_id: HashMap<String, usize> = HashMap::new();
    let lang_of: HashMap<&str, &str> = parsed.iter().map(|p| (p.path.as_str(), p.lang)).collect();

    let loc_of: HashMap<&str, u32> = parsed.iter().map(|p| (p.path.as_str(), p.loc)).collect();
    for (path, _) in files {
        let id = nodes.len();
        let loc = loc_of.get(path.as_str()).copied().unwrap_or(0);
        nodes.push(Node {
            id: id as i64,
            kind: "file".into(),
            name: path.rsplit('/').next().unwrap_or(path).to_string(),
            path: path.clone(),
            lang: lang_of.get(path.as_str()).map(|s| s.to_string()).unwrap_or_default(),
            start_line: 1,
            end_line: loc as i64,
            parent: None,
            community: 0,
        });
        file_id.insert(path.clone(), id);
    }
    // Directory lookups for import resolution (source files only).
    let mut by_stem: HashMap<String, Vec<usize>> = HashMap::new();
    let mut by_dir: HashMap<String, Vec<usize>> = HashMap::new();
    for pf in &parsed {
        let fid = file_id[&pf.path];
        by_stem.entry(strip_ext(&pf.path).to_string()).or_default().push(fid);
        let d = pf.path.rsplit_once('/').map(|(d, _)| d).unwrap_or("").to_string();
        by_dir.entry(d).or_default().push(fid);
    }

    // Symbols per file, with ids.
    let mut hashes: Vec<u64> = vec![0; nodes.len()];
    let mut sym_ids: Vec<Vec<usize>> = Vec::with_capacity(parsed.len());
    let mut by_name: HashMap<String, Vec<usize>> = HashMap::new();
    for pf in &parsed {
        let fid = file_id[&pf.path];
        let mut ids = Vec::new();
        for d in &pf.defs {
            let id = nodes.len();
            nodes.push(Node {
                id: id as i64,
                kind: d.kind.into(),
                name: d.name.clone(),
                path: pf.path.clone(),
                lang: pf.lang.into(),
                start_line: d.start_line as i64,
                end_line: d.end_line as i64,
                parent: Some(fid as i64),
                community: 0,
            });
            by_name.entry(d.name.clone()).or_default().push(id);
            hashes.push(d.hash);
            ids.push(id);
        }
        // Owner links (class → method), else file → symbol.
        for (i, d) in pf.defs.iter().enumerate() {
            let owner =
                d.parent_name.as_ref().and_then(|pn| pf.defs.iter().position(|o| &o.name == pn && matches!(o.kind, "class" | "interface")));
            match owner {
                Some(o) if o != i => {
                    nodes[ids[i]].parent = Some(ids[o] as i64);
                    edges.push(Edge { src: ids[o] as i64, dst: ids[i] as i64, kind: "CONTAINS".into(), weight: 1.0 });
                }
                _ => edges.push(Edge { src: fid as i64, dst: ids[i] as i64, kind: "CONTAINS".into(), weight: 1.0 }),
            }
        }
        sym_ids.push(ids);
    }

    // Imports. What resolves to no indexed file and names a package becomes a
    // `package` node (path `pkg:<name>`), so dependencies sit in the graph too.
    let mut imports_of: HashMap<usize, HashSet<usize>> = HashMap::new();
    let mut pkg_id: HashMap<String, usize> = HashMap::new();
    let mut pkg_edges: HashSet<(usize, usize)> = HashSet::new();
    for pf in &parsed {
        let fid = file_id[&pf.path];
        for imp in &pf.imports {
            let targets = resolve_import(imp, &pf.path, pf.lang, &by_stem, &by_dir);
            if targets.is_empty() {
                if let Some(name) = package_name(imp, pf.lang) {
                    let pid = *pkg_id.entry(name.clone()).or_insert_with(|| {
                        nodes.push(Node {
                            id: nodes.len() as i64,
                            kind: "package".into(),
                            path: format!("pkg:{name}"),
                            name,
                            lang: pf.lang.into(),
                            start_line: 0,
                            end_line: 0,
                            parent: None,
                            community: 0,
                        });
                        hashes.push(0);
                        nodes.len() - 1
                    });
                    if pkg_edges.insert((fid, pid)) {
                        edges.push(Edge { src: fid as i64, dst: pid as i64, kind: "IMPORTS".into(), weight: 1.0 });
                    }
                }
            }
            for target in targets {
                if target != fid && imports_of.entry(fid).or_default().insert(target) {
                    edges.push(Edge { src: fid as i64, dst: target as i64, kind: "IMPORTS".into(), weight: 1.0 });
                }
            }
        }
    }

    // Calls.
    use langs::family;
    let mut call_set: HashSet<(usize, usize)> = HashSet::new();
    for (pi, pf) in parsed.iter().enumerate() {
        let fid = file_id[&pf.path];
        let ids = &sym_ids[pi];
        let imported = imports_of.get(&fid);
        for (name, byte) in &pf.calls {
            // Innermost enclosing def that is callable (or any def) → caller.
            let caller = pf
                .defs
                .iter()
                .enumerate()
                .filter(|(_, d)| d.start_byte <= *byte && *byte < d.end_byte)
                .min_by_key(|(_, d)| d.end_byte - d.start_byte)
                .map(|(i, _)| ids[i])
                .unwrap_or(fid);
            let Some(cands) = by_name.get(name) else { continue };
            // A name only links within one language family: a TypeScript call to
            // `confirm` is never the Rust function of the same name.
            let fam = family(pf.lang);
            let cands: Vec<usize> = cands.iter().copied().filter(|c| family(&nodes[*c].lang) == fam).collect();
            if cands.is_empty() {
                continue;
            }
            let common = COMMON.contains(&name.as_str());
            let local: Vec<usize> = cands.iter().copied().filter(|c| nodes[*c].path == pf.path).collect();
            let targets: Vec<usize> = if !local.is_empty() {
                local
            } else if common {
                continue;
            } else {
                let via_import: Vec<usize> = cands
                    .iter()
                    .copied()
                    .filter(|c| imported.map(|s| s.contains(&(nodes[*c].parent_file(&nodes)))).unwrap_or(false))
                    .collect();
                if !via_import.is_empty() {
                    via_import
                } else if cands.len() <= 3 {
                    cands.clone()
                } else {
                    continue; // too ambiguous to guess
                }
            };
            let w = 1.0 / targets.len() as f64;
            for t in targets {
                if t != caller && call_set.insert((caller, t)) {
                    edges.push(Edge { src: caller as i64, dst: t as i64, kind: "CALLS".into(), weight: w });
                }
            }
        }
    }

    // Communities.
    if let Some(p) = progress {
        p.phase(4, 0);
    }
    let communities = crate::graph::detect_communities(&mut nodes, &edges);
    Built { nodes, edges, communities, hashes, files: files.len(), parsed: parsed.len() }
}

pub fn run(repo: &Repo, quiet: bool) -> Result<IndexStats> {
    let t0 = Instant::now();
    PROGRESS.active.store(true, Relaxed);
    PROGRESS
        .started_ms
        .store(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0), Relaxed);
    PROGRESS.phase(1, 0);
    let _done = ProgressGuard;
    let root = repo.root.clone();
    let files = walk(&root);
    if !quiet {
        if let Some(h) = missing_hint(&files) {
            eprintln!("\n{h}");
        }
    }
    let read = |p: &str| std::fs::read_to_string(root.join(p)).ok();
    let Built { nodes, edges, communities, files: nfiles, parsed, .. } = build_with(&files, &read, Some(&PROGRESS));

    PROGRESS.phase(5, 0);
    let store = Store::create(repo)?;
    store.write_all(&nodes, &edges, &communities)?;
    store.set_meta("indexed_head", &repo.head().unwrap_or_default())?;
    store.set_meta(
        "indexed_at",
        &std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0).to_string(),
    )?;

    let stats = IndexStats {
        files: nfiles,
        parsed,
        symbols: nodes.iter().filter(|n| n.kind != "file" && n.kind != "package").count(),
        edges: edges.len(),
        communities: communities.len(),
        millis: t0.elapsed().as_millis(),
    };
    store.set_meta("stats", &serde_json::to_string(&stats)?)?;
    store.publish()?;
    if !quiet {
        eprintln!();
    }
    Ok(stats)
}

/// Files per language whose pack isn't installed.
pub fn missing(files: &[(String, Option<&'static str>)]) -> Vec<(&'static str, usize)> {
    let mut m: HashMap<&'static str, usize> = HashMap::new();
    for (p, l) in files {
        if l.is_none() {
            if let Some(id) = langs::detect(p) {
                *m.entry(id).or_default() += 1;
            }
        }
    }
    let mut v: Vec<_> = m.into_iter().collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    v
}

/// One line naming the languages this index skipped and how to add them.
fn missing_hint(files: &[(String, Option<&'static str>)]) -> Option<String> {
    let m = missing(files);
    if m.is_empty() {
        return None;
    }
    let named: Vec<String> =
        m.iter().take(4).map(|(id, n)| format!("{n} {}", packs::get(id).map(|p| p.name.as_str()).unwrap_or(id))).collect();
    let more = if m.len() > 4 { format!(" and {} more", m.len() - 4) } else { String::new() };
    Some(format!("kula: skipped {}{more} file(s) with no language pack – `kula lang add --detected` to index them", named.join(", ")))
}

/// Every language in a working tree: (id, files, parsed now).
pub fn languages(root: &Path) -> Vec<(&'static str, usize, bool)> {
    let mut m: HashMap<&'static str, (usize, bool)> = HashMap::new();
    for (p, l) in walk(root) {
        if let Some(id) = l.or_else(|| langs::detect(&p)) {
            let e = m.entry(id).or_insert((0, l.is_some()));
            e.0 += 1;
        }
    }
    let mut v: Vec<_> = m.into_iter().map(|(k, (n, ok))| (k, n, ok)).collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    v
}

/// What a language's queries find in one source: (definitions, calls, imports).
pub fn probe(lang: &langs::Lang, src: &str) -> (usize, usize, usize) {
    let mut parser = Parser::new();
    if parser.set_language(&lang.language).is_err() {
        return (0, 0, 0);
    }
    match parse_source("probe", src, lang, &mut parser) {
        Some(pf) => (pf.defs.len(), pf.calls.len(), pf.imports.len()),
        None => (0, 0, 0),
    }
}

/// Every capture a language's queries make in one source, for `kula lang check`.
pub fn probe_detail(lang: &langs::Lang, src: &str) -> Vec<String> {
    let mut parser = Parser::new();
    if parser.set_language(&lang.language).is_err() {
        return vec![];
    }
    let Some(pf) = parse_source("probe", src, lang, &mut parser) else { return vec![] };
    let mut out: Vec<String> = pf
        .defs
        .iter()
        .map(|d| {
            format!("def {} {}{} :{}", d.kind, d.parent_name.as_deref().map(|p| format!("{p}.")).unwrap_or_default(), d.name, d.start_line)
        })
        .collect();
    out.extend(pf.calls.iter().map(|(c, _)| format!("call {c}")));
    out.extend(pf.imports.iter().map(|i| format!("import {i}")));
    out
}

const SKIP_DIRS: &[&str] = &[".git", ".kula", "node_modules", "target", "dist", "build", "vendor", "__pycache__", ".venv", "venv"];

/// The working tree's graph, built in memory (not stored).
pub fn worktree(repo: &Repo) -> Built {
    let files = walk(&repo.root);
    let root = repo.root.clone();
    let read = |p: &str| std::fs::read_to_string(root.join(p)).ok();
    build(&files, &read)
}

/// `WORKTREE` (uncommitted state) or any revision.
pub fn snapshot_any(repo: &Repo, rev: &str) -> Result<Built> {
    if rev.eq_ignore_ascii_case("worktree") { Ok(worktree(repo)) } else { snapshot(repo, rev) }
}

/// Build the graph of any revision straight from git objects – no checkout.
pub fn snapshot(repo: &Repo, rev: &str) -> Result<Built> {
    crate::git::validate_rev(rev)?;
    let listing = repo.run(&["ls-tree", "-r", "-l", "-z", "--full-tree", rev])?;
    let mut files: Vec<(String, Option<&'static str>)> = Vec::new();
    for entry in listing.split('\0').filter(|e| !e.is_empty()) {
        // "<mode> blob <sha> <size>\t<path>"
        let Some((meta, path)) = entry.split_once('\t') else { continue };
        let mut it = meta.split_whitespace();
        let (_mode, kind, _sha, size) = (it.next(), it.next(), it.next(), it.next());
        if kind != Some("blob") || size.and_then(|s| s.trim().parse::<u64>().ok()).unwrap_or(u64::MAX) > MAX_FILE_BYTES {
            continue;
        }
        if path.split('/').any(|seg| SKIP_DIRS.contains(&seg)) {
            continue;
        }
        files.push((path.to_string(), langs::for_path(path)));
    }
    files.sort();
    let wanted: Vec<&str> = files.iter().filter(|(_, l)| l.is_some()).map(|(p, _)| p.as_str()).collect();
    let blobs = repo.cat_files(rev, &wanted)?;
    let read = |p: &str| blobs.get(p).cloned();
    Ok(build(&files, &read))
}

impl Node {
    /// The file node id that ultimately contains this node.
    fn parent_file(&self, nodes: &[Node]) -> usize {
        let mut cur = self;
        let mut guard = 0;
        while cur.kind != "file" && guard < 8 {
            match cur.parent {
                Some(p) => cur = &nodes[p as usize],
                None => break,
            }
            guard += 1;
        }
        cur.id as usize
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (fixture, defs as "kind name", calls, imports) – each language's fixture
    /// under tests/fixtures/langs must yield at least these.
    type Case = (&'static str, &'static [&'static str], &'static [&'static str], &'static [&'static str]);
    const CASES: &[Case] = &[
        ("kotlin.kt", &["class Greeter", "method greet", "interface Shape", "function helper"], &["helper", "max"], &["kotlin.math.max"]),
        (
            "swift.swift",
            &["class Greeter", "method greet", "interface Shape", "function helper"],
            &["helper", "uppercased"],
            &["Foundation"],
        ),
        (
            "scala.scala",
            &["class Greeter", "method greet", "interface Shape", "function helper"],
            &["helper", "println"],
            &["scala.collection.mutable"],
        ),
        ("groovy.groovy", &["class Greeter", "method greet", "function helper"], &["helper"], &["groovy.json.JsonSlurper"]),
        (
            "dart.dart",
            &["class Greeter", "method greet", "function helper"],
            &["helper", "toUpperCase"],
            &["'package:flutter/material.dart'"],
        ),
        ("lua.lua", &["function greet", "function helper", "function private"], &["helper", "upper"], &["json"]),
        ("bash.sh", &["function greet", "function helper"], &["helper", "greet"], &["./lib.sh"]),
        ("zig.zig", &["class Point", "method norm", "function helper", "function main"], &["helper", "print"], &["std"]),
        ("elixir.ex", &["class Greeter", "function greet", "function helper"], &["helper", "upcase"], &["Demo.Util", "Enum"]),
        ("erlang.erl", &["function greet", "function helper"], &["helper", "uppercase"], &["lists", "\"defs.hrl\""]),
        ("gleam.gleam", &["class Shape", "function greet", "function helper"], &["helper", "uppercase"], &["gleam/io", "gleam/string"]),
        ("haskell.hs", &["class Shape", "interface Named", "function greet", "function helper"], &["helper", "sort"], &["Data.List"]),
        ("ocaml.ml", &["class Util", "class shape", "function greet", "function helper"], &["helper", "printf"], &["Printf"]),
        (
            "fsharp.fs",
            &["class Point", "class Greeter", "method Greet", "function helper", "function greet"],
            &["helper", "ToUpper"],
            &["System"],
        ),
        ("elm.elm", &["class Shape", "class Point", "function greet", "function helper"], &["helper", "toUpper"], &["Html"]),
        ("julia.jl", &["class Point", "function greet", "function helper"], &["helper", "uppercase"], &["LinearAlgebra", "Base: show"]),
        ("r.R", &["function greet", "function helper"], &["helper", "toupper"], &["dplyr", "\"utils.R\""]),
        (
            "objc.m",
            &["class Greeter", "method greet", "method helper", "function upper"],
            &["helper", "upper", "uppercaseString"],
            &["<Foundation/Foundation.h>", "\"Util.h\""],
        ),
        ("matlab.m", &["function greet", "function helper"], &["helper", "upper"], &[]),
        ("solidity.sol", &["class Greeter", "method greet", "method helper", "interface IShape"], &["helper"], &["\"./Util.sol\""]),
        ("sql.sql", &["class users", "class active", "function greet"], &["greet", "upper", "users"], &[]),
        ("hcl.tf", &["class vpc", "class web", "class amis"], &["lookup"], &["./modules/vpc"]),
        ("graphql.graphql", &["class User", "interface Node", "function GetUser", "function UserFields"], &["UserFields"], &[]),
        (
            "proto.proto",
            &["class User", "interface Greeter", "method Greet", "class Kind"],
            &["User"],
            &["\"google/protobuf/timestamp.proto\""],
        ),
        ("fortran.f90", &["class util", "class main", "function helper", "function greet"], &["helper", "greet"], &["util"]),
        (
            "powershell.ps1",
            &["function Get-Greeting", "function Invoke-Helper", "class Greeter", "method Greet"],
            &["Write-Output"],
            &["./Util.psm1", "./lib.ps1"],
        ),
        ("make.mk", &["function build", "function deps", "function helper"], &["deps"], &["common.mk"]),
        ("cmake.cmake", &["function greet", "function helper"], &["helper", "greet", "message"], &["CTest", "src"]),
        ("nix.nix", &["function helper", "function greet"], &["helper", "toUpper"], &["./util.nix", "<nixpkgs>"]),
        ("systemverilog.sv", &["class counter", "class top", "function helper"], &["helper", "counter"], &["\"defs.svh\""]),
        ("vhdl.vhd", &["class counter", "class rtl", "method helper"], &["counter"], &["ieee.std_logic_1164.all"]),
        (
            "d.d",
            &["class Greeter", "method greet", "class Point", "function helper", "function main"],
            &["helper", "writeln"],
            &["std.stdio"],
        ),
        ("pascal.pas", &["function Helper", "function Greet"], &["Helper", "UpperCase", "WriteLn"], &["SysUtils"]),
        ("ada.adb", &["class Greeter", "method Helper", "method Greet"], &["Helper", "Put_Line"], &["Ada.Text_IO"]),
        ("commonlisp.lisp", &["function helper", "function greet", "class greeter"], &["helper", "string-upcase"], &[":asdf"]),
        ("elisp.el", &["function helper", "function greet", "function with-x"], &["helper", "upcase"], &["cl-lib"]),
        ("racket.rkt", &["function helper", "function greet"], &["helper", "string-upcase"], &["racket/string"]),
        ("scheme.scm", &["function helper", "function greet"], &["helper", "string-upcase"], &["(scheme base)"]),
        ("glsl.glsl", &["class Light", "function helper", "function main"], &["helper", "clamp"], &["\"common.glsl\""]),
        ("cuda.cu", &["function kernel", "function helper", "class Grid", "function main"], &["helper", "kernel"], &["<cuda.h>"]),
        ("odin.odin", &["class Point", "function helper", "function main"], &["helper", "println"], &["\"core:fmt\""]),
        ("starlark.bzl", &["function helper", "function greet"], &["helper", "my_rule"], &["\"//tools:defs.bzl\""]),
        ("puppet.pp", &["class web::server", "class web::helper", "function web::greet"], &["web::helper", "upcase"], &["apache"]),
        ("bicep.bicep", &["function greet", "class stg", "class sa"], &["toUpper", "toLower"], &["'./storage.bicep'"]),
        ("astro.astro", &["function helper"], &["helper", "getItems"], &["\"../components/Card.astro\""]),
        ("perl.pl", &["class Greeter", "function helper", "function greet"], &["helper", "name"], &["List::Util", "Data::Dumper"]),
        (
            "clojure.clj",
            &["function helper", "function greet", "class Point", "interface Shape"],
            &["helper", "upper-case"],
            &["clojure.string"],
        ),
        ("vue.vue", &["function onClick", "function helper"], &["helper"], &["'./Child.vue'"]),
        ("svelte.svelte", &["function greet", "function helper"], &["helper", "onMount"], &["'svelte'"]),
    ];

    /// None when the fixture's language pack isn't installed.
    fn parse_fixture(name: &str) -> Option<ParsedFile> {
        let path = format!("{}/tests/fixtures/langs/{name}", env!("CARGO_MANIFEST_DIR"));
        let src = std::fs::read_to_string(&path).unwrap();
        // Fixtures are named `<language id>.<ext>`.
        let want = name.split('.').next().unwrap_or(name);
        langs::get(want)?;
        let id = langs::refine(langs::for_path(name)?, &src);
        assert_eq!(id, want, "{name} detected as {id}");
        let lang = langs::get(id).unwrap();
        let mut parser = Parser::new();
        parser.set_language(&lang.language).unwrap();
        Some(parse_source(name, &langs::prepare(lang.id, &src), lang, &mut parser).unwrap())
    }

    #[test]
    fn every_language_fixture() {
        let mut fails = vec![];
        for (file, defs, calls, imports) in CASES {
            let Some(pf) = parse_fixture(file) else { continue };
            let got_defs: Vec<String> = pf.defs.iter().map(|d| format!("{} {}", d.kind, d.name)).collect();
            let got_calls: HashSet<&str> = pf.calls.iter().map(|(c, _)| c.as_str()).collect();
            for d in *defs {
                if !got_defs.iter().any(|g| g == d) {
                    fails.push(format!("{file}: missing def `{d}` (got {got_defs:?})"));
                }
            }
            for c in *calls {
                if !got_calls.contains(c) {
                    fails.push(format!("{file}: missing call `{c}` (got {got_calls:?})"));
                }
            }
            for i in *imports {
                if !pf.imports.iter().any(|g| g == i) {
                    fails.push(format!("{file}: missing import `{i}` (got {:?})", pf.imports));
                }
            }
        }
        assert!(fails.is_empty(), "{}", fails.join("\n"));
    }

    /// Smoke test for every other fixture: when its language is available, it is
    /// detected as the language its file is named for and yields definitions.
    #[test]
    fn every_fixture_smokes() {
        let dir = format!("{}/tests/fixtures/langs", env!("CARGO_MANIFEST_DIR"));
        let mut fails = vec![];
        let mut ran = 0;
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            let Some(pf) = parse_fixture(&n) else { continue };
            ran += 1;
            if pf.defs.is_empty() {
                fails.push(format!("{n}: no definitions"));
            }
        }
        eprintln!("smoke-tested {ran} fixtures (packs not installed are skipped)");
        assert!(fails.is_empty(), "{}", fails.join("\n"));
    }

    /// Every pack has a query file, and none of its extensions is claimed by a
    /// built-in language.
    #[test]
    fn packs_are_wired() {
        for p in packs::all() {
            assert!(p.query().is_some(), "{} has no queries/{}.scm", p.id, p.id);
            assert!(!p.exts.is_empty() || !p.names.is_empty(), "{} has no file names", p.id);
            assert!(!p.tier.is_empty(), "{} has no measured tier", p.id);
            for e in &p.exts {
                if !e.contains('.') {
                    assert_ne!(langs::detect(&format!("x.{e}")).map(langs::is_core), Some(true), "{}: .{e} is a built-in extension", p.id);
                }
            }
        }
    }

    #[test]
    fn generic_imports_resolve() {
        let mut by_stem: HashMap<String, Vec<usize>> = HashMap::new();
        by_stem.insert("src/Data/Util".into(), vec![1]);
        by_stem.insert("lib/helpers".into(), vec![2]);
        let by_dir = HashMap::new();
        assert_eq!(resolve_import("Data.Util", "app/Main.hs", "haskell", &by_stem, &by_dir), vec![1]);
        assert_eq!(resolve_import("./helpers.sh", "lib/x.sh", "bash", &by_stem, &by_dir), vec![2]);
        assert!(resolve_import("kotlin.math.max", "a.kt", "kotlin", &by_stem, &by_dir).is_empty());
    }
}
