//! The indexer: files → tree-sitter → symbols, calls, imports → knowledge graph.

pub mod langs;

use crate::git::Repo;
use crate::store::{Edge, Node, Store};
use anyhow::Result;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Instant;
use streaming_iterator::StreamingIterator;
use tree_sitter::{Parser, QueryCursor};

const MAX_FILE_BYTES: u64 = 1_000_000;

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
    let walker = ignore::WalkBuilder::new(root)
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
        if entry.metadata().map(|m| m.len() > MAX_FILE_BYTES).unwrap_or(true) {
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
            for cap in m.captures() {
                let cname = names[cap.index as usize];
                if cname.starts_with('_') {
                    continue;
                }
                let node = cap.node;
                let text = node.utf8_text(bytes).unwrap_or("").to_string();
                if let Some(kind) = cname.strip_prefix("def.") {
                    // Definition range: nearest ancestor that is a def kind.
                    let mut def_node = node.parent().unwrap_or(node);
                    let mut cur = Some(node);
                    while let Some(n) = cur {
                        if lang.def_kinds.contains(&n.kind()) {
                            def_node = n;
                            break;
                        }
                        cur = n.parent();
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
                    if text.is_empty() {
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
                    if !text.is_empty() {
                        pf.calls.push((text, node.start_byte()));
                    }
                } else if cname == "import" {
                    pf.imports.push(text);
                }
            }
        }
    }
    pf.defs.sort_by_key(|d| (d.start_byte, std::cmp::Reverse(d.end_byte)));
    Some(pf)
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
        _ => vec![],
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
    let source: Vec<(String, &'static str)> = files.iter().filter_map(|(p, l)| l.map(|l| (p.clone(), l))).collect();

    // Parse in parallel.
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(16);
    let chunk = source.len().div_ceil(threads).max(1);
    let parsed: Vec<ParsedFile> = std::thread::scope(|s| {
        let handles: Vec<_> = source
            .chunks(chunk)
            .map(|batch| {
                s.spawn(move || {
                    let read = read;
                    let mut cache: HashMap<&str, langs::Lang> = HashMap::new();
                    let mut parser = Parser::new();
                    let mut out = Vec::new();
                    for (path, lid) in batch {
                        if !cache.contains_key(lid) {
                            if let Some(l) = langs::load(lid) {
                                cache.insert(lid, l);
                            }
                        }
                        let Some(lang) = cache.get(lid) else { continue };
                        if parser.set_language(&lang.language).is_err() {
                            continue;
                        }
                        let Some(src) = read(path) else { continue };
                        if let Some(pf) = parse_source(path, &src, lang, &mut parser) {
                            out.push(pf);
                        }
                    }
                    out
                })
            })
            .collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    });

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

    // Imports.
    let mut imports_of: HashMap<usize, HashSet<usize>> = HashMap::new();
    for pf in &parsed {
        let fid = file_id[&pf.path];
        for imp in &pf.imports {
            for target in resolve_import(imp, &pf.path, pf.lang, &by_stem, &by_dir) {
                if target != fid && imports_of.entry(fid).or_default().insert(target) {
                    edges.push(Edge { src: fid as i64, dst: target as i64, kind: "IMPORTS".into(), weight: 1.0 });
                }
            }
        }
    }

    // Calls.
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
    let communities = crate::graph::detect_communities(&mut nodes, &edges);
    Built { nodes, edges, communities, hashes, files: files.len(), parsed: parsed.len() }
}

pub fn run(repo: &Repo, quiet: bool) -> Result<IndexStats> {
    let t0 = Instant::now();
    let root = repo.root.clone();
    let files = walk(&root);
    let read = |p: &str| std::fs::read_to_string(root.join(p)).ok();
    let Built { nodes, edges, communities, files: nfiles, parsed, .. } = build(&files, &read);

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
        symbols: nodes.len() - nfiles,
        edges: edges.len(),
        communities: communities.len(),
        millis: t0.elapsed().as_millis(),
    };
    store.set_meta("stats", &serde_json::to_string(&stats)?)?;
    if !quiet {
        eprintln!();
    }
    Ok(stats)
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
    if rev.eq_ignore_ascii_case("worktree") {
        Ok(worktree(repo))
    } else {
        snapshot(repo, rev)
    }
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
