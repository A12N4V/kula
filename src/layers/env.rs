//! Env vars: reads in source code → `env` nodes and `reads_env` edges.
//!
//! Detected reads: `process.env.X` / `process.env["X"]` (JS/TS), `os.environ["X"]`
//! / `os.environ.get("X")` / `os.getenv("X")` (Python), `std::env::var("X")`
//! (Rust), `os.Getenv("X")` (Go), plus every key in `.env.example`.
//! A `READS_ENV` edge runs reader → env node; its weight is the line of the read,
//! so `kula query env:NAME` can list (file, symbol, line) straight from the graph.

use crate::index::Reader;
use crate::store::{Edge, Node, Store};
use anyhow::Result;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

/// One env read found in a source: the key and its start byte.
#[derive(Debug, Clone, PartialEq)]
pub struct EnvRead {
    pub key: String,
    pub byte: usize,
}

fn valid_key(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Read `needle`, then a quoted string (or, for dotted access, an identifier).
fn push_after(out: &mut Vec<EnvRead>, src: &str, needle: &str, dotted: bool, guard: Option<char>) {
    let mut from = 0;
    while let Some(i) = src[from..].find(needle) {
        let start = from + i;
        from = start + needle.len();
        if let Some(g) = guard {
            let before = src[..start].chars().next_back();
            if before == Some(g) || before.is_some_and(|c| c.is_alphanumeric() || c == '_') {
                continue;
            }
        }
        let rest = src[from..].trim_start();
        let key = if dotted {
            rest.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').collect::<String>()
        } else {
            let Some(q) = rest.chars().next().filter(|c| *c == '"' || *c == '\'') else { continue };
            rest.chars().skip(1).take_while(|c| *c != q).collect::<String>()
        };
        if valid_key(&key) {
            out.push(EnvRead { key, byte: from });
        }
    }
}

/// Every env read in one source. Pure: takes language id + text.
pub fn scan(lang: &str, src: &str) -> Vec<EnvRead> {
    let mut out = Vec::new();
    match lang {
        "javascript" | "typescript" | "tsx" => {
            push_after(&mut out, src, "process.env.", true, None);
            push_after(&mut out, src, "process.env[", false, None);
        }
        "python" => {
            push_after(&mut out, src, "os.environ[", false, None);
            push_after(&mut out, src, "os.environ.get(", false, None);
            push_after(&mut out, src, "os.getenv(", false, None);
        }
        "rust" => {
            push_after(&mut out, src, "std::env::var(", false, None);
            push_after(&mut out, src, "env::var(", false, Some(':'));
        }
        "go" => {
            push_after(&mut out, src, "os.Getenv(", false, None);
        }
        _ => {}
    }
    out.sort_by_key(|r| r.byte);
    out.dedup();
    out
}

/// Keys declared in a `.env.example` body, with their 1-based line.
pub fn scan_env_example(src: &str) -> Vec<(String, usize)> {
    src.lines()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty() && !l.trim().starts_with('#'))
        .filter_map(|(i, l)| {
            let k = l.split('=').next()?.trim().to_string();
            valid_key(&k).then_some((k, i + 1))
        })
        .collect()
}

fn env_node(key: &str, nodes: &mut Vec<Node>, hashes: &mut Vec<u64>, env_ids: &mut HashMap<String, usize>) -> usize {
    if let Some(id) = env_ids.get(key) {
        return *id;
    }
    let id = nodes.len();
    nodes.push(Node {
        id: id as i64,
        kind: "env".into(),
        name: key.to_string(),
        path: format!("env:{key}"),
        lang: String::new(),
        start_line: 0,
        end_line: 0,
        parent: None,
        community: 0,
    });
    hashes.push(0);
    env_ids.insert(key.to_string(), id);
    id
}

/// Insert env nodes and reads_env edges into a graph under construction.
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
    let mut env_ids: HashMap<String, usize> = HashMap::new();
    let mut linked: HashSet<(usize, usize, i64)> = HashSet::new();
    let link = |reader: usize,
                key: &str,
                line: i64,
                edges: &mut Vec<Edge>,
                nodes: &mut Vec<Node>,
                hashes: &mut Vec<u64>,
                env_ids: &mut HashMap<String, usize>,
                linked: &mut HashSet<(usize, usize, i64)>| {
        let env = env_node(key, nodes, hashes, env_ids);
        if linked.insert((reader, env, line)) {
            edges.push(Edge::new(reader as i64, env as i64, "READS_ENV", line as f64));
        }
    };
    for (pi, pf) in parsed.iter().enumerate() {
        let Some(src) = read(&pf.path) else { continue };
        let Some(fid) = file_id.get(&pf.path).copied() else { continue };
        for r in scan(pf.lang, &src) {
            let line = 1 + src[..r.byte].matches('\n').count() as i64;
            // Innermost enclosing symbol reads it; a top-level read belongs to the file.
            let reader = pf
                .defs
                .iter()
                .enumerate()
                .filter(|(_, d)| d.start_byte <= r.byte && r.byte < d.end_byte)
                .min_by_key(|(_, d)| d.end_byte - d.start_byte)
                .map(|(i, _)| sym_ids[pi][i])
                .unwrap_or(fid);
            link(reader, &r.key, line, edges, nodes, hashes, &mut env_ids, &mut linked);
        }
    }
    // `.env.example` declares the keys the code may read; the file reads them all.
    for (p, _) in files {
        if !p.ends_with(".env.example") {
            continue;
        }
        let Some(src) = read(p) else { continue };
        let Some(fid) = file_id.get(p).copied() else { continue };
        for (key, line) in scan_env_example(&src) {
            link(fid, &key, line as i64, edges, nodes, hashes, &mut env_ids, &mut linked);
        }
    }
}

#[derive(Serialize)]
pub struct EnvReader {
    /// Path of the file that reads the variable.
    pub file: String,
    /// The reading symbol, or None for a whole-file read (`.env.example`).
    pub symbol: Option<String>,
    /// 1-based line of the read.
    pub line: i64,
}

/// Who reads one env var: `kula query env:NAME`.
pub fn readers(store: &Store, name: &str) -> Result<Vec<EnvReader>> {
    let env = match store.nodes_where("kind = 'env' AND name = ?1", [name])?.into_iter().next() {
        Some(n) => n,
        None => return Ok(vec![]),
    };
    Ok(store
        .neighbours(env.id, "READS_ENV", false)?
        .into_iter()
        .map(|(n, line)| EnvReader { file: n.path.clone(), symbol: (n.kind != "file").then(|| n.name.clone()), line: line as i64 })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_the_four_languages() {
        let js = scan("typescript", "const a = process.env.PORT;\nconst b = process.env['HOME'];\nconst c = env.X;");
        assert_eq!(js.iter().map(|r| r.key.clone()).collect::<Vec<_>>(), ["PORT", "HOME"]);
        let py = scan("python", "os.environ[\"K1\"]\nos.environ.get('K2')\nos.getenv('K3')");
        assert_eq!(py.iter().map(|r| r.key.clone()).collect::<Vec<_>>(), ["K1", "K2", "K3"]);
        let rs = scan("rust", "std::env::var(\"A\");\nenv::var(\"B\");\n");
        assert_eq!(rs.iter().map(|r| r.key.clone()).collect::<Vec<_>>(), ["A", "B"]);
        let go = scan("go", "os.Getenv(\"C\")");
        assert_eq!(go[0].key, "C");
        assert!(scan("ruby", "ENV['X']").is_empty());
    }

    #[test]
    fn example_keys() {
        assert_eq!(scan_env_example("# c\nA=1\nBAD KEY=2\n"), [("A".into(), 2)]);
    }
}
