//! Package → module → symbol tree with loc, fan-in/out and 30-day churn.

use super::file_of;
use crate::store::{Node, Store};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub loc: usize,
    pub symbols: Vec<String>,
    pub fan_in: i64,
    pub fan_out: i64,
    pub churn_30d: i64,
    pub children: Vec<TreeNode>,
}

#[derive(Debug, Serialize)]
pub struct ModuleTree {
    pub name: String,
    pub packages: Vec<TreeNode>,
}

const SKIP: &[&str] = &[".git", ".kula", "target", "node_modules", "dist", "build", "vendor", ".venv", "__pycache__", "coverage"];

struct Pkg {
    name: String,
    rel: String,
}

/// Build the tree: packages from manifests, modules from directories with
/// symbols, symbols from the index. Deterministic: everything sorted.
pub fn module_tree(root: &Path, db: &Store) -> ModuleTree {
    let name = root.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "repo".into());
    let mut pkgs = find_packages(root);
    let nodes = db.nodes_where("id >= 0", []).unwrap_or_default();
    let by_id: HashMap<i64, Node> = nodes.iter().map(|n| (n.id, n.clone())).collect();

    // Symbol → its file.
    let mut sym_file: HashMap<i64, String> = HashMap::new();
    for n in &nodes {
        if n.kind != "file" && n.kind != "package" {
            if let Some(f) = file_of(n.id, &by_id) {
                sym_file.insert(n.id, f);
            }
        }
    }

    // Fans: per symbol id, plus distinct module↔module and package↔package pairs.
    // Code under no manifest still belongs somewhere: the repo root.
    let owned = |pkgs: &[Pkg], f: &str| pkgs.iter().any(|p| owns(&p.rel, &dir_of(f)));
    if !pkgs.iter().any(|p| p.rel == ".") && sym_file.values().any(|f| !owned(&pkgs, f)) {
        pkgs.insert(0, Pkg { name: name.clone(), rel: ".".into() });
    }
    // The deepest package that owns a directory wins.
    let pkg_of = |dir: &str| pkgs.iter().filter(|p| owns(&p.rel, dir)).max_by_key(|p| p.rel.len()).map(|p| p.rel.clone());
    let bucket = |id: i64| -> Option<String> {
        match by_id.get(&id).map(|n| n.kind.as_str()) {
            Some("file") => by_id.get(&id).map(|n| dir_of(&n.path)),
            Some(_) => sym_file.get(&id).map(|f| dir_of(f)),
            None => None,
        }
    };
    let mut sym_in: HashMap<i64, i64> = HashMap::new();
    let mut sym_out: HashMap<i64, i64> = HashMap::new();
    let mut mod_in: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut mod_out: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut pkg_in: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut pkg_out: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for e in db.all_edges().unwrap_or_default() {
        if e.kind == "CONTAINS" {
            continue;
        }
        *sym_out.entry(e.src).or_default() += 1;
        *sym_in.entry(e.dst).or_default() += 1;
        if let (Some(a), Some(b)) = (bucket(e.src), bucket(e.dst)) {
            if a != b {
                mod_out.entry(a.clone()).or_default().insert(b.clone());
                mod_in.entry(b.clone()).or_default().insert(a.clone());
                if let (Some(pa), Some(pb)) = (pkg_of(&a), pkg_of(&b)) {
                    if pa != pb {
                        pkg_out.entry(pa.clone()).or_default().insert(pb.clone());
                        pkg_in.entry(pb).or_default().insert(pa);
                    }
                }
            }
        }
    }

    // Churn: files touched in the last 30 days (zero when not a repo).
    let churn = changed_files(root);

    // Group symbols by directory.
    let mut dir_syms: BTreeMap<String, Vec<Leaf>> = BTreeMap::new();
    for n in &nodes {
        if n.kind == "file" || n.kind == "package" {
            continue;
        }
        let Some(file) = sym_file.get(&n.id) else { continue };
        let loc = (n.end_line - n.start_line + 1).max(0) as usize;
        dir_syms.entry(dir_of(file)).or_default().push(Leaf {
            name: n.name.clone(),
            file: file.clone(),
            loc,
            fan_in: *sym_in.get(&n.id).unwrap_or(&0),
            fan_out: *sym_out.get(&n.id).unwrap_or(&0),
        });
    }
    for v in dir_syms.values_mut() {
        v.sort_by(|a, b| a.name.cmp(&b.name));
    }

    let packages = pkgs
        .iter()
        .map(|p| {
            let mut children = Vec::new();
            let root_syms: Vec<Leaf> = dir_syms.remove(&p.rel).unwrap_or_default();
            for (dir, syms) in dir_syms.iter() {
                if dir.as_str() != p.rel && pkg_of(dir).as_deref() == Some(p.rel.as_str()) {
                    children.push(module_node(&p.rel, dir, syms, &mod_in, &mod_out, &churn));
                }
            }
            children.sort_by(|a, b| a.path.cmp(&b.path));
            let sym_names = root_syms.iter().map(|s| s.name.clone()).collect();
            children.extend(root_syms.iter().map(|s| s.leaf_node()));
            TreeNode {
                name: p.name.clone(),
                path: p.rel.clone(),
                kind: "package".into(),
                loc: children.iter().map(|c| c.loc).sum(),
                symbols: sym_names,
                fan_in: pkg_in.get(&p.rel).map(|s| s.len() as i64).unwrap_or(0),
                fan_out: pkg_out.get(&p.rel).map(|s| s.len() as i64).unwrap_or(0),
                churn_30d: churn_under(&churn, &p.rel),
                children,
            }
        })
        .collect();
    ModuleTree { name, packages }
}

struct Leaf {
    name: String,
    file: String,
    loc: usize,
    fan_in: i64,
    fan_out: i64,
}

impl Leaf {
    fn leaf_node(&self) -> TreeNode {
        TreeNode {
            name: self.name.clone(),
            path: self.file.clone(),
            kind: "symbol".into(),
            loc: self.loc,
            symbols: vec![],
            fan_in: self.fan_in,
            fan_out: self.fan_out,
            churn_30d: 0,
            children: vec![],
        }
    }
}

fn module_node(
    pkg: &str,
    dir: &str,
    syms: &[Leaf],
    mod_in: &BTreeMap<String, BTreeSet<String>>,
    mod_out: &BTreeMap<String, BTreeSet<String>>,
    churn: &BTreeSet<String>,
) -> TreeNode {
    let name = module_name(pkg, dir);
    let children: Vec<TreeNode> = syms.iter().map(|s| s.leaf_node()).collect();
    TreeNode {
        name,
        path: dir.to_string(),
        kind: "module".into(),
        loc: syms.iter().map(|s| s.loc).sum(),
        symbols: syms.iter().map(|s| s.name.clone()).collect(),
        fan_in: mod_in.get(dir).map(|s| s.len() as i64).unwrap_or(0),
        fan_out: mod_out.get(dir).map(|s| s.len() as i64).unwrap_or(0),
        churn_30d: churn_under(churn, dir),
        children,
    }
}

/// A module's name: its dir relative to the package, minus `src` segments,
/// so `crates/core/src` reads `crates/core` and `src/net` reads `net`.
fn module_name(pkg: &str, dir: &str) -> String {
    let rel = if pkg == "." { dir } else { dir.strip_prefix(&format!("{pkg}/")).unwrap_or(dir) };
    let parts: Vec<&str> = rel.split('/').filter(|s| *s != "src").collect();
    if parts.is_empty() {
        rel.to_string()
    } else {
        parts.join("/")
    }
}

/// `rel` is "." for the repo root, which owns every directory.
fn owns(rel: &str, dir: &str) -> bool {
    rel == "." || dir == rel || dir.starts_with(&format!("{rel}/"))
}

fn dir_of(path: &str) -> String {
    path.rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_else(|| ".".into())
}

fn churn_under(churn: &BTreeSet<String>, dir: &str) -> i64 {
    if dir == "." {
        return churn.len() as i64;
    }
    churn.iter().filter(|f| f.as_str() == dir || f.starts_with(&format!("{dir}/"))).count() as i64
}

fn changed_files(root: &Path) -> BTreeSet<String> {
    let out =
        std::process::Command::new("git").arg("-C").arg(root).args(["log", "--since=30.days", "--name-only", "--pretty=format:"]).output();
    let mut set = BTreeSet::new();
    if let Ok(o) = out {
        if o.status.success() {
            for line in String::from_utf8_lossy(&o.stdout).lines() {
                let line = line.trim();
                if !line.is_empty() {
                    set.insert(line.to_string());
                }
            }
        }
    }
    set
}

/// Directories holding a Cargo.toml / package.json / pyproject.toml / go.mod.
fn find_packages(root: &Path) -> Vec<Pkg> {
    let mut found: Vec<(PathBuf, (u8, String))> = Vec::new();
    walk(root, 0, &mut found);
    // One package per directory: the most specific manifest names it.
    found.sort_by(|a, b| a.0.cmp(&b.0).then(a.1 .0.cmp(&b.1 .0)));
    found.dedup_by(|b, a| a.0 == b.0);
    found
        .into_iter()
        .map(|(dir, (_, name))| {
            let rel = dir.strip_prefix(root).unwrap_or(dir.as_path()).to_string_lossy().replace('\\', "/");
            Pkg { name, rel: if rel.is_empty() { ".".into() } else { rel } }
        })
        .collect()
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<(PathBuf, (u8, String))>) {
    if depth > 8 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            let n = e.file_name().to_string_lossy().to_string();
            if !SKIP.contains(&n.as_str()) {
                walk(&p, depth + 1, out);
            }
        } else if let Some(name) = manifest_name(&p) {
            let rank = ["Cargo.toml", "pyproject.toml", "go.mod", "package.json"]
                .iter()
                .position(|m| p.file_name().is_some_and(|f| f == *m))
                .unwrap_or(9) as u8;
            out.push((dir.to_path_buf(), (rank, name)));
        }
    }
}

fn manifest_name(p: &Path) -> Option<String> {
    let body = std::fs::read_to_string(p).ok()?;
    match p.file_name()?.to_str()? {
        "Cargo.toml" => toml::from_str::<toml::Table>(&body).ok()?.get("package")?.get("name")?.as_str().map(String::from),
        "package.json" => serde_json::from_str::<serde_json::Value>(&body).ok()?["name"].as_str().map(String::from),
        "pyproject.toml" => toml::from_str::<toml::Table>(&body).ok()?.get("project")?.get("name")?.as_str().map(String::from),
        "go.mod" => {
            body.lines().find_map(|l| l.trim().strip_prefix("module ")).map(|m| m.trim().rsplit('/').next().unwrap_or(m).trim().to_string())
        }
        _ => None,
    }
}
