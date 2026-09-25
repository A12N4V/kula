//! Setting kula up in a project, and the commands that keep it honest there:
//! `init` (like `npm init`), `hooks`, `deps` and `check` (the CI gate).

use crate::config::{self, Config};
use crate::git::Repo;
use crate::store::Store;
use crate::term::*;
use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, IsTerminal, Write};
use std::path::{Path, PathBuf};

// ------------------------------------------------------------------ init

pub struct InitOpts {
    pub yes: bool,
    pub hooks: Option<bool>,
    pub agents: Option<bool>,
    pub ci: Option<String>,
    pub index: bool,
}

/// Ask a yes/no question on a TTY; take the default otherwise (or with -y).
fn ask(yes: bool, q: &str, default: bool) -> bool {
    if yes || !std::io::stdin().is_terminal() {
        return default;
    }
    eprint!("  {} {} {} ", accent("?"), q, dim(if default { "[Y/n]" } else { "[y/N]" }));
    std::io::stderr().flush().ok();
    let mut line = String::new();
    if std::io::stdin().lock().read_line(&mut line).is_err() {
        return default;
    }
    match line.trim().to_ascii_lowercase().as_str() {
        "" => default,
        s => s.starts_with('y'),
    }
}

fn ask_str(yes: bool, q: &str, default: &str) -> String {
    if yes || !std::io::stdin().is_terminal() {
        return default.to_string();
    }
    eprint!("  {} {} {} ", accent("?"), q, dim(&format!("({default})")));
    std::io::stderr().flush().ok();
    let mut line = String::new();
    std::io::stdin().lock().read_line(&mut line).ok();
    let t = line.trim();
    if t.is_empty() { default.to_string() } else { t.to_string() }
}

fn done(what: &str, detail: &str) {
    eprintln!("  {} {} {}", green("✓"), what, dim(detail));
}

/// `kula init`: make this directory a kula project. Idempotent – running it
/// again only fills in what's missing.
pub fn init(dir: &Path, o: InitOpts) -> Result<()> {
    eprintln!("{}", accent(BANNER));
    // 1. A git repository (kula is a superset of git).
    let repo = match Repo::discover(dir) {
        Ok(r) => r,
        Err(_) => {
            let st = std::process::Command::new("git").arg("-C").arg(dir).args(["init", "-q"]).status()?;
            if !st.success() {
                bail!("git init failed in {}", dir.display());
            }
            done("git repository", "initialised");
            Repo::discover(dir)?
        }
    };
    let root = repo.root.clone();

    // 2. kula.toml.
    if config::Config::exists(&root) {
        done(config::FILE, "already present – left as is");
    } else {
        let mut c = Config::default();
        c.project.name = ask_str(o.yes, "project name", &repo.name());
        c.project.default_branch = ask_str(o.yes, "default branch", &default_branch(&repo, &c));
        std::fs::write(root.join(config::FILE), c.render())?;
        done(config::FILE, "written – commit it so the team shares one graph");
    }
    let cfg = Config::load(&root)?;

    // 3. The graph lives in .kula/ (self-ignored), never in history.
    std::fs::create_dir_all(repo.kula_dir())?;
    std::fs::write(repo.kula_dir().join(".gitignore"), "*\n").ok();

    // 4. Hooks keep the graph current without anyone thinking about it.
    if o.hooks.unwrap_or_else(|| ask(o.yes, "install git hooks that reindex after commit/checkout/merge?", cfg.hooks.reindex)) {
        let n = hooks_install(&repo)?;
        done("git hooks", &format!("{n} installed (post-commit, post-checkout, post-merge)"));
    }

    // 5. AI agents: register the MCP server for tools that read .mcp.json.
    if o.agents.unwrap_or_else(|| ask(o.yes, "register kula's MCP server for AI agents (.mcp.json)?", true)) {
        write_mcp(&root)?;
        done(".mcp.json", "kula mcp registered – agents can query the graph");
    }

    // 6. CI: a gate that comments the blast radius of every change.
    let ci = o.ci.clone().unwrap_or_else(|| {
        let guess = if root.join(".gitlab-ci.yml").exists() { "gitlab" } else if root.join(".github").exists() { "github" } else { "none" };
        if ask(o.yes, &format!("add a CI check ({guess})?"), guess != "none") { guess.to_string() } else { "none".into() }
    });
    match ci.as_str() {
        "github" => {
            let p = root.join(".github/workflows/kula.yml");
            write_new(&p, GITHUB_WORKFLOW)?;
            done(".github/workflows/kula.yml", "kula check on every pull request");
        }
        "gitlab" => {
            let p = root.join(".kula-ci.yml");
            write_new(&p, GITLAB_JOB)?;
            done(".kula-ci.yml", "include it from .gitlab-ci.yml");
        }
        _ => {}
    }

    // 7. The first graph.
    if o.index {
        eprint!("  {} indexing …", accent("◯"));
        let s = crate::index::run(&repo, true)?;
        eprintln!("\r  {} graph built {}", green("✓"), dim(&format!("{} files · {} symbols · {} edges · {}ms", s.files, s.symbols, s.edges, s.millis)));
    }
    eprintln!("\n  {}  {}   {}  {}   {}  {}\n", bold("kula view"), dim("open the map"), bold("kula deps"), dim("dependencies"), bold("kula check"), dim("before you push"));
    Ok(())
}

fn write_new(p: &Path, body: &str) -> Result<()> {
    if p.exists() {
        return Ok(());
    }
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::write(p, body)?;
    Ok(())
}

/// Merge `kula` into .mcp.json's mcpServers without touching other entries.
fn write_mcp(root: &Path) -> Result<()> {
    let p = root.join(".mcp.json");
    let mut v: serde_json::Value = match std::fs::read_to_string(&p) {
        Ok(s) => serde_json::from_str(&s).with_context(|| format!("{} is not valid JSON", p.display()))?,
        Err(_) => serde_json::json!({}),
    };
    let servers = v.as_object_mut().context(".mcp.json must be an object")?.entry("mcpServers").or_insert_with(|| serde_json::json!({}));
    servers.as_object_mut().context("mcpServers must be an object")?.insert("kula".into(), serde_json::json!({ "command": "kula", "args": ["mcp"] }));
    std::fs::write(&p, serde_json::to_string_pretty(&v)? + "\n")?;
    Ok(())
}

pub fn default_branch(repo: &Repo, cfg: &Config) -> String {
    if !cfg.project.default_branch.is_empty() {
        return cfg.project.default_branch.clone();
    }
    let branches = repo.branches().unwrap_or_default();
    ["main", "master", "trunk", "develop"]
        .iter()
        .find(|d| branches.iter().any(|b| !b.remote && b.name == **d))
        .map(|d| d.to_string())
        .unwrap_or_else(|| repo.branch())
}

const GITHUB_WORKFLOW: &str = r#"# kula check: the knowledge-graph blast radius of every pull request.
name: kula
on:
  pull_request:
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm i -g kula-cli
      - run: kula index --quiet
      - name: Blast radius
        run: kula check --base "origin/${{ github.base_ref }}" --md >> "$GITHUB_STEP_SUMMARY"
"#;

const GITLAB_JOB: &str = r#"# include: { local: .kula-ci.yml } from .gitlab-ci.yml
kula:check:
  image: node:22
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - npm i -g kula-cli
    - git fetch origin "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
    - kula index --quiet
    - kula check --base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" --md | tee kula-check.md
  artifacts:
    paths: [kula-check.md]
"#;

// ------------------------------------------------------------------ hooks

const HOOKS: &[&str] = &["post-commit", "post-checkout", "post-merge"];
const MARK: &str = "# >>> kula";
const MARK_END: &str = "# <<< kula";
const HOOK_BODY: &str = "command -v kula >/dev/null 2>&1 && (kula index --if-stale --quiet >/dev/null 2>&1 &)";

fn hooks_dir(repo: &Repo) -> Result<PathBuf> {
    let p = repo.run(&["rev-parse", "--git-path", "hooks"])?;
    let p = PathBuf::from(p.trim());
    Ok(if p.is_absolute() { p } else { repo.root.join(p) })
}

/// Add kula's block to each hook, keeping whatever else is there.
pub fn hooks_install(repo: &Repo) -> Result<usize> {
    let dir = hooks_dir(repo)?;
    std::fs::create_dir_all(&dir)?;
    let mut n = 0;
    for h in HOOKS {
        let p = dir.join(h);
        let cur = std::fs::read_to_string(&p).unwrap_or_default();
        if cur.contains(MARK) {
            n += 1;
            continue;
        }
        let base = if cur.is_empty() { "#!/bin/sh\n".to_string() } else if cur.ends_with('\n') { cur } else { cur + "\n" };
        std::fs::write(&p, format!("{base}{MARK} – keeps the knowledge graph current\n{HOOK_BODY}\n{MARK_END}\n"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755))?;
        }
        n += 1;
    }
    Ok(n)
}

pub fn hooks_uninstall(repo: &Repo) -> Result<usize> {
    let dir = hooks_dir(repo)?;
    let mut n = 0;
    for h in HOOKS {
        let p = dir.join(h);
        let Ok(cur) = std::fs::read_to_string(&p) else { continue };
        let (Some(a), Some(b)) = (cur.find(MARK), cur.find(MARK_END)) else { continue };
        let rest = format!("{}{}", &cur[..a], &cur[b + MARK_END.len()..].trim_start_matches('\n'));
        if rest.trim() == "#!/bin/sh" || rest.trim().is_empty() {
            std::fs::remove_file(&p)?;
        } else {
            std::fs::write(&p, rest)?;
        }
        n += 1;
    }
    Ok(n)
}

pub fn hooks_status(repo: &Repo) -> Result<Vec<(String, bool)>> {
    let dir = hooks_dir(repo)?;
    Ok(HOOKS.iter().map(|h| (h.to_string(), std::fs::read_to_string(dir.join(h)).map(|s| s.contains(MARK)).unwrap_or(false))).collect())
}

// ------------------------------------------------------------------ deps

#[derive(Serialize)]
pub struct Dep {
    pub name: String,
    pub ecosystem: &'static str,
    /// Files importing it (0 when declared but never imported).
    pub importers: usize,
    pub declared: bool,
    /// Standard library / runtime built-in: never needs declaring.
    pub builtin: bool,
}

const NODE_BUILTINS: &[&str] = &["assert", "buffer", "child_process", "cluster", "crypto", "dgram", "dns", "events", "fs", "http", "http2", "https", "module", "net", "os", "path", "perf_hooks", "process", "querystring", "readline", "stream", "string_decoder", "timers", "tls", "tty", "url", "util", "v8", "vm", "worker_threads", "zlib"];
const PY_STDLIB: &[&str] = &["abc", "argparse", "array", "ast", "asyncio", "base64", "bisect", "collections", "contextlib", "copy", "csv", "dataclasses", "datetime", "decimal", "enum", "functools", "glob", "hashlib", "heapq", "hmac", "html", "http", "importlib", "inspect", "io", "itertools", "json", "logging", "math", "multiprocessing", "operator", "os", "pathlib", "pickle", "platform", "pprint", "queue", "random", "re", "secrets", "shutil", "signal", "socket", "sqlite3", "statistics", "string", "struct", "subprocess", "sys", "tempfile", "textwrap", "threading", "time", "timeit", "traceback", "types", "typing", "unittest", "urllib", "uuid", "warnings", "weakref", "xml", "zipfile", "zoneinfo", "__future__"];

fn ecosystem(lang: &str) -> &'static str {
    match lang {
        "javascript" | "typescript" | "tsx" => "npm",
        "python" => "pypi",
        "rust" => "cargo",
        "go" => "go",
        _ => "other",
    }
}

fn builtin(eco: &str, name: &str) -> bool {
    match eco {
        "npm" => name.starts_with("node:") || NODE_BUILTINS.contains(&name),
        "pypi" => PY_STDLIB.contains(&name),
        "cargo" => matches!(name, "std" | "core" | "alloc" | "proc_macro" | "test"),
        "go" => !name.contains('.'),
        _ => false,
    }
}

/// Normalise a declared name to how code imports it.
fn norm(eco: &str, name: &str) -> String {
    match eco {
        "cargo" => name.replace('-', "_"),
        "pypi" => name.to_ascii_lowercase().replace('-', "_"),
        _ => name.to_string(),
    }
}

/// Declared dependencies from every manifest in the tree (package.json,
/// Cargo.toml, pyproject.toml, requirements*.txt, go.mod), by ecosystem.
fn declared(root: &Path) -> BTreeMap<&'static str, BTreeSet<String>> {
    let mut out: BTreeMap<&'static str, BTreeSet<String>> = BTreeMap::new();
    let walker = ignore::WalkBuilder::new(root).hidden(true).git_ignore(true).filter_entry(|e| e.file_name() != "node_modules" && e.file_name() != "target").build();
    for e in walker.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Ok(body) = std::fs::read_to_string(e.path()) else { continue };
        match name.as_str() {
            "package.json" => {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
                    for k in ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] {
                        if let Some(m) = v.get(k).and_then(|m| m.as_object()) {
                            out.entry("npm").or_default().extend(m.keys().cloned());
                        }
                    }
                }
            }
            "Cargo.toml" => {
                if let Ok(v) = body.parse::<toml::Table>() {
                    for k in ["dependencies", "dev-dependencies", "build-dependencies"] {
                        if let Some(t) = v.get(k).and_then(|t| t.as_table()) {
                            out.entry("cargo").or_default().extend(t.keys().map(|n| norm("cargo", n)));
                        }
                    }
                }
            }
            "pyproject.toml" => {
                if let Ok(v) = body.parse::<toml::Table>() {
                    let mut add = |s: &str| {
                        let n: String = s.chars().take_while(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '.').collect();
                        if !n.is_empty() {
                            out.entry("pypi").or_default().insert(norm("pypi", &n));
                        }
                    };
                    if let Some(a) = v.get("project").and_then(|p| p.get("dependencies")).and_then(|d| d.as_array()) {
                        a.iter().filter_map(|x| x.as_str()).for_each(&mut add);
                    }
                    if let Some(t) = v.get("tool").and_then(|t| t.get("poetry")).and_then(|p| p.get("dependencies")).and_then(|d| d.as_table()) {
                        t.keys().for_each(|k| add(k));
                    }
                }
            }
            n if n.starts_with("requirements") && n.ends_with(".txt") => {
                for l in body.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with('-')) {
                    let n: String = l.chars().take_while(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '.').collect();
                    out.entry("pypi").or_default().insert(norm("pypi", &n));
                }
            }
            "go.mod" => {
                let mut in_block = false;
                for l in body.lines().map(str::trim) {
                    if l.starts_with("require (") { in_block = true; continue; }
                    if in_block && l == ")" { in_block = false; continue; }
                    let spec = if in_block { Some(l) } else { l.strip_prefix("require ") };
                    if let Some(m) = spec.and_then(|s| s.split_whitespace().next()) {
                        let short: Vec<&str> = m.split('/').take(3).collect();
                        out.entry("go").or_default().insert(short.join("/"));
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// Every external package: imported (from the graph) and/or declared (from manifests).
pub fn deps(repo: &Repo, store: &Store) -> Result<Vec<Dep>> {
    let mut st = store.conn.prepare(
        "SELECT p.name, p.lang, count(DISTINCT e.src) FROM nodes p LEFT JOIN edges e ON e.dst = p.id AND e.kind = 'IMPORTS'
         WHERE p.kind = 'package' GROUP BY p.id",
    )?;
    let imported: Vec<(String, String, usize)> =
        st.query_map([], |r| Ok((r.get(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)? as usize)))?.filter_map(|x| x.ok()).collect();
    let decl = declared(&repo.root);
    let mut seen: BTreeSet<(&'static str, String)> = BTreeSet::new();
    let mut out = Vec::new();
    for (name, lang, n) in imported {
        let eco = ecosystem(&lang);
        if !seen.insert((eco, name.clone())) {
            continue;
        }
        let declared = decl.get(eco).map(|s| s.contains(&norm(eco, &name))).unwrap_or(false);
        out.push(Dep { builtin: builtin(eco, &name), name, ecosystem: eco, importers: n, declared });
    }
    for (eco, names) in &decl {
        for n in names {
            if !out.iter().any(|d| d.ecosystem == *eco && norm(eco, &d.name) == *n) {
                out.push(Dep { name: n.clone(), ecosystem: eco, importers: 0, declared: true, builtin: false });
            }
        }
    }
    out.sort_by(|a, b| b.importers.cmp(&a.importers).then(a.ecosystem.cmp(b.ecosystem)).then(a.name.cmp(&b.name)));
    Ok(out)
}

// ------------------------------------------------------------------ check

#[derive(Serialize)]
pub struct CheckReport {
    pub base: String,
    pub head: String,
    pub risk: String,
    pub max_risk: String,
    pub pass: bool,
    pub files: usize,
    pub touched: usize,
    pub affected: usize,
    pub clusters: Vec<String>,
    pub top: Vec<(String, String, usize)>,
    pub undeclared: Vec<String>,
}

/// The CI gate: compare HEAD (or the worktree) with the base through the graph
/// and fail when the blast radius is above the project's `max_risk`.
pub fn check(repo: &Repo, store: Option<&Store>, base: &str, max_risk: &str) -> Result<CheckReport> {
    let head = if repo.run(&["status", "--porcelain"]).map(|s| s.trim().is_empty()).unwrap_or(true) { "HEAD" } else { "WORKTREE" };
    let head_ref = if head == "WORKTREE" { "HEAD" } else { head };
    let c = crate::graph::compare(repo, store, base, head_ref)?;
    let undeclared = match store {
        Some(st) => deps(repo, st)?.into_iter().filter(|d| !d.declared && !d.builtin && d.importers > 0).map(|d| format!("{} ({})", d.name, d.ecosystem)).collect(),
        None => vec![],
    };
    Ok(CheckReport {
        pass: config::risk_rank(&c.risk) <= config::risk_rank(max_risk),
        base: c.base,
        head: head.into(),
        max_risk: max_risk.into(),
        files: c.files.len(),
        touched: c.touched,
        affected: c.affected.len(),
        clusters: c.communities.clone(),
        top: c.affected.iter().take(10).map(|h| (h.node.name.clone(), h.node.path.clone(), h.depth)).collect(),
        risk: c.risk,
        undeclared,
    })
}

pub fn check_markdown(r: &CheckReport) -> String {
    let mut s = format!(
        "### kula check – {} {}\n\n| | |\n|---|---|\n| risk | **{}** (gate: {}) |\n| files changed | {} |\n| symbols touched | {} |\n| dependents affected | {} |\n| clusters | {} |\n",
        if r.pass { "✅" } else { "❌" },
        format!("`{}` → `{}`", r.base, r.head),
        r.risk,
        r.max_risk,
        r.files,
        r.touched,
        r.affected,
        if r.clusters.is_empty() { "–".into() } else { r.clusters.join(", ") },
    );
    if !r.top.is_empty() {
        s += "\n**Ripples** (nearest first)\n\n";
        for (n, p, d) in &r.top {
            s += &format!("- `{n}` · {p} · depth {d}\n");
        }
    }
    if !r.undeclared.is_empty() {
        s += &format!("\n**Imported but not declared:** {}\n", r.undeclared.join(", "));
    }
    s
}
