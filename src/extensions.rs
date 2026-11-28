//! Extensions: agent skills, prompt libraries and MCP servers, browsed from
//! open catalogs on the web and from this repo's own store, installed into the
//! agent setup kula already syncs.
//!
//! Catalogs (all open, nothing to sign up for):
//!   mcp       the official MCP Registry (registry.modelcontextprotocol.io)
//!   github    any GitHub repo holding SKILL.md folders (anthropics/skills by default)
//!   csv       prompt libraries in the prompts.chat CSV shape (act, prompt)
//!   json      a hosted list of entries in kula's own shape (see `Entry`)
//!   store     entries authored here, kept on `refs/kula/store` under extensions/
//!
//! Installing writes the usual sources and lets kula's sync fan them out:
//!   skill  -> .agents/skills/<name>/      then skills::sync
//!   mcp    -> .agents/mcp.json            then agent_config::mcp_sync
//!   prompt -> .agents/prompts/<name>.md
//! and records it in .agents/extensions.json so it can be listed and removed.

use crate::git::Repo;
use crate::kulastore;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;

const LOCK: &str = ".agents/extensions.json";
const PROMPTS: &str = ".agents/prompts";
const SOURCES_FILE: &str = "extension-sources.json";
const CACHE_TTL: u64 = 6 * 3600;
const MAX_FETCH: &str = "25000000";
pub const KINDS: &[&str] = &["skill", "prompt", "mcp"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Source {
    pub id: String,
    /// mcp | github | csv | json | store
    pub kind: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub builtin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Install {
    /// an MCP server: a command to start, or a remote url
    Mcp {
        #[serde(default)]
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        url: String,
        /// environment variables the server needs before it works
        #[serde(default)]
        env: Vec<String>,
    },
    /// a folder inside a GitHub repo
    Git { repo: String, path: String },
    /// text that is the whole extension (a prompt)
    Text { body: String },
    /// a folder on refs/kula/store
    Store { path: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Entry {
    /// "<source>:<name>"
    pub id: String,
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub source: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub author: String,
    /// a page to read about it
    #[serde(default)]
    pub homepage: String,
    pub install: Install,
}

#[derive(Debug, Serialize)]
pub struct Page {
    pub entries: Vec<Entry>,
    pub next: Option<String>,
    pub total: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Installed {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub source: String,
    #[serde(default)]
    pub version: String,
    pub at: i64,
    #[serde(default)]
    pub needs: Vec<String>,
}

// ------------------------------------------------------------------ sources

pub fn builtin_sources() -> Vec<Source> {
    let s = |id: &str, kind: &str, url: &str, label: &str| Source { id: id.into(), kind: kind.into(), url: url.into(), label: label.into(), builtin: true };
    vec![
        s("store", "store", "", "This repo"),
        s("mcp", "mcp", "https://registry.modelcontextprotocol.io", "MCP Registry"),
        s("anthropic-skills", "github", "anthropics/skills", "Anthropic skills"),
        s("prompts-chat", "csv", "https://raw.githubusercontent.com/f/awesome-chatgpt-prompts/main/prompts.csv", "prompts.chat"),
    ]
}

fn sources_path(repo: &Repo) -> PathBuf {
    repo.kula_dir().join(SOURCES_FILE)
}

pub fn sources(repo: &Repo) -> Vec<Source> {
    let mut v = builtin_sources();
    if let Ok(t) = std::fs::read_to_string(sources_path(repo)) {
        if let Ok(extra) = serde_json::from_str::<Vec<Source>>(&t) {
            v.extend(extra.into_iter().filter(|s| !s.builtin).map(|mut s| {
                s.builtin = false;
                s
            }));
        }
    }
    v
}

/// Add a catalog: "owner/repo" or a github url is a skill repo, a .csv url a
/// prompt library, any other https url a kula JSON catalog.
pub fn add_source(repo: &Repo, spec: &str, label: Option<&str>) -> Result<Source> {
    let spec = spec.trim();
    let (kind, url) = if let Some(r) = github_repo(spec) {
        ("github", r)
    } else if spec.starts_with("https://") {
        (if spec.to_lowercase().ends_with(".csv") { "csv" } else { "json" }, spec.to_string())
    } else {
        bail!("give an owner/repo or an https url");
    };
    let id = slug(&url.trim_start_matches("https://").replace(['/', '.'], "-"));
    let mut all = sources(repo);
    if all.iter().any(|s| s.id == id || s.url == url) {
        bail!("that catalog is already added");
    }
    let s = Source { id, kind: kind.into(), label: label.map(String::from).unwrap_or_else(|| url.clone()), url, builtin: false };
    all.push(s.clone());
    save_sources(repo, &all)?;
    Ok(s)
}

pub fn remove_source(repo: &Repo, id: &str) -> Result<()> {
    let all = sources(repo);
    if all.iter().any(|s| s.id == id && s.builtin) {
        bail!("built in catalogs stay");
    }
    save_sources(repo, &all.into_iter().filter(|s| s.id != id).collect::<Vec<_>>())
}

fn save_sources(repo: &Repo, all: &[Source]) -> Result<()> {
    let extra: Vec<&Source> = all.iter().filter(|s| !s.builtin).collect();
    std::fs::create_dir_all(repo.kula_dir())?;
    std::fs::write(sources_path(repo), serde_json::to_vec_pretty(&extra)?)?;
    Ok(())
}

fn github_repo(s: &str) -> Option<String> {
    let s = s.trim().trim_end_matches('/').trim_end_matches(".git");
    let s = s.strip_prefix("https://github.com/").unwrap_or(s);
    let ok = |p: &str| !p.is_empty() && p != "." && p != ".." && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    let mut it = s.split('/');
    let (o, r) = (it.next()?, it.next()?);
    (it.next().is_none() && ok(o) && ok(r)).then(|| format!("{o}/{r}"))
}

/// Lowercase letters, digits, - and _: safe as a folder and as a skill name.
pub fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.to_lowercase().chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let t = out.trim_matches('-');
    let t: String = t.chars().take(64).collect();
    if t.is_empty() { "ext".into() } else { t.trim_end_matches('-').to_string() }
}

// ------------------------------------------------------------------ fetching

fn fetch(url: &str) -> Result<Vec<u8>> {
    if !url.starts_with("https://") {
        bail!("only https urls are fetched");
    }
    if std::env::var_os("KULA_NO_NET").is_some() {
        bail!("network is off (KULA_NO_NET)");
    }
    let o = Command::new("curl")
        .args(["-fsSL", "--proto", "=https", "--proto-redir", "=https", "--max-time", "25", "--max-filesize", MAX_FETCH])
        .args(["-A", concat!("kula/", env!("CARGO_PKG_VERSION")), "-H", "Accept: application/json, text/plain, */*"])
        .arg("--")
        .arg(url)
        .output()
        .context("curl is needed to browse catalogs")?;
    if !o.status.success() {
        bail!("could not fetch {url}: {}", String::from_utf8_lossy(&o.stderr).trim());
    }
    Ok(o.stdout)
}

/// A fetched document, cached under .kula/cache for a few hours.
fn cached(repo: &Repo, key: &str, url: &str, refresh: bool) -> Result<Vec<u8>> {
    let dir = repo.kula_dir().join("cache/extensions");
    let path = dir.join(format!("{}.cache", slug(key)));
    if !refresh {
        if let Ok(m) = std::fs::metadata(&path) {
            let fresh = m.modified().ok().and_then(|t| t.elapsed().ok()).map(|e| e.as_secs() < CACHE_TTL).unwrap_or(false);
            if fresh {
                if let Ok(b) = std::fs::read(&path) {
                    return Ok(b);
                }
            }
        }
    }
    let b = fetch(url)?;
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&path, &b);
    Ok(b)
}

// ------------------------------------------------------------------ catalogs

/// One page of a catalog, filtered by `query` (and `kind` when given).
pub fn browse(repo: &Repo, source: &str, query: &str, kind: Option<&str>, cursor: Option<&str>, refresh: bool) -> Result<Page> {
    let Some(src) = sources(repo).into_iter().find(|s| s.id == source) else {
        bail!("no catalog {source:?}");
    };
    let q = query.trim().to_lowercase();
    let page = match src.kind.as_str() {
        "mcp" => return mcp_registry(&src, query, cursor),
        "github" => github_skills(repo, &src, refresh)?,
        "csv" => parse_prompts_csv(&src.id, &String::from_utf8_lossy(&cached(repo, &src.id, &src.url, refresh)?)),
        "json" => parse_json_catalog(&src.id, &cached(repo, &src.id, &src.url, refresh)?)?,
        "store" => store_entries(repo)?,
        k => bail!("unknown catalog kind {k:?}"),
    };
    let hits: Vec<Entry> = page
        .into_iter()
        .filter(|e| kind.map(|k| e.kind == k).unwrap_or(true))
        .filter(|e| q.is_empty() || e.name.to_lowercase().contains(&q) || e.description.to_lowercase().contains(&q))
        .collect();
    let start: usize = cursor.and_then(|c| c.parse().ok()).unwrap_or(0);
    let total = hits.len();
    let entries: Vec<Entry> = hits.into_iter().skip(start).take(60).collect();
    let next = (start + entries.len() < total).then(|| (start + entries.len()).to_string());
    Ok(Page { entries, next, total: Some(total) })
}

fn mcp_registry(src: &Source, query: &str, cursor: Option<&str>) -> Result<Page> {
    let mut url = format!("{}/v0/servers?limit=40", src.url.trim_end_matches('/'));
    let enc = |s: &str| s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect::<String>();
    if !query.trim().is_empty() {
        url.push_str(&format!("&search={}", enc(query.trim())));
    }
    if let Some(c) = cursor {
        url.push_str(&format!("&cursor={}", enc(c)));
    }
    let v: Value = serde_json::from_slice(&fetch(&url)?).context("the MCP registry sent something unexpected")?;
    Ok(parse_mcp_registry(&src.id, &v))
}

pub fn parse_mcp_registry(source: &str, v: &Value) -> Page {
    let s = |v: &Value, k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or_default().to_string();
    let mut entries = vec![];
    let mut seen = std::collections::HashSet::new();
    for item in v.get("servers").and_then(|x| x.as_array()).into_iter().flatten() {
        let srv = item.get("server").unwrap_or(item);
        let full = s(srv, "name");
        if full.is_empty() || !seen.insert(full.clone()) {
            continue;
        }
        let Some(install) = mcp_install(srv) else { continue };
        let short = full.rsplit('/').next().unwrap_or(&full);
        let homepage = srv.get("repository").map(|r| s(r, "url")).filter(|u| u.starts_with("https://")).unwrap_or_else(|| s(srv, "websiteUrl"));
        entries.push(Entry {
            id: format!("{source}:{full}"),
            kind: "mcp".into(),
            name: slug(short),
            description: s(srv, "description"),
            source: source.into(),
            version: s(srv, "version"),
            author: full.split('/').next().unwrap_or_default().to_string(),
            homepage,
            install,
        });
    }
    let next = v.get("metadata").and_then(|m| m.get("nextCursor").or_else(|| m.get("next_cursor"))).and_then(|x| x.as_str()).map(String::from);
    Page { entries, next, total: None }
}

/// How to start a registry server: a package we know how to run, else a remote.
fn mcp_install(srv: &Value) -> Option<Install> {
    let s = |v: &Value, k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or_default().to_string();
    for p in srv.get("packages").and_then(|x| x.as_array()).into_iter().flatten() {
        let id = s(p, "identifier");
        if id.is_empty() || id.starts_with('-') {
            continue;
        }
        let ver = s(p, "version");
        let transport = p.get("transport").map(|t| s(t, "type")).unwrap_or_default();
        if !transport.is_empty() && transport != "stdio" {
            continue;
        }
        let env: Vec<String> = p
            .get("environmentVariables")
            .and_then(|x| x.as_array())
            .into_iter()
            .flatten()
            .filter(|e| e.get("isRequired").and_then(|x| x.as_bool()).unwrap_or(false))
            .map(|e| s(e, "name"))
            .filter(|n| !n.is_empty())
            .collect();
        let pinned = |sep: &str| if ver.is_empty() || ver == "latest" { id.clone() } else { format!("{id}{sep}{ver}") };
        let (command, args) = match s(p, "registryType").as_str() {
            "npm" => ("npx", vec!["-y".to_string(), pinned("@")]),
            "pypi" => ("uvx", vec![pinned("==")]),
            "oci" | "docker" => ("docker", vec!["run".into(), "-i".into(), "--rm".into(), pinned(":")]),
            _ => continue,
        };
        return Some(Install::Mcp { command: command.into(), args, url: String::new(), env });
    }
    for r in srv.get("remotes").and_then(|x| x.as_array()).into_iter().flatten() {
        let url = s(r, "url");
        if url.starts_with("https://") && !url.contains('{') {
            return Some(Install::Mcp { command: String::new(), args: vec![], url, env: vec![] });
        }
    }
    None
}

/// Every SKILL.md folder in a GitHub repo, described by its frontmatter.
fn github_skills(repo: &Repo, src: &Source, refresh: bool) -> Result<Vec<Entry>> {
    let r = github_repo(&src.url).context("bad repo")?;
    let tree: Value = serde_json::from_slice(&cached(repo, &format!("{}-tree", src.id), &format!("https://api.github.com/repos/{r}/git/trees/HEAD?recursive=1"), refresh)?)?;
    let dirs: Vec<String> = tree
        .get("tree")
        .and_then(|x| x.as_array())
        .into_iter()
        .flatten()
        .filter_map(|n| n.get("path").and_then(|p| p.as_str()))
        .filter(|p| *p == "SKILL.md" || p.ends_with("/SKILL.md"))
        .map(|p| p.trim_end_matches("SKILL.md").trim_end_matches('/').to_string())
        .collect();
    let mut out: Vec<Entry> = vec![];
    for d in canonical_dirs(dirs).into_iter().take(120) {
        let file = if d.is_empty() { "SKILL.md".to_string() } else { format!("{d}/SKILL.md") };
        let md = cached(repo, &format!("{}-{}", src.id, d), &format!("https://raw.githubusercontent.com/{r}/HEAD/{file}"), refresh).map(|b| String::from_utf8_lossy(&b).to_string()).unwrap_or_default();
        let (name, description) = frontmatter(&md);
        let leaf = d.rsplit('/').next().filter(|s| !s.is_empty()).unwrap_or(r.split('/').nth(1).unwrap_or("skill"));
        let name = slug(name.as_deref().unwrap_or(leaf));
        if out.iter().any(|e| e.name == name) {
            continue;
        }
        out.push(Entry {
            id: format!("{}:{}", src.id, if d.is_empty() { name.clone() } else { d.clone() }),
            kind: "skill".into(),
            name,
            description: description.unwrap_or_default(),
            source: src.id.clone(),
            version: String::new(),
            author: r.split('/').next().unwrap_or_default().into(),
            homepage: format!("https://github.com/{r}/tree/HEAD/{d}"),
            install: Install::Git { repo: r.clone(), path: d },
        });
    }
    Ok(out)
}

/// One folder per skill: repos mirror a skill under `.claude/`, `.cursor/` and
/// friends and keep test copies, so drop fixtures and keep the plainest path.
fn canonical_dirs(mut dirs: Vec<String>) -> Vec<String> {
    const JUNK: [&str; 6] = ["test", "tests", "fixtures", "fixture", "__tests__", "node_modules"];
    dirs.retain(|d| !d.split('/').any(|s| JUNK.contains(&s)));
    dirs.sort_by_key(|d| (d.split('/').filter(|s| s.starts_with('.')).count(), d.matches('/').count(), d.clone()));
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| seen.insert(d.rsplit('/').next().unwrap_or_default().to_string()));
    dirs
}

/// `name:` and `description:` from a SKILL.md frontmatter block.
pub fn frontmatter(md: &str) -> (Option<String>, Option<String>) {
    let mut lines = md.lines().peekable();
    if lines.next().map(str::trim) != Some("---") {
        return (None, None);
    }
    let (mut name, mut desc) = (None, None);
    while let Some(l) = lines.next() {
        if l.trim() == "---" {
            break;
        }
        let Some((k, v)) = l.split_once(':') else { continue };
        if k.starts_with(' ') || !(k == "name" || k == "description") {
            continue;
        }
        let mut v = v.trim().to_string();
        if v.is_empty() || v.starts_with('>') || v.starts_with('|') {
            // a block scalar: the indented lines that follow
            let mut parts = vec![];
            while let Some(n) = lines.peek() {
                if n.starts_with(' ') || n.starts_with('\t') || n.trim().is_empty() && parts.is_empty() {
                    parts.push(n.trim().to_string());
                    lines.next();
                } else {
                    break;
                }
            }
            v = parts.into_iter().filter(|p| !p.is_empty()).collect::<Vec<_>>().join(" ");
        }
        let v = v.trim_matches('"').trim_matches('\'').to_string();
        if k == "name" { name = Some(v) } else { desc = Some(v) }
    }
    (name.filter(|s| !s.is_empty()), desc.filter(|s| !s.is_empty()))
}

/// prompts.chat shape: a header row with `act` and `prompt` columns.
pub fn parse_prompts_csv(source: &str, text: &str) -> Vec<Entry> {
    let rows = csv_rows(text);
    let Some(head) = rows.first() else { return vec![] };
    let col = |n: &str| head.iter().position(|h| h.trim().eq_ignore_ascii_case(n));
    let (Some(a), Some(p)) = (col("act"), col("prompt")) else { return vec![] };
    let by = col("contributor");
    let mut seen = std::collections::HashSet::new();
    rows.iter()
        .skip(1)
        .filter_map(|r| {
            let act = r.get(a)?.trim();
            let body = r.get(p)?.trim();
            if act.is_empty() || body.is_empty() {
                return None;
            }
            let name = slug(act);
            if !seen.insert(name.clone()) {
                return None;
            }
            let description: String = body.chars().take(220).collect();
            Some(Entry {
                id: format!("{source}:{name}"),
                kind: "prompt".into(),
                description: act.to_string() + ": " + &description,
                name,
                source: source.into(),
                version: String::new(),
                author: by.and_then(|i| r.get(i)).map(|s| s.trim().to_string()).unwrap_or_default(),
                homepage: String::new(),
                install: Install::Text { body: body.to_string() },
            })
        })
        .collect()
}

/// RFC 4180 rows: quoted fields, doubled quotes, newlines inside quotes.
fn csv_rows(text: &str) -> Vec<Vec<String>> {
    let mut rows = vec![];
    let mut row = vec![];
    let mut f = String::new();
    let mut q = false;
    let mut it = text.chars().peekable();
    while let Some(c) = it.next() {
        match (q, c) {
            (true, '"') if it.peek() == Some(&'"') => {
                f.push('"');
                it.next();
            }
            (true, '"') => q = false,
            (true, c) => f.push(c),
            (false, '"') if f.is_empty() => q = true,
            (false, ',') => row.push(std::mem::take(&mut f)),
            (false, '\n') => {
                row.push(std::mem::take(&mut f));
                rows.push(std::mem::take(&mut row));
            }
            (false, '\r') => {}
            (false, c) => f.push(c),
        }
    }
    if !f.is_empty() || !row.is_empty() {
        row.push(f);
        rows.push(row);
    }
    rows
}

/// A hosted list in kula's shape: `[Entry]` or `{"entries": [Entry]}`.
pub fn parse_json_catalog(source: &str, bytes: &[u8]) -> Result<Vec<Entry>> {
    let v: Value = serde_json::from_slice(bytes).context("the catalog is not JSON")?;
    let list = v.get("entries").cloned().unwrap_or(v);
    let items: Vec<Value> = serde_json::from_value(list).context("a catalog is a list of entries")?;
    Ok(items
        .into_iter()
        .filter_map(|i| serde_json::from_value::<Entry>(i).ok())
        .filter(|e| KINDS.contains(&e.kind.as_str()) && !matches!(e.install, Install::Store { .. }))
        .map(|mut e| {
            e.name = slug(&e.name);
            e.id = format!("{source}:{}", e.name);
            e.source = source.into();
            e
        })
        .collect())
}

// ------------------------------------------------------------------ the repo's own store

fn drafts(repo: &Repo) -> PathBuf {
    repo.kula_dir().join("extensions")
}

/// Entries published on refs/kula/store, read from their extension.json.
pub fn store_entries(repo: &Repo) -> Result<Vec<Entry>> {
    let files = kulastore::tree(repo, kulastore::REF)?;
    let mut out = vec![];
    for path in files.keys().filter(|p| p.starts_with("extensions/") && p.ends_with("/extension.json")) {
        let Ok(text) = kulastore::show(repo, path, None) else { continue };
        let Ok(mut e) = serde_json::from_str::<Entry>(&text) else { continue };
        let dir = path.trim_end_matches("/extension.json").to_string();
        e.source = "store".into();
        e.id = format!("store:{}/{}", e.kind, e.name);
        if !matches!(e.install, Install::Mcp { .. }) {
            e.install = Install::Store { path: dir };
        }
        out.push(e);
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
pub struct Draft {
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub env: Vec<String>,
}

/// Create or update an entry on this repo's store.
pub fn publish(repo: &Repo, d: &Draft) -> Result<Entry> {
    if !KINDS.contains(&d.kind.as_str()) {
        bail!("kind is one of {}", KINDS.join(", "));
    }
    let name = slug(&d.name);
    if d.description.trim().is_empty() {
        bail!("say what it is for: people pick extensions by their description");
    }
    let dir = drafts(repo).join(&d.kind).join(&name);
    let install = match d.kind.as_str() {
        "mcp" => {
            if d.command.trim().is_empty() == d.url.trim().is_empty() {
                bail!("an MCP server has a command or a url");
            }
            if !d.url.is_empty() && !d.url.starts_with("https://") {
                bail!("remote servers use https");
            }
            Install::Mcp { command: d.command.trim().into(), args: d.args.clone(), url: d.url.trim().into(), env: d.env.clone() }
        }
        _ => {
            if d.body.trim().is_empty() {
                bail!("write the {} itself", d.kind);
            }
            Install::Store { path: format!("extensions/{}/{name}", d.kind) }
        }
    };
    let e = Entry {
        id: format!("store:{}/{name}", d.kind),
        kind: d.kind.clone(),
        name: name.clone(),
        description: d.description.trim().into(),
        source: "store".into(),
        version: if d.version.is_empty() { "0.1.0".into() } else { d.version.clone() },
        author: repo.user(),
        homepage: String::new(),
        install,
    };
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("extension.json"), serde_json::to_vec_pretty(&e)?)?;
    match d.kind.as_str() {
        "skill" => std::fs::write(dir.join("SKILL.md"), skill_md(&name, &e.description, &d.body))?,
        "prompt" => std::fs::write(dir.join("PROMPT.md"), d.body.trim().to_string() + "\n")?,
        _ => {}
    }
    kulastore::snapshot(repo, &["extensions".into()], Some(&format!("publish {} {name}", d.kind)))?;
    Ok(e)
}

/// Take an entry off this repo's store.
pub fn unpublish(repo: &Repo, kind: &str, name: &str) -> Result<()> {
    let name = slug(name);
    let dir = drafts(repo).join(slug(kind)).join(&name);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    kulastore::put(repo, &[], Some(&format!("extensions/{}/{name}", slug(kind))), &format!("unpublish {kind} {name}"))?;
    Ok(())
}

/// Everything this store offers, as a catalog others can add by url.
pub fn export_catalog(repo: &Repo) -> Result<Value> {
    let mut list = vec![];
    for mut e in store_entries(repo)? {
        if let Install::Store { path } = &e.install {
            let file = if e.kind == "skill" { "SKILL.md" } else { "PROMPT.md" };
            let body = kulastore::show(repo, &format!("{path}/{file}"), None).unwrap_or_default();
            if e.kind == "prompt" {
                e.install = Install::Text { body };
            } else {
                continue; // skills travel as folders: share the repo instead
            }
        }
        list.push(e);
    }
    Ok(json!({ "entries": list }))
}

fn skill_md(name: &str, description: &str, body: &str) -> String {
    let body = body.trim();
    if body.starts_with("---") {
        return body.to_string() + "\n";
    }
    format!("---\nname: {name}\ndescription: {}\n---\n\n{body}\n", description.replace('\n', " "))
}

// ------------------------------------------------------------------ install

fn lock(root: &Path) -> Vec<Installed> {
    std::fs::read_to_string(root.join(LOCK)).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| serde_json::from_value(v.get("installed").cloned().unwrap_or(Value::Null)).ok()).unwrap_or_default()
}

fn save_lock(root: &Path, list: &[Installed]) -> Result<()> {
    std::fs::create_dir_all(root.join(".agents"))?;
    std::fs::write(root.join(LOCK), serde_json::to_vec_pretty(&json!({ "installed": list }))? )?;
    Ok(())
}

pub fn installed(repo: &Repo) -> Vec<Installed> {
    lock(&repo.root)
}

#[derive(Debug, Serialize)]
pub struct Done {
    pub entry: Installed,
    pub written: Vec<String>,
}

pub fn install(repo: &Repo, e: &Entry, overwrite: bool) -> Result<Done> {
    if !KINDS.contains(&e.kind.as_str()) {
        bail!("unknown kind {:?}", e.kind);
    }
    let root = &repo.root;
    let name = slug(&e.name);
    let mut written = vec![];
    let mut needs = vec![];
    match (&e.kind[..], &e.install) {
        ("mcp", Install::Mcp { command, args, url, env }) => {
            written.push(add_mcp(root, &name, command, args, url, overwrite)?);
            written.extend(crate::agent_config::mcp_sync(root, &name).unwrap_or_default());
            needs = env.clone();
        }
        ("skill", inst) => {
            let dst = root.join(crate::skills::SOURCE).join(&name);
            if dst.exists() && !overwrite {
                bail!("a skill named {name} is already here");
            }
            let tmp = kulastore::TempDir::new()?;
            let from = match inst {
                Install::Git { repo: r, path } => clone_dir(tmp.path(), r, path)?,
                Install::Store { path } => store_dir(repo, path, tmp.path())?,
                Install::Text { body } => {
                    std::fs::write(tmp.path().join("SKILL.md"), skill_md(&name, &e.description, body))?;
                    tmp.path().to_path_buf()
                }
                _ => bail!("a skill installs from a folder"),
            };
            if !from.join("SKILL.md").is_file() {
                bail!("no SKILL.md in that folder");
            }
            if dst.exists() {
                std::fs::remove_dir_all(&dst)?;
            }
            copy_tree(&from, &dst, 0)?;
            written.push(format!("{}/{name}", crate::skills::SOURCE));
            written.extend(crate::skills::sync(root).unwrap_or_default());
        }
        ("prompt", inst) => {
            let body = match inst {
                Install::Text { body } => body.clone(),
                Install::Store { path } => kulastore::show(repo, &format!("{path}/PROMPT.md"), None)?,
                _ => bail!("a prompt installs from text"),
            };
            let dst = root.join(PROMPTS).join(format!("{name}.md"));
            if dst.exists() && !overwrite {
                bail!("a prompt named {name} is already here");
            }
            std::fs::create_dir_all(root.join(PROMPTS))?;
            let head = if e.description.is_empty() { String::new() } else { format!("<!-- {} -->\n", e.description.replace("-->", "")) };
            std::fs::write(&dst, head + body.trim() + "\n")?;
            written.push(format!("{PROMPTS}/{name}.md"));
        }
        _ => bail!("that entry cannot be installed as a {}", e.kind),
    }
    let rec = Installed { id: e.id.clone(), kind: e.kind.clone(), name, source: e.source.clone(), version: e.version.clone(), at: now(), needs };
    let mut l = lock(root);
    l.retain(|i| !(i.kind == rec.kind && i.name == rec.name));
    l.push(rec.clone());
    save_lock(root, &l)?;
    Ok(Done { entry: rec, written })
}

pub fn uninstall(repo: &Repo, kind: &str, name: &str) -> Result<Vec<String>> {
    let root = &repo.root;
    let name = slug(name);
    let mut removed = vec![];
    match kind {
        "skill" => {
            crate::skills::remove(root, &name)?;
            removed.push(format!("{}/{name}", crate::skills::SOURCE));
        }
        "prompt" => {
            let p = root.join(PROMPTS).join(format!("{name}.md"));
            if p.exists() {
                std::fs::remove_file(&p)?;
                removed.push(format!("{PROMPTS}/{name}.md"));
            }
        }
        "mcp" => {
            let path = root.join(crate::agent_config::MCP_SOURCE);
            if let Ok(t) = std::fs::read_to_string(&path) {
                let mut v: Value = serde_json::from_str(&t)?;
                if v.get_mut("mcpServers").and_then(|s| s.as_object_mut()).and_then(|s| s.remove(&name)).is_some() {
                    std::fs::write(&path, serde_json::to_string_pretty(&v)? + "\n")?;
                    removed.push(crate::agent_config::MCP_SOURCE.into());
                }
            }
        }
        _ => bail!("kind is one of {}", KINDS.join(", ")),
    }
    let mut l = lock(root);
    l.retain(|i| !(i.kind == kind && i.name == name));
    save_lock(root, &l)?;
    Ok(removed)
}

fn add_mcp(root: &Path, name: &str, command: &str, args: &[String], url: &str, overwrite: bool) -> Result<String> {
    let path = root.join(crate::agent_config::MCP_SOURCE);
    let mut v: Value = match std::fs::read_to_string(&path) {
        Ok(t) => serde_json::from_str(&t).with_context(|| format!("parsing {}", crate::agent_config::MCP_SOURCE))?,
        Err(_) => json!({}),
    };
    if !v.is_object() {
        v = json!({});
    }
    let servers = v.as_object_mut().unwrap().entry("mcpServers").or_insert_with(|| json!({}));
    let Some(servers) = servers.as_object_mut() else { bail!("mcpServers is not an object") };
    if servers.contains_key(name) && !overwrite {
        bail!("an MCP server named {name} is already here");
    }
    let def = if !url.is_empty() { json!({ "type": "http", "url": url }) } else { json!({ "command": command, "args": args }) };
    servers.insert(name.into(), def);
    std::fs::create_dir_all(path.parent().unwrap())?;
    std::fs::write(&path, serde_json::to_string_pretty(&v)? + "\n")?;
    Ok(crate::agent_config::MCP_SOURCE.into())
}

/// A shallow, sparse clone of one folder of a GitHub repo.
fn clone_dir(tmp: &Path, repo: &str, path: &str) -> Result<PathBuf> {
    let r = github_repo(repo).context("bad repo")?;
    if path.split('/').any(|c| c == ".." || c == ".git") || path.starts_with('/') || path.starts_with('-') {
        bail!("bad path in repo");
    }
    if std::env::var_os("KULA_NO_NET").is_some() {
        bail!("network is off (KULA_NO_NET)");
    }
    let dst = tmp.join("src");
    let git = |args: &[&str]| -> Result<()> {
        let o = Command::new("git").args(["-c", "protocol.allow=never", "-c", "protocol.https.allow=always"]).args(args).env("GIT_TERMINAL_PROMPT", "0").output()?;
        if !o.status.success() {
            bail!("git {}: {}", args.first().unwrap_or(&""), String::from_utf8_lossy(&o.stderr).trim());
        }
        Ok(())
    };
    let url = format!("https://github.com/{r}.git");
    let d = dst.to_string_lossy().to_string();
    git(&["clone", "--quiet", "--depth", "1", "--filter=blob:none", "--sparse", "--", &url, &d])?;
    if !path.is_empty() {
        git(&["-C", &d, "sparse-checkout", "set", "--", path])?;
    }
    Ok(if path.is_empty() { dst } else { dst.join(path) })
}

/// Write a store folder out to disk.
fn store_dir(repo: &Repo, prefix: &str, tmp: &Path) -> Result<PathBuf> {
    let files = kulastore::tree(repo, kulastore::REF)?;
    let pre = format!("{}/", prefix.trim_end_matches('/'));
    let mut any = false;
    for (p, (_, sha)) in files.iter().filter(|(p, _)| p.starts_with(&pre)) {
        let rel = &p[pre.len()..];
        if rel == "extension.json" || rel.split('/').any(|c| c == "..") {
            continue;
        }
        let o = Command::new("git").arg("-C").arg(&repo.root).args(["cat-file", "blob", sha]).output()?;
        let dst = tmp.join(rel);
        std::fs::create_dir_all(dst.parent().unwrap())?;
        std::fs::write(dst, o.stdout)?;
        any = true;
    }
    if !any {
        bail!("{prefix} is not on the store");
    }
    Ok(tmp.to_path_buf())
}

fn copy_tree(from: &Path, to: &Path, depth: usize) -> Result<()> {
    if depth > 8 {
        return Ok(());
    }
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)?.flatten() {
        let n = e.file_name();
        if n == ".git" || n == ".DS_Store" {
            continue;
        }
        let ft = e.file_type()?;
        if ft.is_symlink() {
            continue; // never follow links out of a downloaded folder
        }
        if ft.is_dir() {
            copy_tree(&e.path(), &to.join(&n), depth + 1)?;
        } else if ft.is_file() {
            std::fs::copy(e.path(), to.join(&n))?;
        }
    }
    Ok(())
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    #[test]
    fn canonical_dirs_drop_mirrors_and_fixtures() {
        let d = super::canonical_dirs(vec![".cursor/skills/x".into(), "skills/x".into(), ".claude/skills/x".into(), "tests/fixtures/x".into(), "y".into()]);
        assert_eq!(d, vec!["y".to_string(), "skills/x".to_string()]);
    }

    use super::*;

    #[test]
    fn registry_entries_pick_a_runnable_install() {
        let v = json!({
            "servers": [
                { "server": { "name": "io.github.acme/weather", "description": "Forecasts", "version": "1.2.0",
                    "packages": [{ "registryType": "npm", "identifier": "@acme/weather", "version": "1.2.0", "transport": { "type": "stdio" },
                        "environmentVariables": [{ "name": "WEATHER_KEY", "isRequired": true }] }] } },
                { "server": { "name": "com.example/remote", "remotes": [{ "type": "streamable-http", "url": "https://mcp.example.com/mcp" }] } },
                { "server": { "name": "bad/one", "packages": [{ "registryType": "npm", "identifier": "--evil" }] } }
            ],
            "metadata": { "nextCursor": "abc" }
        });
        let p = parse_mcp_registry("mcp", &v);
        assert_eq!(p.entries.len(), 2);
        assert_eq!(p.next.as_deref(), Some("abc"));
        assert_eq!(p.entries[0].name, "weather");
        assert_eq!(p.entries[0].install, Install::Mcp { command: "npx".into(), args: vec!["-y".into(), "@acme/weather@1.2.0".into()], url: String::new(), env: vec!["WEATHER_KEY".into()] });
        assert!(matches!(&p.entries[1].install, Install::Mcp { url, .. } if url == "https://mcp.example.com/mcp"));
    }

    #[test]
    fn prompts_csv_handles_quotes_and_newlines() {
        let csv = "act,prompt,for_devs\n\"Linux Terminal\",\"I want you to act as a \"\"terminal\"\".\nReply only.\",TRUE\nPoet,Write poems,FALSE\n";
        let e = parse_prompts_csv("p", csv);
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].name, "linux-terminal");
        assert_eq!(e[0].install, Install::Text { body: "I want you to act as a \"terminal\".\nReply only.".into() });
    }

    #[test]
    fn slugs_and_repos_stay_safe() {
        assert_eq!(slug("../../Etc Passwd"), "etc-passwd");
        assert_eq!(github_repo("https://github.com/anthropics/skills"), Some("anthropics/skills".into()));
        assert_eq!(github_repo("a/../b"), None);
        assert_eq!(github_repo("../x"), None);
        assert_eq!(frontmatter("---\nname: pdf\ndescription: \"Read PDFs\"\n---\nbody"), (Some("pdf".into()), Some("Read PDFs".into())));
        assert_eq!(frontmatter("---\nname: a\ndescription: >\n  one\n  two\nlicense: x\n---\n").1, Some("one two".into()));
    }

    #[test]
    fn publish_install_uninstall_round_trip() {
        let d = tempfile::tempdir().unwrap();
        let g = |a: &[&str]| assert!(Command::new("git").arg("-C").arg(d.path()).args(a).output().unwrap().status.success());
        g(&["init", "-q"]);
        g(&["config", "user.email", "t@t"]);
        g(&["config", "user.name", "t"]);
        let r = Repo { root: d.path().canonicalize().unwrap() };
        let draft = Draft { kind: "prompt".into(), name: "Code Review".into(), description: "Review a diff".into(), body: "Review this.".into(), version: String::new(), command: String::new(), args: vec![], url: String::new(), env: vec![] };
        let e = publish(&r, &draft).unwrap();
        let listed = store_entries(&r).unwrap();
        assert_eq!(listed.len(), 1);
        install(&r, &listed[0], false).unwrap();
        assert!(std::fs::read_to_string(r.root.join(".agents/prompts/code-review.md")).unwrap().contains("Review this."));
        assert_eq!(installed(&r).len(), 1);
        assert!(install(&r, &listed[0], false).is_err());
        let mcp = Entry { id: "x:m".into(), kind: "mcp".into(), name: "m".into(), description: String::new(), source: "x".into(), version: String::new(), author: String::new(), homepage: String::new(), install: Install::Mcp { command: "npx".into(), args: vec!["-y".into(), "m".into()], url: String::new(), env: vec![] } };
        install(&r, &mcp, false).unwrap();
        assert!(std::fs::read_to_string(r.root.join(".agents/mcp.json")).unwrap().contains("\"npx\""));
        uninstall(&r, "mcp", "m").unwrap();
        uninstall(&r, "prompt", &e.name).unwrap();
        assert!(installed(&r).is_empty());
        unpublish(&r, "prompt", "code-review").unwrap();
        assert!(store_entries(&r).unwrap().is_empty());
    }
}
