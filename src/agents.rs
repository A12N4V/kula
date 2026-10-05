//! Bringing any agent to kula: connecting it (MCP server + pre-edit hook, in
//! each tool's own config format), the instruction files every agent reads
//! (AGENTS.md, CLAUDE.md, …) with a generated brief kept in sync with
//! kula.toml, and suggestions agents make for new fences and workflows.
//!
//! Agents may *suggest* a fence or a workflow; only a person turns a
//! suggestion into kula.toml. An agent that could loosen its own fences
//! would not be fenced.

use crate::config::{self, Config, GuardRule};
use crate::git::Repo;
use crate::workflow::{self, Workflow};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Component, Path};

// ------------------------------------------------------------------ connect

/// The agents kula writes config for. Anything else speaks MCP (`kula mcp`)
/// and reads AGENTS.md.
pub const AGENTS: &[(&str, &str)] = &[("claude", "Claude Code"), ("cursor", "Cursor"), ("codex", "Codex"), ("gemini", "Gemini CLI")];

#[derive(Serialize, Clone, Debug)]
pub struct Connection {
    pub id: &'static str,
    pub name: &'static str,
    /// The MCP server is registered.
    pub mcp: bool,
    /// The pre-edit guard hook is installed.
    pub hook: bool,
    /// The files that wire it up.
    pub files: Vec<&'static str>,
}

fn files_for(id: &str) -> Vec<&'static str> {
    match id {
        "claude" => vec![".mcp.json", ".claude/settings.json"],
        "cursor" => vec![".cursor/mcp.json", ".cursor/hooks.json"],
        "codex" => vec![".codex/config.toml", ".codex/hooks.json"],
        "gemini" => vec![".gemini/settings.json"],
        _ => vec![],
    }
}

pub fn connections(root: &Path) -> Vec<Connection> {
    let read = |p: &str| std::fs::read_to_string(root.join(p)).unwrap_or_default();
    AGENTS
        .iter()
        .map(|&(id, name)| {
            let f = files_for(id);
            let (mcp, hook) = match id {
                "codex" => (read(f[0]).contains("[mcp_servers.kula]"), read(f[1]).contains("kula guard hook")),
                "gemini" => {
                    let s = read(f[0]);
                    (s.contains("\"kula\""), s.contains("kula guard hook"))
                }
                _ => (read(f[0]).contains("\"kula\""), read(f[1]).contains("kula guard hook")),
            };
            Connection { id, name, mcp, hook, files: f }
        })
        .collect()
}

/// Read a JSON config, change it, write it back – every other key left alone.
fn merge_json(path: &Path, f: impl FnOnce(&mut serde_json::Map<String, Value>) -> Result<()>) -> Result<()> {
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d)?;
    }
    let mut v: Value = match std::fs::read_to_string(path) {
        Ok(s) if !s.trim().is_empty() => serde_json::from_str(&s).with_context(|| format!("{} is not valid JSON", path.display()))?,
        _ => json!({}),
    };
    f(v.as_object_mut().with_context(|| format!("{} must be a JSON object", path.display()))?)?;
    std::fs::write(path, serde_json::to_string_pretty(&v)? + "\n")?;
    Ok(())
}

fn obj<'a>(m: &'a mut serde_json::Map<String, Value>, k: &str) -> Result<&'a mut serde_json::Map<String, Value>> {
    m.entry(k).or_insert_with(|| json!({})).as_object_mut().with_context(|| format!("{k} must be an object"))
}

fn list<'a>(m: &'a mut serde_json::Map<String, Value>, k: &str) -> Result<&'a mut Vec<Value>> {
    m.entry(k).or_insert_with(|| json!([])).as_array_mut().with_context(|| format!("{k} must be a list"))
}

/// Add `entry` to a hook list unless one already runs kula's guard.
fn add_hook(l: &mut Vec<Value>, entry: Value) {
    if !l.iter().any(|e| e.to_string().contains("kula guard hook")) {
        l.push(entry);
    }
}

fn mcp_server(m: &mut serde_json::Map<String, Value>) -> Result<()> {
    obj(m, "mcpServers")?.insert("kula".into(), json!({ "command": "kula", "args": ["mcp"] }));
    Ok(())
}

/// Wire an agent up to kula; returns the files written.
pub fn connect(root: &Path, id: &str) -> Result<Vec<&'static str>> {
    let p = |f: &str| root.join(f);
    match id {
        // Claude Code: .mcp.json, and a PreToolUse hook (exit 2 blocks, stderr goes to the agent).
        "claude" => {
            merge_json(&p(".mcp.json"), mcp_server)?;
            merge_json(&p(".claude/settings.json"), |m| {
                add_hook(
                    list(obj(m, "hooks")?, "PreToolUse")?,
                    json!({ "matcher": "Edit|MultiEdit|Write|NotebookEdit|Read", "hooks": [{ "type": "command", "command": "kula guard hook" }] }),
                );
                Ok(())
            })?;
        }
        // Cursor: .cursor/mcp.json, and hooks.json – preToolUse for edits, beforeReadFile for reads.
        "cursor" => {
            merge_json(&p(".cursor/mcp.json"), mcp_server)?;
            merge_json(&p(".cursor/hooks.json"), |m| {
                m.entry("version").or_insert(json!(1));
                let h = obj(m, "hooks")?;
                add_hook(list(h, "preToolUse")?, json!({ "command": "kula guard hook --agent cursor" }));
                add_hook(list(h, "beforeReadFile")?, json!({ "command": "kula guard hook --agent cursor --read" }));
                Ok(())
            })?;
        }
        // Codex: [mcp_servers.kula] in .codex/config.toml, and a PreToolUse hook on apply_patch.
        "codex" => {
            let cp = p(".codex/config.toml");
            std::fs::create_dir_all(cp.parent().unwrap())?;
            let mut doc: toml_edit::DocumentMut = std::fs::read_to_string(&cp).unwrap_or_default().parse().context(".codex/config.toml")?;
            let servers = doc.entry("mcp_servers").or_insert(toml_edit::table());
            if let Some(t) = servers.as_table_mut() {
                t.set_implicit(true);
                let mut k = toml_edit::Table::new();
                k["command"] = toml_edit::value("kula");
                k["args"] = toml_edit::value(["mcp"].into_iter().collect::<toml_edit::Array>());
                t.insert("kula", toml_edit::Item::Table(k));
            }
            std::fs::write(&cp, doc.to_string())?;
            merge_json(&p(".codex/hooks.json"), |m| {
                add_hook(
                    list(obj(m, "hooks")?, "PreToolUse")?,
                    json!({ "matcher": "apply_patch|Edit|Write", "hooks": [{ "type": "command", "command": "kula guard hook --agent codex" }] }),
                );
                Ok(())
            })?;
        }
        // Gemini CLI: one settings file holds both.
        "gemini" => merge_json(&p(".gemini/settings.json"), |m| {
            mcp_server(m)?;
            add_hook(
                list(obj(m, "hooks")?, "BeforeTool")?,
                json!({ "matcher": "write_file|replace|read_file|read_many_files", "hooks": [{ "type": "command", "command": "kula guard hook --agent gemini", "name": "kula-guard" }] }),
            );
            Ok(())
        })?,
        other => bail!(
            "kula can connect {}; any other agent can run `kula mcp` and read AGENTS.md (not {other})",
            AGENTS.iter().map(|a| a.0).collect::<Vec<_>>().join(", ")
        ),
    }
    Ok(files_for(id))
}

/// Agents whose config directory is already in the repository.
pub fn detected(root: &Path) -> Vec<&'static str> {
    let mut out = vec!["claude"];
    for (id, dir) in [("cursor", ".cursor"), ("codex", ".codex"), ("gemini", ".gemini")] {
        if root.join(dir).is_dir() {
            out.push(id);
        }
    }
    out
}

/// Paths a tool call touches, from any of the hook payloads kula understands:
/// Claude Code, Cursor and Gemini send a file path; Codex sends a patch.
pub fn hook_paths(v: &Value) -> Vec<String> {
    let ti = &v["tool_input"];
    for k in ["file_path", "notebook_path", "path", "absolute_path"] {
        if let Some(p) = ti[k].as_str().or_else(|| v[k].as_str()) {
            return vec![p.to_string()];
        }
    }
    if let Some(ps) = ti["paths"].as_array() {
        return ps.iter().filter_map(|p| p.as_str().map(String::from)).collect();
    }
    let patch = match &ti["command"] {
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join("\n"),
        _ => ti["input"].as_str().or_else(|| ti["patch"].as_str()).unwrap_or("").to_string(),
    };
    patch
        .lines()
        .filter_map(|l| {
            ["*** Add File: ", "*** Update File: ", "*** Delete File: ", "*** Move to: "]
                .iter()
                .find_map(|p| l.trim_start().strip_prefix(p))
                .map(|p| p.trim().to_string())
        })
        .collect()
}

/// Whether a hooked tool only reads.
pub fn hook_reads(v: &Value) -> bool {
    matches!(
        v["tool_name"].as_str().unwrap_or(""),
        "Read" | "Grep" | "Glob" | "NotebookRead" | "LS" | "View" | "read_file" | "read_many_files" | "Read File"
    ) || v["hook_event_name"].as_str() == Some("beforeReadFile")
}

// ------------------------------------------------------------------ docs

/// Instruction files agents read on their own, and who reads them.
pub const INSTRUCTIONS: &[(&str, &str)] = &[
    ("AGENTS.md", "Codex, Cursor, Copilot, Jules, Amp, Zed and most others"),
    ("CLAUDE.md", "Claude Code"),
    ("GEMINI.md", "Gemini CLI"),
    (".github/copilot-instructions.md", "GitHub Copilot"),
    (".cursorrules", "Cursor (legacy)"),
];

const BEGIN: &str = "<!-- kula:begin";
const END: &str = "<!-- kula:end -->";

#[derive(Serialize, Clone, Debug)]
pub struct Doc {
    pub path: String,
    /// Who reads it: an agent, a workflow, or kula.toml's [agents] docs.
    pub readers: String,
    pub exists: bool,
    pub bytes: u64,
    /// Holds kula's generated brief.
    pub synced: bool,
    /// The brief in it matches kula.toml as it is now.
    pub current: bool,
}

/// Every doc agents are pointed at, instruction files first.
pub fn docs(repo: &Repo) -> Result<Vec<Doc>> {
    let cfg = Config::load(&repo.root)?;
    let brief = brief(&cfg);
    let mut out: Vec<Doc> = vec![];
    let mut add = |path: &str, readers: String| {
        if let Some(d) = out.iter_mut().find(|d| d.path == path) {
            if !d.readers.contains(&readers) {
                d.readers = format!("{} · {}", d.readers, readers);
            }
            return;
        }
        let full = repo.root.join(path);
        let text = std::fs::read_to_string(&full).unwrap_or_default();
        let synced = text.contains(BEGIN);
        out.push(Doc {
            path: path.into(),
            readers,
            exists: full.exists(),
            bytes: full.metadata().map(|m| m.len()).unwrap_or(0),
            synced,
            current: synced && text.contains(brief.trim()),
        });
    };
    for (p, who) in INSTRUCTIONS {
        if *p == "AGENTS.md" || repo.root.join(p).exists() {
            add(p, who.to_string());
        }
    }
    for p in &cfg.agents.docs {
        add(p, "every agent ([agents] docs)".into());
    }
    for w in workflow::all(&cfg) {
        for p in &w.docs {
            add(p, format!("the {} workflow", w.name));
        }
    }
    Ok(out)
}

/// A repository-relative path that stays inside the repository.
fn inside(path: &str) -> Result<&Path> {
    let p = Path::new(path);
    if path.is_empty() || p.is_absolute() || p.components().any(|c| !matches!(c, Component::Normal(_))) {
        bail!("{path:?} is not a path inside this repository");
    }
    if p.starts_with(".git") || p.starts_with(".kula") {
        bail!("{path} belongs to git or kula");
    }
    Ok(p)
}

pub fn doc_read(repo: &Repo, path: &str) -> Result<String> {
    Ok(std::fs::read_to_string(repo.root.join(inside(path)?)).unwrap_or_default())
}

pub fn doc_save(repo: &Repo, path: &str, text: &str) -> Result<()> {
    let full = repo.root.join(inside(path)?);
    if text.len() > 512 * 1024 {
        bail!("docs are at most 512 KB");
    }
    if let Some(d) = full.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::write(full, text)?;
    Ok(())
}

/// The block `kula agents sync` keeps in instruction files: how to work here,
/// what is fenced, and the workflows – generated from kula.toml.
pub fn brief(cfg: &Config) -> String {
    let mut s = String::new();
    s.push_str("## Working here with kula\n\n");
    s.push_str("This repository is indexed by [kula](https://github.com/A12N4V/kula), a code knowledge graph. ");
    s.push_str("Use its MCP server (`kula mcp`) when your tool speaks MCP; otherwise the same answers come from the shell.\n\n");
    s.push_str("| when | MCP tool | shell |\n|---|---|---|\n");
    for (w, t, c) in [
        ("before reading files", "`context_pack`", "`kula pack \"<task>\"`"),
        ("before changing a symbol", "`pre_edit`", "`kula before <symbol>`"),
        ("after editing", "`verify_edit`", "`kula verify`"),
        ("what you may change", "`guards`", "`kula guard list`"),
        ("facts about the code", "`recall` · `remember`", "`kula memory recall <symbol>`"),
        ("how to work on this task", "`workflows`", "`kula workflow show <name>`"),
    ] {
        s.push_str(&format!("| {w} | {t} | {c} |\n"));
    }
    s.push_str("\n### Fences\n\n");
    s.push_str("**locked** code may be read, never edited. **hidden** code must not be opened. **review** code may be edited; a person reviews it. ");
    s.push_str("An active task (`kula task show`) makes everything outside its scope read only.");
    if cfg.agents.hide_secrets {
        s.push_str(" Likely secrets (`.env`, keys, certificates) are hidden.");
    }
    s.push_str("\n\n");
    if !cfg.guards.is_empty() {
        s.push_str("| level | what | why |\n|---|---|---|\n");
        for g in &cfg.guards {
            let what = [g.paths.clone(), g.symbols.clone()].concat().iter().map(|x| format!("`{x}`")).collect::<Vec<_>>().join(", ");
            s.push_str(&format!("| {} | {} | {} |\n", g.level, what, g.reason.replace('|', "/")));
        }
        s.push('\n');
    }
    s.push_str(
        "### Workflows\n\nStart one with `kula task start \"<title>\" --workflow <name>`; its fences apply until `kula task done`.\n\n",
    );
    s.push_str("| workflow | for | fences | memory |\n|---|---|---|---|\n");
    for w in workflow::all(cfg) {
        let mut f = vec![];
        if !w.scope.is_empty() {
            f.push(format!("may change only {}", short(&w.scope)));
        }
        if !w.lock.is_empty() {
            f.push(format!("locks {}", short(&w.lock)));
        }
        if !w.hide.is_empty() {
            f.push(format!("hides {}", short(&w.hide)));
        }
        if !w.review.is_empty() {
            f.push(format!("review {}", short(&w.review)));
        }
        s.push_str(&format!(
            "| `{}` | {} | {} | {} |\n",
            w.name,
            w.about.replace('|', "/"),
            if f.is_empty() { "–".into() } else { f.join("; ") },
            w.memory_policy()
        ));
    }
    s
}

fn short(v: &[String]) -> String {
    match v {
        [one] if one == "**" => "everything".into(),
        v if v == workflow::TESTS => "tests".into(),
        v if v == workflow::DOCS => "docs".into(),
        v if v.len() > 3 => format!("{} and {} more", v[..3].iter().map(|x| format!("`{x}`")).collect::<Vec<_>>().join(", "), v.len() - 3),
        v => v.iter().map(|x| format!("`{x}`")).collect::<Vec<_>>().join(", "),
    }
}

/// Write the brief into instruction files (AGENTS.md, plus any of the others
/// that exist), replacing an earlier brief and keeping the rest of the file.
pub fn sync(repo: &Repo, only: &[String]) -> Result<Vec<String>> {
    let cfg = Config::load(&repo.root)?;
    let block =
        format!("{BEGIN} – written by `kula agents sync` from kula.toml; edit kula.toml, not this block -->\n{}{END}\n", brief(&cfg));
    let targets: Vec<String> = if only.is_empty() {
        INSTRUCTIONS
            .iter()
            .map(|x| x.0)
            .filter(|p| *p == "AGENTS.md" || (repo.root.join(p).exists() && p.ends_with(".md")))
            .map(String::from)
            .collect()
    } else {
        only.to_vec()
    };
    let mut done = vec![];
    for t in targets {
        let full = repo.root.join(inside(&t)?);
        let text = std::fs::read_to_string(&full).unwrap_or_default();
        let next = match (text.find(BEGIN), text.find(END)) {
            (Some(a), Some(b)) if b > a => format!("{}{}{}", &text[..a], block, text[b + END.len()..].trim_start_matches('\n')),
            _ if text.trim().is_empty() => format!("# Agent instructions\n\n{block}"),
            _ => format!("{}\n\n{block}", text.trim_end()),
        };
        if next != text {
            doc_save(repo, &t, &next)?;
            done.push(t);
        }
    }
    Ok(done)
}

// ------------------------------------------------------------------ suggestions

/// A fence or workflow an agent proposes; a person accepts or dismisses it.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Suggestion {
    pub id: u64,
    /// guard | workflow
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guard: Option<GuardRule>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow: Option<Workflow>,
    /// Why the agent thinks so.
    pub why: String,
    pub by: String,
    pub created: i64,
}

fn sugg_path(repo: &Repo) -> std::path::PathBuf {
    repo.kula_dir().join("suggestions.json")
}

pub fn suggestions(repo: &Repo) -> Vec<Suggestion> {
    std::fs::read_to_string(sugg_path(repo)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save_suggestions(repo: &Repo, s: &[Suggestion]) -> Result<()> {
    std::fs::create_dir_all(repo.kula_dir())?;
    std::fs::write(sugg_path(repo), serde_json::to_string_pretty(s)?)?;
    Ok(())
}

pub fn suggest(repo: &Repo, mut s: Suggestion, by: &str) -> Result<Suggestion> {
    match (s.kind.as_str(), &s.guard, &s.workflow) {
        ("guard", Some(g), _) => {
            if g.paths.is_empty() && g.symbols.is_empty() {
                bail!("a guard needs paths or symbols");
            }
            if !matches!(g.level.as_str(), "locked" | "hidden" | "review") {
                bail!("level is locked, hidden or review");
            }
        }
        ("workflow", _, Some(w)) => {
            if !workflow::valid_name(&w.name) {
                bail!("workflow names are letters, digits, - and _");
            }
        }
        _ => bail!("suggest a guard (kind=guard, guard={{paths|symbols, level, reason}}) or a workflow (kind=workflow, workflow={{name, about, …}})"),
    }
    let mut all = suggestions(repo);
    if all.len() >= 50 {
        bail!("50 suggestions are already waiting for a person");
    }
    s.id = all.iter().map(|x| x.id).max().unwrap_or(0) + 1;
    s.by = by.into();
    s.created = crate::meta::now();
    all.push(s.clone());
    save_suggestions(repo, &all)?;
    Ok(s)
}

/// Apply a suggestion to kula.toml and drop it.
pub fn accept(repo: &Repo, id: u64) -> Result<Suggestion> {
    let mut all = suggestions(repo);
    let Some(i) = all.iter().position(|x| x.id == id) else { bail!("no suggestion #{id}") };
    let s = all.remove(i);
    let cfg = Config::load(&repo.root)?;
    match (&s.guard, &s.workflow) {
        (Some(g), _) => {
            let mut rules = cfg.guards.clone();
            rules.push(g.clone());
            config::set_guards(&repo.root, &rules)?;
        }
        (_, Some(w)) => {
            let mut wfs = cfg.workflows.clone();
            wfs.retain(|x| x.name != w.name);
            wfs.push(w.clone());
            config::set_workflows(&repo.root, &wfs)?;
        }
        _ => {}
    }
    save_suggestions(repo, &all)?;
    Ok(s)
}

pub fn dismiss(repo: &Repo, id: u64) -> Result<()> {
    let mut all = suggestions(repo);
    let before = all.len();
    all.retain(|x| x.id != id);
    if all.len() == before {
        bail!("no suggestion #{id}");
    }
    save_suggestions(repo, &all)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hook_payloads_from_every_agent() {
        let claude = json!({ "tool_name": "Edit", "tool_input": { "file_path": "/r/src/a.rs" } });
        assert_eq!(hook_paths(&claude), vec!["/r/src/a.rs"]);
        assert!(!hook_reads(&claude));
        let gemini = json!({ "hook_event_name": "BeforeTool", "tool_name": "read_file", "tool_input": { "absolute_path": "/r/x" } });
        assert_eq!(hook_paths(&gemini), vec!["/r/x"]);
        assert!(hook_reads(&gemini));
        let cursor = json!({ "hook_event_name": "beforeReadFile", "file_path": "/r/.env", "content": "" });
        assert_eq!(hook_paths(&cursor), vec!["/r/.env"]);
        assert!(hook_reads(&cursor));
        let codex = json!({ "tool_name": "apply_patch", "tool_input": { "command": "*** Begin Patch\n*** Update File: src/a.rs\n@@\n-x\n+y\n*** Add File: tests/b.rs\n+z\n*** End Patch" } });
        assert_eq!(hook_paths(&codex), vec!["src/a.rs", "tests/b.rs"]);
    }

    #[test]
    fn the_brief_names_fences_and_workflows() {
        let cfg: Config = toml::from_str("[[guard]]\npaths = [\"migrations/**\"]\nlevel = \"locked\"\nreason = \"DBA only\"\n").unwrap();
        let b = brief(&cfg);
        assert!(b.contains("`migrations/**`") && b.contains("DBA only"));
        assert!(b.contains("| `refactor` |") && b.contains("locks tests"));
        assert!(b.contains("| `explore` |") && b.contains("locks everything"));
        assert!(inside("../x").is_err() && inside("/etc/passwd").is_err() && inside(".git/config").is_err());
        assert!(inside("docs/a.md").is_ok());
    }
}
