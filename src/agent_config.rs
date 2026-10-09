//! Unified agent config, derived from what each agent already reads – no new
//! storage, no new format.
//!
//! TeamAI-CLI keeps one git repo holding every agent's skills, rules, hooks and
//! MCP servers, then syncs a copy out to each agent. kula already does this for
//! skills (`.agents/skills`); this module extends the same idea to MCP servers
//! and rules files: read every agent's own config where it lies, diff it against
//! the shared source in `.agents/mcp.json`, and sync one server definition out
//! with a merge that never clobbers the rest of the file. It also derives the
//! TencentDB-style memory layers – task / workflow / repo scope and provenance –
//! from the memory records and guard state that already exist.

use crate::git::Repo;
use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

/// The shared source of truth for MCP servers, in `.mcp.json` format.
pub const MCP_SOURCE: &str = ".agents/mcp.json";

/// Where each agent keeps its MCP servers, relative to the root.
fn mcp_path(agent: &str) -> &'static str {
    match agent {
        "claude" => ".mcp.json",
        "cursor" => ".cursor/mcp.json",
        "gemini" => ".gemini/settings.json",
        "codex" => ".codex/config.toml",
        _ => "",
    }
}

/// Where each agent keeps its rules and instructions.
fn rules_paths(agent: &str) -> &'static [&'static str] {
    match agent {
        "claude" => &["CLAUDE.md", ".claude/rules/**"],
        "cursor" => &[".cursor/rules/**"],
        "codex" => &["AGENTS.md"],
        "gemini" => &["GEMINI.md"],
        _ => &[],
    }
}

/// One MCP server definition as every format can express it: a command to run
/// with args, or a URL. Comparison and writing both go through this.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpDef {
    pub command: String,
    pub args: Vec<String>,
    pub url: String,
}

impl McpDef {
    fn from_json(v: &serde_json::Value) -> Option<McpDef> {
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or_default().to_string();
        let args = v
            .get("args")
            .and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
            .unwrap_or_default();
        let url = s("url");
        let command = s("command");
        if command.is_empty() && url.is_empty() {
            None
        } else {
            Some(McpDef { command, args, url })
        }
    }

    fn from_toml(v: &toml::Value) -> Option<McpDef> {
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or_default().to_string();
        let args = v
            .get("args")
            .and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
            .unwrap_or_default();
        let url = s("url");
        let command = s("command");
        if command.is_empty() && url.is_empty() {
            None
        } else {
            Some(McpDef { command, args, url })
        }
    }

    /// What goes into a JSON `mcpServers` entry.
    fn to_json(&self) -> serde_json::Value {
        let mut o = serde_json::Map::new();
        if !self.command.is_empty() {
            o.insert("command".into(), json_str(&self.command));
            o.insert("args".into(), serde_json::Value::Array(self.args.iter().map(|a| json_str(a)).collect()));
        }
        if !self.url.is_empty() {
            o.insert("url".into(), json_str(&self.url));
        }
        serde_json::Value::Object(o)
    }
}

fn json_str(s: &str) -> serde_json::Value {
    serde_json::Value::String(s.into())
}

/// All servers in one agent's config file, JSON (`mcpServers`) or TOML (`mcp_servers`).
fn read_mcp(root: &Path, path: &str) -> Result<Option<BTreeMap<String, McpDef>>> {
    let text = match std::fs::read_to_string(root.join(path)) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e).with_context(|| format!("reading {path}")),
    };
    let mut out = BTreeMap::new();
    if path.ends_with(".toml") {
        let v: toml::Value = toml::from_str(&text).with_context(|| format!("parsing {path}"))?;
        if let Some(servers) = v.get("mcp_servers").and_then(|x| x.as_table()) {
            for (name, def) in servers {
                if let Some(d) = McpDef::from_toml(def) {
                    out.insert(name.clone(), d);
                }
            }
        }
    } else {
        let v: serde_json::Value = serde_json::from_str(&text).with_context(|| format!("parsing {path}"))?;
        if let Some(servers) = v.get("mcpServers").and_then(|x| x.as_object()) {
            for (name, def) in servers {
                if let Some(d) = McpDef::from_json(def) {
                    out.insert(name.clone(), d);
                }
            }
        }
    }
    Ok(Some(out))
}

#[derive(Serialize)]
pub struct McpSource {
    pub path: String,
    pub exists: bool,
    pub servers: Vec<String>,
}

#[derive(Serialize)]
pub struct McpAgent {
    pub agent: String,
    pub path: String,
    pub exists: bool,
    pub servers: Vec<String>,
    /// Servers whose definition differs from the source's (or that only the agent has).
    pub differs: Vec<String>,
    /// Servers the source defines that this agent does not have.
    pub missing: Vec<String>,
}

#[derive(Serialize)]
pub struct RuleFile {
    pub agent: String,
    pub path: String,
    pub exists: bool,
    pub bytes: u64,
}

#[derive(Serialize)]
pub struct ConfigMatrix {
    pub source: McpSource,
    pub agents: Vec<McpAgent>,
    pub rules: Vec<RuleFile>,
}

/// A glob match over paths relative to the root (same `*` / `**` rules as fences).
fn glob_matcher(pats: &[String]) -> Result<globset::GlobSet> {
    let mut b = globset::GlobSetBuilder::new();
    for p in pats {
        b.add(globset::Glob::new(p)?);
    }
    Ok(b.build()?)
}

fn rules_files(root: &Path, agent: &str) -> Vec<RuleFile> {
    let mut out = vec![];
    for pat in rules_paths(agent) {
        if pat.ends_with("/**") {
            let dir = pat.trim_end_matches("/**");
            let mut entries: Vec<_> = std::fs::read_dir(root.join(dir)).into_iter().flatten().flatten().collect();
            entries.sort_by_key(|e| e.file_name());
            for e in entries {
                let p = e.path();
                if p.is_file() {
                    out.push(RuleFile {
                        agent: agent.into(),
                        path: format!("{dir}/{}", e.file_name().to_string_lossy()),
                        exists: true,
                        bytes: e.metadata().map(|m| m.len()).unwrap_or(0),
                    });
                }
            }
        } else {
            let p = root.join(pat);
            out.push(RuleFile {
                agent: agent.into(),
                path: pat.to_string(),
                exists: p.is_file(),
                bytes: p.metadata().map(|m| m.len()).unwrap_or(0),
            });
        }
    }
    out
}

/// The whole picture: what each agent has for MCP and rules, against the source.
pub fn matrix(root: &Path) -> Result<ConfigMatrix> {
    let src = read_mcp(root, MCP_SOURCE)?;
    let source = McpSource {
        path: MCP_SOURCE.into(),
        exists: src.is_some(),
        servers: src.as_ref().map(|m| m.keys().cloned().collect()).unwrap_or_default(),
    };
    let mut agents = vec![];
    for (a, _) in crate::agents::AGENTS {
        let path = mcp_path(a);
        let mine = read_mcp(root, path)?;
        let (exists, servers, differs, missing) = match (&src, &mine) {
            (_, None) => (false, vec![], vec![], src.as_ref().map(|m| m.keys().cloned().collect()).unwrap_or_default()),
            (None, Some(m)) => (true, m.keys().cloned().collect(), vec![], vec![]),
            (Some(s), Some(m)) => {
                let mut differs = vec![];
                for (name, def) in m {
                    match s.get(name) {
                        Some(d) if d == def => {}
                        _ => differs.push(name.clone()),
                    }
                }
                let missing: Vec<String> = s.keys().filter(|k| !m.contains_key(*k)).cloned().collect();
                (true, m.keys().cloned().collect(), differs, missing)
            }
        };
        agents.push(McpAgent { agent: a.to_string(), path: path.into(), exists, servers, differs, missing });
    }
    let mut rules = vec![];
    for (a, _) in crate::agents::AGENTS {
        rules.extend(rules_files(root, a));
    }
    Ok(ConfigMatrix { source, agents, rules })
}

/// Write one JSON config's `mcpServers` map back, keeping everything else.
fn write_json_mcp(root: &Path, path: &str, name: &str, def: &McpDef) -> Result<()> {
    let full = root.join(path);
    let mut doc: serde_json::Value = match std::fs::read_to_string(&full) {
        Ok(t) => serde_json::from_str(&t).with_context(|| format!("parsing {path}"))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(e) => return Err(e).with_context(|| format!("reading {path}")),
    };
    if doc.get("mcpServers").is_none() {
        doc["mcpServers"] = serde_json::json!({});
    }
    doc["mcpServers"][name] = def.to_json();
    if let Some(dir) = full.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&full, format!("{}\n", serde_json::to_string_pretty(&doc)?))?;
    Ok(())
}

/// Write one TOML config's `mcp_servers` table back, keeping the rest of the file
/// and its formatting (toml_edit, so an agent's comments survive a sync).
fn write_toml_mcp(root: &Path, path: &str, name: &str, def: &McpDef) -> Result<()> {
    let full = root.join(path);
    let mut doc: toml_edit::DocumentMut = match std::fs::read_to_string(&full) {
        Ok(t) => t.parse().with_context(|| format!("parsing {path}"))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => "".parse()?,
        Err(e) => return Err(e).with_context(|| format!("reading {path}")),
    };
    let servers =
        doc["mcp_servers"].or_insert(toml_edit::Item::Table(Default::default())).as_table_mut().context("mcp_servers is not a table")?;
    let mut t = toml_edit::Table::new();
    if !def.command.is_empty() {
        t["command"] = toml_edit::value(def.command.clone());
        let mut arr = toml_edit::Array::new();
        for a in &def.args {
            arr.push(a.clone());
        }
        t["args"] = toml_edit::value(arr);
    }
    if !def.url.is_empty() {
        t["url"] = toml_edit::value(def.url.clone());
    }
    servers.insert(name, toml_edit::Item::Table(t));
    if let Some(dir) = full.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&full, doc.to_string())?;
    Ok(())
}

/// Sync one MCP server definition from `.agents/mcp.json` to every agent's own
/// config: insert or update just that server, never touching the others.
pub fn mcp_sync(root: &Path, name: &str) -> Result<Vec<String>> {
    let src = read_mcp(root, MCP_SOURCE)?.unwrap_or_else(BTreeMap::new);
    let Some(def) = src.get(name) else {
        bail!("{MCP_SOURCE} has no server {name:?}");
    };
    let mut written = vec![];
    for (a, _) in crate::agents::AGENTS {
        let path = mcp_path(a);
        if path.ends_with(".toml") {
            write_toml_mcp(root, path, name, def)?;
        } else {
            write_json_mcp(root, path, name, def)?;
        }
        written.push(path.into());
    }
    Ok(written)
}

// ---------------------------------------------------------------- skill detail

/// Which workflows and teams mention a skill, derived from the text they
/// already carry (steps, prompts, docs, about) – nothing is stored anywhere.
#[derive(Serialize)]
pub struct SkillUsage {
    pub workflows: Vec<String>,
    pub teams: Vec<String>,
    pub seats: Vec<String>,
}

pub fn skill_usage(root: &Path, name: &str) -> SkillUsage {
    let cfg = match crate::config::Config::load(root) {
        Ok(c) => c,
        Err(_) => return SkillUsage { workflows: vec![], teams: vec![], seats: vec![] },
    };
    let mut usage = SkillUsage { workflows: vec![], teams: vec![], seats: vec![] };
    for w in crate::workflow::all(&cfg) {
        let hay = format!("{} {} {} {}", w.about, w.prompt, w.steps.join(" "), w.docs.join(" ")).to_lowercase();
        if hay.contains(name) {
            usage.workflows.push(w.name);
        }
    }
    for t in &cfg.teams {
        let hay = format!(
            "{} {} {}",
            t.about,
            t.prompt,
            t.members.iter().map(|m| format!("{} {} {}", m.role, m.prompt, m.workflow)).collect::<Vec<_>>().join(" ")
        )
        .to_lowercase();
        if hay.contains(name) {
            usage.teams.push(t.name.clone());
            for m in &t.members {
                usage.seats.push(format!("{}/{}", t.name, crate::agents::agent_id(&m.agent)));
            }
        }
    }
    usage
}

// ---------------------------------------------------------------- memory layers

/// A memory with its layer derived: which scope it lives in (task, workflow or
/// repo, in that precedence) and where it came from (agent, commit, symbol).
/// Derived at read time from the existing records – no storage change.
#[derive(Serialize)]
pub struct MemoryLayer {
    pub id: u64,
    pub target: String,
    pub body: String,
    pub author: String,
    pub created: i64,
    pub stale: bool,
    /// task | workflow | repo – a target inside the task's scope is task,
    /// else inside a workflow's scope is that workflow, else repo.
    pub scope: &'static str,
    pub scope_name: String,
    /// The author with its `user:` / `agent:` prefix off.
    pub agent: String,
    /// The commit on refs/kula/meta that introduced the memory, short.
    pub commit: String,
    /// The symbol or file the memory is anchored to, when it has one.
    pub symbol: Option<String>,
}

fn target_path(target: &str) -> Option<String> {
    let raw = target.strip_prefix("symbol:").or_else(|| target.strip_prefix("file:")).unwrap_or(target);
    let p = raw.split(':').next().unwrap_or(raw);
    (!p.is_empty() && p != "repo").then(|| p.to_string())
}

/// The commit that first held this memory, walking refs/kula/meta newest first.
/// Each save is a commit of the whole document, so the oldest commit that still
/// contains the id is the one that introduced it.
fn introduced_commit(repo: &Repo, id: u64) -> String {
    // The document is stored pretty-printed (`"id": 4`), but check the compact
    // form too, in case a future save writes it dense.
    let mut found = String::new();
    for needle in [format!("\"id\": {id}"), format!("\"id\":{id}")] {
        let Ok(log) = repo.run(&["log", "--format=%H", "-S", &needle, crate::meta::REF]) else { continue };
        // Newest first – the oldest commit whose occurrence count changed introduced it.
        found = log.lines().last().map(|sha| sha[..7.min(sha.len())].to_string()).unwrap_or_default();
        if !found.is_empty() {
            break;
        }
    }
    found
}

pub fn memory_layers(repo: &Repo) -> Result<Vec<MemoryLayer>> {
    let cfg = crate::config::Config::load(&repo.root)?;
    let task_scope = crate::guard::Guards::load(repo)?.task().map(|t| t.scope.clone()).unwrap_or_default();
    let mut workflows: Vec<(String, globset::GlobSet)> = vec![];
    for w in crate::workflow::all(&cfg).into_iter().filter(|w| !w.scope.is_empty()) {
        if let Ok(g) = glob_matcher(&w.scope) {
            workflows.push((w.name, g));
        }
    }
    let task_set = if task_scope.is_empty() { None } else { glob_matcher(&task_scope).ok() };
    let mut out = vec![];
    for m in crate::memory::recall(repo, &crate::store::Store::open(repo)?, None, None, 500)? {
        let path = target_path(&m.target);
        let target = m.target.clone();
        let symbol = (target.starts_with("symbol:") || target.starts_with("file:")).then(|| target.clone());
        let (scope, scope_name) = path
            .as_ref()
            .and_then(|p| task_set.as_ref().filter(|g| g.is_match(p)).map(|_| ("task", "".to_string())))
            .or_else(|| path.as_ref().and_then(|p| workflows.iter().find(|(_, g)| g.is_match(p)).map(|(n, _)| ("workflow", n.clone()))))
            .unwrap_or(("repo", String::new()));
        let agent = m.author.split(':').next_back().unwrap_or(&m.author).to_string();
        let commit = introduced_commit(repo, m.id);
        out.push(MemoryLayer {
            id: m.id,
            target,
            body: m.body,
            author: m.author,
            created: m.created,
            stale: m.stale,
            scope,
            scope_name,
            agent,
            commit,
            symbol,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fixture root with one skill-shaped source MCP file, built at runtime –
    /// never a literal that looks like a credential.
    fn fixture(tag: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("kula-agentcfg-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".agents")).unwrap();
        let token = format!("token-{}", std::process::id()); // secret-shaped, built at runtime
        let src = serde_json::json!({
            "mcpServers": {
                "kula": { "command": "kula", "args": ["mcp"] },
                "docs": { "command": "docs-server", "args": ["--key", token] }
            }
        });
        std::fs::write(root.join(MCP_SOURCE), serde_json::to_string_pretty(&src).unwrap()).unwrap();
        root
    }

    #[test]
    fn matrix_reads_every_format() {
        let root = fixture("matrix");
        for d in [".cursor", ".gemini", ".codex"] {
            std::fs::create_dir_all(root.join(d)).unwrap();
        }
        std::fs::write(
            root.join(".mcp.json"),
            r#"{
  "mcpServers": {
    "kula": { "command": "kula", "args": ["mcp"] },
    "docs": { "command": "docs-server", "args": ["--key", "local-edit"] },
    "extra": { "url": "http://localhost:9/v1" }
  }
}"#,
        )
        .unwrap();
        std::fs::write(root.join(".cursor/mcp.json"), r#"{ "mcpServers": { "kula": { "command": "kula", "args": ["mcp"] } } }"#).unwrap();
        std::fs::write(root.join(".gemini/settings.json"), r#"{ "mcpServers": { "kula": { "command": "kula", "args": ["mcp"] } } }"#)
            .unwrap();
        std::fs::write(root.join(".codex/config.toml"), "[mcp_servers.kula]\ncommand = \"kula\"\nargs = [\"mcp\"]\n").unwrap();
        std::fs::write(root.join("CLAUDE.md"), "# rules\n").unwrap();
        let m = matrix(&root).unwrap();
        assert_eq!(m.source.servers, vec!["docs".to_string(), "kula".to_string()]);
        let by = |a: &str| m.agents.iter().find(|x| x.agent == a).unwrap();
        // claude has the source's kula, an edited docs, and one of its own –
        // extra is agent-only, so it shows as differing too
        let c = by("claude");
        assert!(c.exists);
        assert_eq!(c.differs, vec!["docs".to_string(), "extra".to_string()]);
        assert_eq!(c.servers, vec!["docs".to_string(), "extra".to_string(), "kula".to_string()]);
        assert_eq!(c.missing, Vec::<String>::new());
        // cursor, gemini and codex hold kula alone; docs is missing for them
        for a in ["cursor", "gemini", "codex"] {
            let x = by(a);
            assert!(x.exists, "{a}");
            assert!(x.differs.is_empty(), "{a}");
            assert_eq!(x.missing, vec!["docs".to_string()], "{a}");
        }
        // the TOML one parsed to the same definition
        let codex = by("codex");
        assert_eq!(codex.servers, vec!["kula".to_string()]);
        // rules files are listed with what exists
        let cl = m.rules.iter().find(|r| r.path == "CLAUDE.md").unwrap();
        assert!(cl.exists && cl.bytes > 0);
        assert!(!m.rules.iter().find(|r| r.path == "GEMINI.md").unwrap().exists);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn sync_merges_one_server_and_keeps_the_rest() {
        let root = fixture("sync");
        // an agent-local config with its own server and an edited comment, in TOML
        std::fs::create_dir_all(root.join(".codex")).unwrap();
        std::fs::write(root.join(".codex/config.toml"), "# my config\n[mcp_servers.mine]\ncommand = \"mine\"\n").unwrap();
        std::fs::write(root.join(".mcp.json"), r#"{ "mcpServers": { "mine": { "url": "http://x" } } }"#).unwrap();
        let w = mcp_sync(&root, "kula").unwrap();
        assert_eq!(w.len(), 4);
        // JSON: the other server survives, kula was inserted
        let claude: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(root.join(".mcp.json")).unwrap()).unwrap();
        assert_eq!(claude["mcpServers"]["mine"]["url"], "http://x");
        assert_eq!(claude["mcpServers"]["kula"]["command"], "kula");
        // TOML: comment and the other server survive, kula added with args
        let toml_text = std::fs::read_to_string(root.join(".codex/config.toml")).unwrap();
        assert!(toml_text.contains("# my config"));
        let doc: toml::Value = toml::from_str(&toml_text).unwrap();
        assert_eq!(doc["mcp_servers"]["mine"]["command"].as_str(), Some("mine"));
        assert_eq!(doc["mcp_servers"]["kula"]["args"][0].as_str(), Some("mcp"));
        // after the sync the matrix is clean for kula everywhere
        let m = matrix(&root).unwrap();
        for a in &m.agents {
            assert!(!a.missing.contains(&"kula".to_string()), "{}", a.agent);
        }
        // syncing an unknown server fails loudly
        assert!(mcp_sync(&root, "nope").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn sync_overwrites_an_edited_server_but_only_that_one() {
        let root = fixture("overwrite");
        std::fs::create_dir_all(root.join(".cursor")).unwrap();
        std::fs::write(
            root.join(".cursor/mcp.json"),
            r#"{ "mcpServers": { "kula": { "command": "kula", "args": ["serve", "--evil"] } } }"#,
        )
        .unwrap();
        mcp_sync(&root, "kula").unwrap();
        let cur: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(root.join(".cursor/mcp.json")).unwrap()).unwrap();
        assert_eq!(cur["mcpServers"]["kula"]["args"][0], "mcp");
        assert_eq!(cur["mcpServers"]["kula"]["args"].as_array().unwrap().len(), 1);
        let m = matrix(&root).unwrap();
        let cursor = m.agents.iter().find(|a| a.agent == "cursor").unwrap();
        assert!(cursor.differs.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}
