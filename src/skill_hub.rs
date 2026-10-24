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

use anyhow::{bail, Context, Result};
use serde::Serialize;
use serde_json::Value;
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
    let out = Command::new("gh").args(args).output().context("gh is not installed – brew install gh, then gh auth login")?;
    if !out.status.success() {
        bail!("{}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
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

/// Fetch `repo`'s SKILL.md at `path`: (name, description, body).
pub fn fetch(repo: &str, path: &str) -> Result<(String, String, String)> {
    if offline() {
        bail!("GitHub is off (KULA_NO_NET)");
    }
    let ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_./".contains(c)) && !s.contains("..");
    if !ok(repo) || !ok(path) || !path.ends_with("SKILL.md") {
        bail!("not a GitHub SKILL.md: {repo} {path}");
    }
    let src = gh(&["api", &format!("repos/{repo}/contents/{path}"), "-H", "Accept: application/vnd.github.raw"])?;
    let (meta, body) = split_front(&src);
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
    Ok((name, desc, body.trim().to_string()))
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
        if d.join(".memory/memories.json").is_file() {
            out.push(top);
        }
    }
    out
}

fn mcp_named(root: &Path) -> bool {
    std::fs::read_to_string(root.join(".mcp.json")).is_ok_and(|s| s.to_lowercase().contains("tencentdb"))
}

fn atomic(dir: &Path) -> Vec<Value> {
    std::fs::read_to_string(dir.join(".memory/memories.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<Value>>(&s).ok())
        .unwrap_or_default()
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
