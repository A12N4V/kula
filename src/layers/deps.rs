//! Dependencies: manifests → `dependency` nodes, imports → `used_by` edges.
//!
//! A `dependency` node holds one declared external package (path `dep:<eco>:<name>`).
//! Every import whose package resolves to a declared dependency adds a `used_by`
//! edge from the dependency to the importing file, so a declared dependency with
//! no `used_by` edge is unused. `Cargo.lock` names are parsed as extra aliases for
//! matching; only manifest-declared packages become nodes, so lock-only entries
//! never show up as unused.

use crate::index::{package_name, Reader};
use crate::project::{builtin, ecosystem, norm};
use crate::store::{Edge, Node, Store};
use anyhow::Result;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

/// One name parsed out of a manifest. `from_lock` marks `Cargo.lock` entries.
#[derive(Debug, Clone, PartialEq)]
pub struct ManifestDep {
    pub name: String,
    pub eco: &'static str,
    pub from_lock: bool,
}

fn manifest_file(name: &str) -> bool {
    matches!(name, "package.json" | "Cargo.toml" | "Cargo.lock" | "pyproject.toml" | "go.mod")
        || (name.starts_with("requirements") && name.ends_with(".txt"))
}

/// Parse one manifest body into dependency names. Pure: takes path + content.
pub fn parse_manifest(file: &str, body: &str, out: &mut Vec<ManifestDep>) {
    let mut add = |name: &str, eco: &'static str, from_lock: bool| {
        let n: String = name.trim().trim_matches('"').chars().take_while(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '.').collect();
        if !n.is_empty() && n != "python" {
            out.push(ManifestDep { name: n, eco, from_lock });
        }
    };
    match file {
        "package.json" => {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(body) else { return };
            for k in ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] {
                if let Some(m) = v.get(k).and_then(|m| m.as_object()) {
                    for name in m.keys() {
                        add(name, "npm", false);
                    }
                }
            }
        }
        "Cargo.toml" => {
            let Ok(v) = body.parse::<toml::Table>() else { return };
            for k in ["dependencies", "dev-dependencies", "build-dependencies"] {
                if let Some(t) = v.get(k).and_then(|t| t.as_table()) {
                    for name in t.keys() {
                        add(name, "cargo", false);
                    }
                }
            }
        }
        "Cargo.lock" => {
            for line in body.lines() {
                let l = line.trim();
                if let Some(n) = l.strip_prefix("name = \"").and_then(|s| s.strip_suffix('"')) {
                    add(n, "cargo", true);
                }
            }
        }
        "pyproject.toml" => {
            let Ok(v) = body.parse::<toml::Table>() else { return };
            if let Some(a) = v.get("project").and_then(|p| p.get("dependencies")).and_then(|d| d.as_array()) {
                for x in a.iter().filter_map(|x| x.as_str()) {
                    add(x, "pypi", false);
                }
            }
            if let Some(t) = v.get("tool").and_then(|t| t.get("poetry")).and_then(|p| p.get("dependencies")).and_then(|d| d.as_table()) {
                for name in t.keys() {
                    add(name, "pypi", false);
                }
            }
        }
        f if f.starts_with("requirements") && f.ends_with(".txt") => {
            for l in body.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with('-')) {
                add(l, "pypi", false);
            }
        }
        "go.mod" => {
            let mut in_block = false;
            for l in body.lines().map(str::trim) {
                if l.starts_with("require (") {
                    in_block = true;
                    continue;
                }
                if in_block && l == ")" {
                    in_block = false;
                    continue;
                }
                let spec = if in_block { Some(l) } else { l.strip_prefix("require ") };
                if let Some(m) = spec.and_then(|s| s.split_whitespace().next()) {
                    let short: Vec<&str> = m.split('/').take(3).collect();
                    out.push(ManifestDep { name: short.join("/"), eco: "go", from_lock: false });
                }
            }
        }
        _ => {}
    }
}

/// Insert dependency nodes and used_by edges into a graph under construction.
pub(crate) fn apply(
    parsed: &[crate::index::ParsedFile],
    files: &[(String, Option<&'static str>)],
    read: Reader,
    nodes: &mut Vec<Node>,
    edges: &mut Vec<Edge>,
    file_id: &HashMap<String, usize>,
    hashes: &mut Vec<u64>,
) {
    // Manifests anywhere in the tree.
    let mut manifest: Vec<ManifestDep> = Vec::new();
    for (p, _) in files {
        let base = p.rsplit('/').next().unwrap_or(p);
        if manifest_file(base) {
            if let Some(body) = read(p) {
                parse_manifest(base, &body, &mut manifest);
            }
        }
    }
    // Declared names and lock aliases, normalised the way imports spell them.
    let mut dep_id: HashMap<(&'static str, String), usize> = HashMap::new();
    let push_node = |name: &str, eco: &'static str, nodes: &mut Vec<Node>, hashes: &mut Vec<u64>| -> usize {
        let id = nodes.len();
        nodes.push(Node {
            id: id as i64,
            kind: "dependency".into(),
            name: name.to_string(),
            path: format!("dep:{eco}:{name}"),
            lang: eco.into(),
            start_line: 0,
            end_line: 0,
            parent: None,
            community: 0,
        });
        hashes.push(0);
        id
    };
    for d in &manifest {
        let key = (d.eco, norm(d.eco, &d.name));
        if !d.from_lock && !dep_id.contains_key(&key) {
            let id = push_node(&d.name, d.eco, nodes, hashes);
            dep_id.insert(key, id);
        }
    }
    // Lock names are matching aliases only: link to an existing declared node,
    // never create one, so lock-only packages can't be flagged unused.
    for d in manifest.iter().filter(|d| d.from_lock) {
        let key = (d.eco, norm(d.eco, &d.name));
        dep_id.entry(key).or_insert(usize::MAX); // alias only
    }
    // used_by edges: dependency → every file that imports it.
    let mut linked: HashSet<(usize, usize)> = HashSet::new();
    for pf in parsed {
        let eco = ecosystem(pf.lang);
        if eco == "other" {
            continue;
        }
        let Some(fid) = file_id.get(&pf.path).copied() else { continue };
        for imp in &pf.imports {
            let Some(name) = package_name(imp, pf.lang) else { continue };
            if let Some(id) = dep_id.get(&(eco, norm(eco, &name))).copied() {
                if id != usize::MAX && linked.insert((id, fid)) {
                    edges.push(Edge::new(id as i64, fid as i64, "USED_BY", 1.0));
                }
            }
        }
    }
}

#[derive(Serialize, Clone)]
pub struct Dep {
    pub name: String,
    pub ecosystem: &'static str,
    /// Files importing it (0 when declared but never imported).
    pub importers: usize,
    pub declared: bool,
    /// Standard library / runtime built-in: never needs declaring.
    pub builtin: bool,
}

fn eco_str(s: &str) -> &'static str {
    match s {
        "npm" => "npm",
        "pypi" => "pypi",
        "cargo" => "cargo",
        "go" => "go",
        _ => "other",
    }
}

/// Every external package: declared (dependency nodes) and/or imported
/// (package nodes that no dependency covers), for `kula deps`.
pub fn report(store: &Store) -> Result<Vec<Dep>> {
    let mut out: Vec<Dep> = Vec::new();
    let mut declared: HashSet<(String, String)> = HashSet::new();
    for n in store.nodes_where("kind = 'dependency' ORDER BY id", [])? {
        let eco = eco_str(&n.lang);
        let importers: i64 = store.conn.query_row(
            "SELECT COUNT(*) FROM edges WHERE src = ?1 AND kind = 'USED_BY'",
            [n.id],
            |r| r.get(0),
        )?;
        declared.insert((eco.to_string(), norm(eco, &n.name)));
        out.push(Dep { name: n.name, ecosystem: eco, importers: importers as usize, declared: true, builtin: false });
    }
    // Imports that no declared dependency covers.
    let mut seen: HashSet<(String, String)> = HashSet::new();
    for p in store.nodes_where("kind = 'package' ORDER BY id", [])? {
        let eco = ecosystem(&p.lang);
        if eco == "other" || !seen.insert((eco.to_string(), p.name.clone())) {
            continue;
        }
        if declared.contains(&(eco.to_string(), norm(eco, &p.name))) {
            continue;
        }
        let importers: i64 = store.conn.query_row(
            "SELECT COUNT(DISTINCT e.src) FROM edges e WHERE e.dst = ?1 AND e.kind = 'IMPORTS'",
            [p.id],
            |r| r.get(0),
        )?;
        out.push(Dep {
            name: p.name.clone(),
            ecosystem: eco,
            importers: importers as usize,
            declared: false,
            builtin: builtin(eco, &p.name),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name).then(a.ecosystem.cmp(b.ecosystem)));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(file: &str, body: &str) -> Vec<String> {
        let mut out = vec![];
        parse_manifest(file, body, &mut out);
        out.into_iter().map(|d| d.name).collect()
    }

    #[test]
    fn parses_every_manifest() {
        assert_eq!(parse("package.json", "{\"dependencies\":{\"react\":\"19\"},\"devDependencies\":{\"vite\":\"5\"}}"), ["react", "vite"]);
        assert_eq!(parse("Cargo.toml", "[dependencies]\nserde = \"1\"\nlog-x = { version = \"1\" }"), ["log-x", "serde"]);
        assert_eq!(parse("Cargo.lock", "[[package]]\nname = \"anyhow\"\nversion = \"1\"\n"), ["anyhow"]);
        assert_eq!(parse("pyproject.toml", "[project]\ndependencies = [\"requests>=2\", \"rich\"]"), ["requests", "rich"]);
        assert_eq!(parse("requirements.txt", "flask==3.0\n# comment\n"), ["flask"]);
        assert_eq!(parse("go.mod", "module x\n\nrequire (\n\tgithub.com/gin-gonic/gin v1\n)\n"), ["github.com/gin-gonic/gin"]);
    }

    #[test]
    fn lock_names_are_aliases_not_nodes() {
        let mut out = vec![];
        parse_manifest("Cargo.lock", "name = \"left-pad\"\n", &mut out);
        assert!(out[0].from_lock);
    }
}
