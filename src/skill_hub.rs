//! Skills from GitHub and memories from TencentDB Agent Memory.
//!
//! Search goes through the user's own `gh` login: GitHub code search for
//! `filename:SKILL.md`, plus the curated sets in anthropics/skills and
//! openai/skills (the same folder-with-a-SKILL.md layout the agents load).
//! An import fetches the SKILL.md and saves it as a shared skill.
//!
//! TencentDB Agent Memory keeps a repo's memory in `<dir>/.memory/`:
//! `memories.json` (atomic memories), `wiki/*.md` and `data/memory.sqlite`,
//! served by an MCP server named `tencentdb-memory` in `.mcp.json`. Import
//! copies the atomic memories and wiki titles into kula's own memory, once.
//!
//! `KULA_NO_NET=1` (set by the tests) turns every GitHub call off.

use anyhow::{anyhow, bail, Context, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::Path;
use std::process::Command;

pub const CURATED: [(&str, &str); 2] = [("anthropics/skills", "skills"), ("openai/skills", "skills/.curated")];

#[derive(Serialize, Clone, Debug)]
pub struct Hit {
    pub name: String,
    pub repo: String,
    pub path: String,
    pub url: String,
    /// "curated" for the two vendor sets, "search" for code search.
    pub source: &'static str,
}

#[derive(Serialize, Debug)]
pub struct Found {
    pub hits: Vec<Hit>,
    /// Why there are no search hits, when that is not just "no match".
    pub note: Option<String>,
}

fn offline() -> bool {
    std::env::var("KULA_NO_NET").is_ok_and(|v| !v.is_empty())
}

fn gh(args: &[&str]) -> Result<String> {
    String::from_utf8(gh_bytes(args)?).map_err(|e| anyhow!("gh output is not utf-8: {e}"))
}

fn gh_bytes(args: &[&str]) -> Result<Vec<u8>> {
    let out = Command::new("gh").args(args).output().context("gh is not installed – brew install gh, then gh auth login")?;
    if !out.status.success() {
        bail!("{}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(out.stdout)
}

/// The skill's folder name from a `…/<name>/SKILL.md` path.
fn skill_name(path: &str) -> Option<String> {
    let mut parts = path.rsplit('/');
    (parts.next()? == "SKILL.md").then(|| parts.next().map(str::to_string)).flatten()
}

fn curated(q: &str) -> Result<Vec<Hit>> {
    let q = q.to_lowercase();
    let mut hits = Vec::new();
    for (repo, under) in CURATED {
        let tree: Value = serde_json::from_str(&gh(&["api", &format!("repos/{repo}/git/trees/HEAD?recursive=1")])?)?;
        for e in tree["tree"].as_array().into_iter().flatten() {
            let path = e["path"].as_str().unwrap_or_default();
            if !path.starts_with(&format!("{under}/")) {
                continue;
            }
            let Some(name) = skill_name(path) else { continue };
            if q.is_empty() || name.to_lowercase().contains(&q) {
                hits.push(Hit {
                    url: format!("https://github.com/{repo}/blob/HEAD/{path}"),
                    name,
                    repo: repo.into(),
                    path: path.into(),
                    source: "curated",
                });
            }
        }
    }
    Ok(hits)
}

fn code_search(q: &str) -> Result<Vec<Hit>> {
    let raw = gh(&["api", "-X", "GET", "search/code", "-f", &format!("q={q} filename:SKILL.md"), "-f", "per_page=30"])?;
    let v: Value = serde_json::from_str(&raw)?;
    Ok(v["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|it| {
            let path = it["path"].as_str()?.to_string();
            Some(Hit {
                name: skill_name(&path)?,
                repo: it["repository"]["full_name"].as_str()?.into(),
                url: it["html_url"].as_str()?.into(),
                path,
                source: "search",
            })
        })
        .collect())
}

/// Skills on GitHub matching `q`: the curated sets first, then code search.
pub fn search(q: &str) -> Found {
    if offline() {
        return Found { hits: vec![], note: Some("GitHub search is off (KULA_NO_NET)".into()) };
    }
    let mut note = None;
    let mut hits = curated(q).unwrap_or_else(|e| {
        note = Some(e.to_string());
        vec![]
    });
    if !q.trim().is_empty() {
        match code_search(q.trim()) {
            Ok(more) => {
                for h in more {
                    if !hits.iter().any(|x| x.repo == h.repo && x.path == h.path) {
                        hits.push(h);
                    }
                }
            }
            Err(e) => note = Some(e.to_string()),
        }
    }
    Found { hits, note }
}

/// The skill's folder a `SKILL.md` path lives in, and every file in it.
/// Folder imports walk the git tree: SKILL.md plus `scripts/`, `references/`
/// and `assets/` travel together, up to 1 MB, never a symlink, never `..`.
/// Imported folder: (name, description, files).
pub type FolderImport = (String, String, Vec<(String, Vec<u8>)>);

pub fn folder_import(_root: &Path, repo: &str, path: &str) -> Result<FolderImport> {
    if offline() {
        bail!("GitHub is off (KULA_NO_NET)");
    }
    let ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_./".contains(c)) && !s.contains("..");
    if !ok(repo) || !ok(path) || !path.ends_with("SKILL.md") {
        bail!("not a GitHub SKILL.md: {repo} {path}");
    }
    let dir = path.strip_suffix("SKILL.md").unwrap_or(path).trim_end_matches('/');
    let tree: Value = serde_json::from_slice(&gh_bytes(&["api", &format!("repos/{repo}/git/trees/HEAD?recursive=1")])?)?;
    let mut files: Vec<(String, u64)> = vec![];
    for e in tree["tree"].as_array().into_iter().flatten() {
        let p = e["path"].as_str().unwrap_or_default();
        if e["type"].as_str() != Some("blob") || !p.starts_with(&format!("{dir}/")) {
            continue;
        }
        if e["mode"].as_str() == Some("120000") {
            bail!("refusing symlinked file {repo}/{p}");
        }
        if p.split('/').any(|c| c == "..") {
            bail!("refusing .. in {repo}/{p}");
        }
        files.push((p.to_string(), e["size"].as_u64().unwrap_or(0)));
    }
    anyhow::ensure!(!files.is_empty(), "no files under {repo}/{dir}");
    let total: u64 = files.iter().map(|(_, s)| *s).sum();
    anyhow::ensure!(total <= 1_000_000, "skill folder is {} bytes – the limit is 1 MB", total);
    let mut out: Vec<(String, Vec<u8>)> = vec![];
    for (p, _) in files {
        let rel = p.strip_prefix(&format!("{dir}/")).unwrap_or(&p).to_string();
        out.push((rel, gh_bytes(&["api", &format!("repos/{repo}/contents/{p}"), "-H", "Accept: application/vnd.github.raw"])?));
    }
    // name and description come from SKILL.md's front matter
    let (meta, _) =
        out.iter().find(|(f, _)| f == "SKILL.md").and_then(|(_, b)| std::str::from_utf8(b).ok()).map(split_front).unwrap_or(("", ""));
    let field = |k: &str| {
        meta.lines()
            .find_map(|l| l.strip_prefix(&format!("{k}:")).map(|v| v.trim().trim_matches(['"', '\'']).to_string()))
            .unwrap_or_default()
    };
    let name = Some(field("name")).filter(|s| !s.is_empty()).or_else(|| skill_name(path)).unwrap_or_default();
    let name: String =
        name.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect();
    let mut desc = field("description");
    if desc.is_empty() {
        desc = format!("Imported from {repo}");
    }
    Ok((name, desc, out))
}

/// Save a whole imported skill folder under `.agents/skills/<name>` and copy it
/// to every agent. The SKILL.md goes through the normal writer; the rest of
/// the folder is written as-is beside it.
pub fn save_folder(root: &Path, name: &str, desc: &str, files: &[(String, Vec<u8>)]) -> Result<Vec<String>> {
    let (sk, body) = files
        .iter()
        .find(|(f, _)| f == "SKILL.md")
        .map(|(_, b)| (b.clone(), std::str::from_utf8(b).unwrap_or_default().to_string()))
        .ok_or_else(|| anyhow!("the folder has no SKILL.md"))?;
    let (fm, real_body) = split_front(&body);
    let meta = |k: &str| {
        fm.lines()
            .find_map(|l| l.strip_prefix(&format!("{k}:")).map(|v| v.trim().trim_matches(['"', '\'']).to_string()))
            .unwrap_or_default()
    };
    let desc = if desc.trim().is_empty() { meta("description") } else { desc.to_string() };
    let _ = sk;
    crate::skills::save(root, name, &desc, real_body.trim())?;
    let base = root.join(crate::skills::SOURCE).join(name);
    for (rel, bytes) in files.iter().filter(|(f, _)| f != "SKILL.md") {
        if rel.split('/').any(|c| c == "..") || rel.starts_with('/') {
            bail!("refusing odd path in the skill folder: {rel:?}");
        }
        let p = base.join(rel);
        if let Some(dir) = p.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(&p, bytes)?;
    }
    crate::skills::sync(root)
}

/// Adopt an MCP server from the repo's `.mcp.json` as a shared one: merge its
/// definition into `.agents/mcp.json` (the shared source of truth), then let
/// the same writer the Connect tab uses copy it into every agent's own config.
/// Returns the config files written.
pub fn adopt_mcp(root: &Path, server: &str) -> Result<Vec<String>> {
    anyhow::ensure!(!server.is_empty(), "name the MCP server to adopt");
    let src = root.join(".mcp.json");
    let text = std::fs::read_to_string(&src).with_context(|| format!("no {} to adopt from", src.display()))?;
    let v: Value = serde_json::from_str(&text).with_context(|| format!("{} is not json", src.display()))?;
    let def = v["mcpServers"][server].clone();
    anyhow::ensure!(!def.is_null(), "no server {server:?} in {}", src.display());
    let shared_path = root.join(crate::agent_config::MCP_SOURCE);
    let mut shared: Value = std::fs::read_to_string(&shared_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({ "mcpServers": {} }));
    let obj = shared.as_object_mut().ok_or_else(|| anyhow!("{} is not a json object", shared_path.display()))?;
    let servers = obj.entry("mcpServers").or_insert_with(|| json!({}));
    servers.as_object_mut().ok_or_else(|| anyhow!("mcpServers is not an object"))?.insert(server.to_string(), def);
    std::fs::create_dir_all(root.join(".agents"))?;
    std::fs::write(&shared_path, serde_json::to_string_pretty(&shared)?)?;
    crate::agent_config::mcp_sync(root, server)
}

fn split_front(src: &str) -> (&str, &str) {
    if let Some(rest) = src.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let after = &rest[end + 4..];
            return (&rest[..end], after.strip_prefix('\n').unwrap_or(after));
        }
    }
    ("", src)
}

#[derive(Serialize, Debug)]
pub struct MemorySource {
    /// Folder holding `.memory`, relative to the repo root.
    pub dir: String,
    pub kind: &'static str,
    pub memories: usize,
    pub wiki: Vec<String>,
    pub mcp: bool,
}

fn tencent_dirs(root: &Path) -> Vec<String> {
    let mut out = vec![];
    for top in std::iter::once(".".to_string()).chain(
        std::fs::read_dir(root)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().into_owned()),
    ) {
        if top.starts_with('.') && top != "." {
            continue;
        }
        let d = if top == "." { root.to_path_buf() } else { root.join(&top) };
        if d.join(".memory/memories.json").is_file() || tencent_sqlite(&d).is_some() {
            out.push(top);
        }
    }
    out
}

/// A TencentDB sqlite store under `.memory/`, when there is no `memories.json`.
fn tencent_sqlite(dir: &Path) -> Option<std::path::PathBuf> {
    [".memory/data/memory.sqlite", ".memory/memory.sqlite"].iter().map(|p| dir.join(p)).find(|p| p.is_file())
}

/// Rows of `atomic_memories` as JSON objects (column name → value), so the
/// same field extraction works for the json and the sqlite store.
fn atomic_sqlite(dir: &Path) -> Vec<Value> {
    let Some(db) = tencent_sqlite(dir) else { return vec![] };
    let Ok(conn) = rusqlite::Connection::open_with_flags(&db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) else { return vec![] };
    let mut st = match conn.prepare("SELECT * FROM atomic_memories") {
        Ok(st) => st,
        Err(_) => return vec![],
    };
    let cols: Vec<String> = st.column_names().into_iter().map(String::from).collect();
    let rows = st.query_map([], |r| {
        let mut o = serde_json::Map::new();
        for (i, c) in cols.iter().enumerate() {
            let v = match r.get_ref(i) {
                Ok(rusqlite::types::ValueRef::Text(t)) => Value::String(String::from_utf8_lossy(t).into_owned()),
                Ok(rusqlite::types::ValueRef::Integer(n)) => Value::from(n),
                Ok(rusqlite::types::ValueRef::Real(f)) => Value::from(f),
                _ => Value::Null,
            };
            o.insert(c.clone(), v);
        }
        Ok(Value::Object(o))
    });
    rows.into_iter().flatten().flatten().collect()
}

fn mcp_named(root: &Path) -> bool {
    std::fs::read_to_string(root.join(".mcp.json")).is_ok_and(|s| s.to_lowercase().contains("tencentdb"))
}

fn atomic(dir: &Path) -> Vec<Value> {
    match std::fs::read_to_string(dir.join(".memory/memories.json")) {
        Ok(s) => serde_json::from_str::<Vec<Value>>(&s).unwrap_or_default(),
        // no memories.json: the store may keep its atomic memories in sqlite
        Err(_) => atomic_sqlite(dir),
    }
}

fn wiki(dir: &Path) -> Vec<(String, String)> {
    let mut pages: Vec<(String, String)> = std::fs::read_dir(dir.join(".memory/wiki"))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "md"))
        .map(|e| {
            let text = std::fs::read_to_string(e.path()).unwrap_or_default();
            let title = text.lines().find_map(|l| l.strip_prefix("# ")).unwrap_or_default().trim().to_string();
            (e.file_name().to_string_lossy().into_owned(), title)
        })
        .collect();
    pages.sort();
    pages
}

/// TencentDB Agent Memory stores found in this repo (root or a top folder).
pub fn sources(root: &Path) -> Vec<MemorySource> {
    let mcp = mcp_named(root);
    tencent_dirs(root)
        .into_iter()
        .map(|top| {
            let d = if top == "." { root.to_path_buf() } else { root.join(&top) };
            MemorySource {
                kind: "tencentdb",
                memories: atomic(&d).len(),
                wiki: wiki(&d).into_iter().map(|(f, t)| if t.is_empty() { f } else { t }).collect(),
                mcp,
                dir: top,
            }
        })
        .collect()
}

/// Memories to import from the store under `dir`: (text, author). Each
/// atomic memory becomes "[type/category] content"; each wiki page a
/// pointer to it by title.
pub fn tencent_memories(root: &Path, dir: &str) -> Result<Vec<(String, String)>> {
    if !tencent_dirs(root).iter().any(|d| d == dir) {
        bail!("no TencentDB memory under {dir}");
    }
    let d = if dir == "." { root.to_path_buf() } else { root.join(dir) };
    let rel = |p: &str| if dir == "." { format!(".memory/{p}") } else { format!("{dir}/.memory/{p}") };
    let mut out: Vec<(String, String)> = atomic(&d)
        .iter()
        .filter_map(|m| {
            let content = m["content"].as_str()?.trim();
            let tag =
                [m["type"].as_str(), m["category"].as_str()].into_iter().flatten().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("/");
            let by = m["source_agent"].as_str().unwrap_or("tencentdb");
            Some((if tag.is_empty() { content.to_string() } else { format!("[{tag}] {content}") }, format!("tencentdb:{by}")))
        })
        .collect();
    for (file, title) in wiki(&d) {
        out.push((
            format!("Wiki: {} – read {}", if title.is_empty() { &file } else { &title }, rel(&format!("wiki/{file}"))),
            "tencentdb:wiki".into(),
        ));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_front_matter() {
        assert_eq!(skill_name("skills/pdf/SKILL.md").as_deref(), Some("pdf"));
        assert_eq!(skill_name("skills/pdf/README.md"), None);
        let (m, b) = split_front("---\nname: x\n---\nbody\n");
        assert_eq!((m.trim(), b), ("name: x", "body\n"));
    }

    #[test]
    fn reads_sqlite_when_json_is_missing() {
        let t = std::env::temp_dir().join(format!("kula-tdb-sql-{}", std::process::id()));
        let m = t.join("AGENTS/.memory/data");
        std::fs::create_dir_all(&m).unwrap();
        let conn = rusqlite::Connection::open(m.join("memory.sqlite")).unwrap();
        conn.execute_batch(
            "CREATE TABLE atomic_memories (id INTEGER PRIMARY KEY, type TEXT, category TEXT, content TEXT, source_agent TEXT);
             INSERT INTO atomic_memories (type, category, content, source_agent) VALUES
               ('constraint', 'scope', 'No service endpoint.', 'team'),
               ('fact', '', 'Rust 1.90 toolchain.', 'codex');",
        )
        .unwrap();
        let s = sources(&t);
        assert_eq!((s.len(), s[0].dir.as_str(), s[0].memories, s[0].mcp), (1, "AGENTS", 2, false));
        let got = tencent_memories(&t, "AGENTS").unwrap();
        assert_eq!(got[0], ("[constraint/scope] No service endpoint.".into(), "tencentdb:team".into()));
        assert_eq!(got[1], ("[fact] Rust 1.90 toolchain.".into(), "tencentdb:codex".into()));
        std::fs::remove_dir_all(&t).ok();
    }

    #[test]
    fn adopts_an_mcp_server_from_mcp_json() {
        let t = std::env::temp_dir().join(format!("kula-adopt-{}", std::process::id()));
        std::fs::create_dir_all(t.join(".agents")).unwrap();
        std::fs::write(
            t.join(".mcp.json"),
            r#"{"mcpServers":{"tencentdb-memory":{"command":"npx","args":["-y","tencentdb-agent-memory"]}}}"#,
        )
        .unwrap();
        // a claude-shaped agent config so mcp_sync has somewhere to write
        std::fs::write(t.join("CLAUDE.md"), "# claude\n").unwrap();
        let w = adopt_mcp(&t, "tencentdb-memory").unwrap();
        assert!(w.iter().any(|f| f.contains("mcp.json")), "wrote {w:?}");
        let shared: Value = serde_json::from_str(&std::fs::read_to_string(t.join(".agents/mcp.json")).unwrap()).unwrap();
        assert_eq!(shared["mcpServers"]["tencentdb-memory"]["command"], "npx");
        assert!(adopt_mcp(&t, "nope").is_err());
        std::fs::remove_dir_all(&t).ok();
    }

    #[test]
    fn folder_import_validates() {
        // offline and bad paths are refused without any network call
        std::env::set_var("KULA_NO_NET", "1");
        assert!(folder_import(Path::new("/tmp"), "a/b", "x/SKILL.md").is_err());
        std::env::remove_var("KULA_NO_NET");
        assert!(folder_import(Path::new("/tmp"), "a/b", "x/other.md").is_err());
        assert!(folder_import(Path::new("/tmp"), "a/b", "x/../y/SKILL.md").is_err());
    }

    #[test]
    fn finds_tencent_memory() {
        let t = std::env::temp_dir().join(format!("kula-tdb-{}", std::process::id()));
        let m = t.join("AGENTS/.memory");
        std::fs::create_dir_all(m.join("wiki")).unwrap();
        std::fs::write(
            m.join("memories.json"),
            r#"[{"id":"m1","type":"constraint","category":"scope","content":"No service endpoint.","source_agent":"team"}]"#,
        )
        .unwrap();
        std::fs::write(m.join("wiki/architecture.md"), "# Architecture\n").unwrap();
        std::fs::write(t.join(".mcp.json"), r#"{"mcpServers":{"tencentdb-memory":{}}}"#).unwrap();
        let s = sources(&t);
        assert_eq!((s.len(), s[0].dir.as_str(), s[0].memories, s[0].mcp), (1, "AGENTS", 1, true));
        let got = tencent_memories(&t, "AGENTS").unwrap();
        assert_eq!(got[0], ("[constraint/scope] No service endpoint.".into(), "tencentdb:team".into()));
        assert!(got[1].0.contains("AGENTS/.memory/wiki/architecture.md"));
        assert!(tencent_memories(&t, "nope").is_err());
        std::fs::remove_dir_all(&t).ok();
    }
}
