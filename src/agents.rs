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
    /// The agent's own docs for MCP and hooks.
    pub docs: &'static str,
    /// Workflows installed as this agent's own agent files (`kula workflow install`).
    pub workflows: Vec<String>,
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
            Connection { id, name, docs: docs_url(id), workflows: installed(root, id), mcp, hook, files: f }
        })
        .collect()
}

pub fn docs_url(id: &str) -> &'static str {
    match id {
        "claude" => "https://docs.anthropic.com/en/docs/claude-code/hooks",
        "cursor" => "https://docs.cursor.com/en/agent/hooks",
        "codex" => "https://developers.openai.com/codex/",
        "gemini" => "https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/index.md",
        _ => "https://modelcontextprotocol.io",
    }
}

/// claude-code, Claude, agent:claude-code → claude; the same for cursor, codex and gemini.
pub fn agent_id(s: &str) -> String {
    let s = s.trim().trim_start_matches("agent:").to_lowercase();
    for id in ["claude", "cursor", "codex", "gemini"] {
        if s.starts_with(id) {
            return id.into();
        }
    }
    s
}

/// The agent running this process, from the environment each one sets for its shell.
pub fn agent_from_env() -> Option<String> {
    let has = |k: &str| std::env::var_os(k).is_some_and(|v| !v.is_empty());
    if let Ok(a) = std::env::var("KULA_AGENT") {
        if !a.is_empty() {
            return Some(agent_id(&a));
        }
    }
    [
        ("CLAUDECODE", "claude"),
        ("CURSOR_AGENT", "cursor"),
        ("CODEX_SANDBOX", "codex"),
        ("CODEX_SANDBOX_NETWORK_DISABLED", "codex"),
        ("GEMINI_CLI", "gemini"),
    ]
    .iter()
    .find(|(k, _)| has(k))
    .map(|(_, id)| id.to_string())
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

/// Put kula's guard in a hook list – replacing an older kula entry, keeping everyone else's.
fn add_hook(l: &mut Vec<Value>, entry: Value) {
    let marker = entry.to_string().contains("--read");
    match l.iter_mut().find(|e| e.to_string().contains("kula guard hook") && e.to_string().contains("--read") == marker) {
        Some(e) => *e = entry,
        None => l.push(entry),
    }
}

fn mcp_server(m: &mut serde_json::Map<String, Value>) -> Result<()> {
    obj(m, "mcpServers")?.insert("kula".into(), json!({ "command": "kula", "args": ["mcp"] }));
    Ok(())
}

/// Wire an agent up to kula; returns the files written.
pub fn connect(root: &Path, id: &str) -> Result<Vec<&'static str>> {
    let files = connect_files(root, id)?;
    crate::config::default_agent_if_unset(root, id)?;
    Ok(files)
}

fn connect_files(root: &Path, id: &str) -> Result<Vec<&'static str>> {
    let p = |f: &str| root.join(f);
    match id {
        // Claude Code: .mcp.json, and a PreToolUse hook (exit 2 blocks, stderr goes to the agent).
        "claude" => {
            merge_json(&p(".mcp.json"), mcp_server)?;
            merge_json(&p(".claude/settings.json"), |m| {
                add_hook(
                    list(obj(m, "hooks")?, "PreToolUse")?,
                    json!({ "matcher": "Edit|MultiEdit|Write|NotebookEdit|Read|Bash", "hooks": [{ "type": "command", "command": "kula guard hook" }] }),
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
                add_hook(list(h, "beforeShellExecution")?, json!({ "command": "kula guard hook --agent cursor" }));
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
                    json!({ "matcher": "apply_patch|Edit|Write|shell|exec_command|local_shell", "hooks": [{ "type": "command", "command": "kula guard hook --agent codex" }] }),
                );
                Ok(())
            })?;
        }
        // Gemini CLI: one settings file holds both.
        "gemini" => merge_json(&p(".gemini/settings.json"), |m| {
            mcp_server(m)?;
            add_hook(
                list(obj(m, "hooks")?, "BeforeTool")?,
                json!({ "matcher": "write_file|replace|read_file|read_many_files|run_shell_command", "hooks": [{ "type": "command", "command": "kula guard hook --agent gemini", "name": "kula-guard" }] }),
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

// ------------------------------------------------------------------ workflows as each agent's own

/// Where a workflow lives as an agent's native file: a Claude Code subagent,
/// a Cursor rule, a Gemini CLI command (`/kula:<name>`).
fn agent_file(id: &str, name: &str) -> Option<String> {
    match id {
        "claude" => Some(format!(".claude/agents/kula-{name}.md")),
        "cursor" => Some(format!(".cursor/rules/kula-{name}.mdc")),
        "gemini" => Some(format!(".gemini/commands/kula/{name}.toml")),
        _ => None,
    }
}

/// Workflows installed for an agent.
fn installed(root: &Path, id: &str) -> Vec<String> {
    let (dir, pre, ext) = match id {
        "claude" => (".claude/agents", "kula-", ".md"),
        "cursor" => (".cursor/rules", "kula-", ".mdc"),
        "gemini" => (".gemini/commands/kula", "", ".toml"),
        _ => return vec![],
    };
    let mut out: Vec<String> = std::fs::read_dir(root.join(dir))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.file_name().to_str()?.strip_prefix(pre)?.strip_suffix(ext).map(String::from))
        .collect();
    out.sort();
    out
}

/// A workflow as instructions any agent can follow – the same fences kula enforces, in words.
pub fn workflow_prompt(w: &Workflow) -> String {
    let mut s = format!(
        "You are working in the **{}** workflow of this repository. kula enforces it.\n\n{}\n\n\
         Start by declaring the task: call kula's `start_task` MCP tool with workflow \"{}\" \
         (or have the user run `kula task start \"<title>\" -w {}`). From then on kula's hooks hold you to:\n\n",
        w.name, w.about, w.name, w.name
    );
    if !w.prompt.trim().is_empty() {
        s.push_str(&format!("{}\n\n", w.prompt.trim()));
    }
    let row = |s: &mut String, k: &str, v: &[String]| {
        if !v.is_empty() {
            s.push_str(&format!("- **{k}**: {}\n", v.join(", ")));
        }
    };
    row(&mut s, "scope (you may change only this)", &w.scope);
    row(&mut s, "locked (read, never edit)", &w.lock);
    row(&mut s, "hidden (never shown)", &w.hide);
    row(&mut s, "review (editable, a person checks)", &w.review);
    s.push_str(&format!(
        "- **memory**: {}\n",
        match w.memory_policy() {
            "read" => "recall only",
            "off" => "off",
            _ => "recall and remember",
        }
    ));
    if !w.steps.is_empty() {
        s.push_str("\nSteps:\n\n");
        for (i, st) in w.steps.iter().enumerate() {
            s.push_str(&format!("{}. {st}\n", i + 1));
        }
    }
    if !w.docs.is_empty() {
        s.push_str(&format!("\nRead first: {}\n", w.docs.join(", ")));
    }
    if let Some(r) = &w.research {
        s.push_str(&format!(
            "\nThis is an autoresearch loop. The metric is `{}` – {} is better{}. Call `research` for the baseline, \
             the best so far and every experiment tried; change only files in scope; then call `experiment` with a \
             one-line hypothesis. kula runs the metric itself, commits the change if it is better and reverts it if \
             not. Never edit the metric or what it reads.\n",
            r.metric,
            if r.minimise() { "lower" } else { "higher" },
            if r.budget > 0 { format!(", budget {} experiments", r.budget) } else { String::new() }
        ));
    }
    s.push_str(
        "\nFences are enforced, not advice: an edit, a read or a shell command that touches fenced code is refused \
         with the reason. Don't work around it – `suggest` a change to the fence, or ask the user.\n",
    );
    s
}

/// One member's full instructions in a team: the team's prompt, its own, where it
/// sits (who it answers to, who answers to it, who it hands off to), then its workflow.
pub fn team_prompt(cfg: &Config, team: &crate::config::Team, m: &crate::config::Member) -> String {
    let mut s = format!("# {} in team {}\n\n", m.key(), team.name);
    if !team.about.is_empty() {
        s.push_str(&format!("{}\n\n", team.about));
    }
    if !team.prompt.trim().is_empty() {
        s.push_str(&format!("{}\n\n", team.prompt.trim()));
    }
    if !m.role.is_empty() {
        s.push_str(&format!("Your role: {}.\n\n", m.role));
    }
    if !m.prompt.trim().is_empty() {
        s.push_str(&format!("{}\n\n", m.prompt.trim()));
    }
    let reports: Vec<&str> = team.members.iter().filter(|x| x.reports_to == m.key()).map(|x| x.key()).collect();
    let mut place = vec![];
    let lead =
        |t: &crate::config::Team| t.members.iter().find(|x| x.reports_to.is_empty()).map(|x| x.key().to_string()).unwrap_or_default();
    if m.reports_to.is_empty() {
        place.push("You lead this team.".to_string());
        if let Some(up) = cfg.teams.iter().find(|x| !team.under.is_empty() && x.name == team.under) {
            place.push(format!(
                "Your team answers to team {}{}: report to its lead when your team's work is done.",
                up.name,
                Some(lead(up)).filter(|l| !l.is_empty()).map(|l| format!(", led by {l}")).unwrap_or_default()
            ));
        }
        let below: Vec<String> =
            cfg.teams.iter().filter(|x| x.under == team.name).map(|x| format!("{} (led by {})", x.name, lead(x))).collect();
        if !below.is_empty() {
            place.push(format!(
                "Team{} {} answer{} to yours: give them goals, not steps.",
                if below.len() == 1 { "" } else { "s" },
                below.join(" and "),
                if below.len() == 1 { "s" } else { "" }
            ));
        }
    } else {
        place.push(format!("You answer to {}.", m.reports_to));
    }
    if !reports.is_empty() {
        place.push(format!("{} answer{} to you.", reports.join(" and "), if reports.len() == 1 { "s" } else { "" }));
    }
    if !m.hands_off.is_empty() {
        place.push(format!("When your part is done, hand it to {} – say what changed and what to check.", m.hands_off.join(" and ")));
    }
    let from: Vec<&str> = team.members.iter().filter(|x| x.hands_off.iter().any(|h| h == m.key())).map(|x| x.key()).collect();
    if !from.is_empty() {
        place.push(format!("{} hand{} work to you.", from.join(" and "), if from.len() == 1 { "s" } else { "" }));
    }
    s.push_str(&place.join(" "));
    s.push_str("\n\n");
    match (!m.workflow.is_empty()).then(|| workflow::find(cfg, &m.workflow)).flatten() {
        Some(w) => s.push_str(&workflow_prompt(&w)),
        None => s.push_str("You have no workflow of your own: kula.toml's fences apply.\n"),
    }
    s
}

/// Write a workflow as each agent's own agent file; returns the files written.
pub fn install_workflow(root: &Path, cfg: &Config, name: &str, ids: &[&str]) -> Result<Vec<String>> {
    let Some(w) = workflow::find(cfg, name) else { bail!("no workflow called {name}") };
    let body = workflow_prompt(&w);
    let desc = format!("{} – the {} workflow, fenced by kula", w.about, w.name);
    let mut out = vec![];
    for id in ids {
        let Some(rel) = agent_file(id, &w.name) else { continue };
        let text = match *id {
            "claude" => format!("---\nname: kula-{}\ndescription: {}\n---\n\n{body}", w.name, desc),
            "cursor" => format!("---\ndescription: {}\nalwaysApply: false\n---\n\n{body}", desc),
            _ => format!("description = {:?}\nprompt = \"\"\"\n{}\n{{{{args}}}}\n\"\"\"\n", desc, body.replace("\"\"\"", "\"\" \"")),
        };
        let p = root.join(&rel);
        std::fs::create_dir_all(p.parent().unwrap())?;
        std::fs::write(&p, text)?;
        out.push(rel);
    }
    Ok(out)
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

// ------------------------------------------------------------------ what a tool call touches

#[derive(Debug, Clone, PartialEq)]
pub struct Target {
    pub path: String,
    pub write: bool,
}

/// Everything a hooked tool call would touch: files it reads or writes – from
/// a file tool, a patch, or a shell command – and, for a command that would
/// switch kula's fences off, why it is refused outright.
#[derive(Debug, Default)]
pub struct Call {
    pub targets: Vec<Target>,
    pub tamper: Option<String>,
}

const SHELL_TOOLS: &[&str] =
    &["Bash", "bash", "shell", "Shell", "exec_command", "local_shell", "run_shell_command", "run_terminal_cmd", "terminal"];

pub fn hook_call(v: &Value) -> Call {
    let ti = &v["tool_input"];
    let shell =
        SHELL_TOOLS.contains(&v["tool_name"].as_str().unwrap_or("")) || v["hook_event_name"].as_str() == Some("beforeShellExecution");
    let text = |x: &Value| match x {
        Value::String(s) => Some(s.clone()),
        // ["bash", "-lc", "<script>"]: the script is what runs
        Value::Array(a) => {
            let parts: Vec<&str> = a.iter().filter_map(|x| x.as_str()).collect();
            Some(match parts.as_slice() {
                [sh, flag, script, ..] if sh.ends_with("sh") && flag.starts_with('-') => script.to_string(),
                _ => parts.join(" "),
            })
        }
        _ => None,
    };
    let cmd = text(&ti["command"]).or_else(|| text(&v["command"])).unwrap_or_default();
    if shell && !cmd.contains("*** Begin Patch") {
        let cwd = v["cwd"].as_str().unwrap_or("");
        let (mut targets, tamper) = shell_targets(&cmd);
        for t in &mut targets {
            if !cwd.is_empty() && !t.path.starts_with('/') && !t.path.starts_with('~') {
                t.path = format!("{}/{}", cwd.trim_end_matches('/'), t.path);
            }
        }
        return Call { targets, tamper };
    }
    let write = !hook_reads(v);
    Call { targets: hook_paths(v).into_iter().map(|path| Target { path, write }).collect(), tamper: None }
}

#[derive(Debug, PartialEq)]
enum Tok {
    W(String),
    Op(String),
}

/// Split a shell command into words and operators, honouring quotes.
fn tokens(cmd: &str) -> Vec<Tok> {
    let mut out = vec![];
    let mut w = String::new();
    let mut quoted = false;
    let mut it = cmd.chars().peekable();
    let push = |w: &mut String, quoted: &mut bool, out: &mut Vec<Tok>| {
        if !w.is_empty() || *quoted {
            out.push(Tok::W(std::mem::take(w)));
        }
        *quoted = false;
    };
    while let Some(c) = it.next() {
        match c {
            '\'' | '"' => {
                quoted = true;
                for d in it.by_ref() {
                    if d == c {
                        break;
                    }
                    w.push(d);
                }
            }
            '\\' => {
                if let Some(d) = it.next() {
                    w.push(d);
                }
            }
            ' ' | '\t' => push(&mut w, &mut quoted, &mut out),
            ';' | '\n' | '(' | ')' => {
                push(&mut w, &mut quoted, &mut out);
                out.push(Tok::Op(";".into()));
            }
            '|' | '&' => {
                // `2>&1` and `&>` are redirections, not separators
                if c == '&' && w.ends_with('>') {
                    w.push(c);
                    continue;
                }
                push(&mut w, &mut quoted, &mut out);
                if it.peek() == Some(&c) {
                    it.next();
                }
                if c == '&' && it.peek() == Some(&'>') {
                    it.next();
                    if it.peek() == Some(&'>') {
                        it.next();
                    }
                    out.push(Tok::Op(">".into()));
                    continue;
                }
                out.push(Tok::Op(";".into()));
            }
            '>' | '<' => {
                // a bare fd number in front belongs to the redirection
                if w.chars().all(|d| d.is_ascii_digit()) && !quoted {
                    w.clear();
                }
                push(&mut w, &mut quoted, &mut out);
                let mut op = c.to_string();
                while matches!(it.peek(), Some('>') | Some('|')) {
                    op.push(it.next().unwrap());
                }
                if it.peek() == Some(&'&') {
                    // >&2: to another descriptor, not a file
                    it.next();
                    while it.peek().is_some_and(|d| d.is_ascii_digit() || *d == '-') {
                        it.next();
                    }
                    continue;
                }
                out.push(Tok::Op(if c == '<' { "<".into() } else { ">".into() }));
            }
            _ => w.push(c),
        }
    }
    push(&mut w, &mut quoted, &mut out);
    out
}

/// Files a shell command reads and writes, and whether it would turn kula off.
pub fn shell_targets(cmd: &str) -> (Vec<Target>, Option<String>) {
    let mut out = vec![];
    let mut tamper = None;
    let toks = tokens(cmd);
    let mut i = 0;
    let looks_like_path =
        |s: &str| !s.is_empty() && !s.starts_with('-') && !s.contains("://") && (s.contains('/') || s.contains('.')) && s.len() < 400;
    while i < toks.len() {
        // one simple command: words up to the next separator, redirections pulled out
        let mut words: Vec<String> = vec![];
        while i < toks.len() {
            match &toks[i] {
                Tok::Op(o) if o == ";" => {
                    i += 1;
                    break;
                }
                Tok::Op(o) => {
                    if let Some(Tok::W(t)) = toks.get(i + 1) {
                        if t != "/dev/null" && !t.starts_with("/dev/") {
                            out.push(Target { path: t.clone(), write: o == ">" });
                        }
                        i += 1;
                    }
                    i += 1;
                }
                Tok::W(w) => {
                    words.push(w.clone());
                    i += 1;
                }
            }
        }
        // past env assignments and wrappers to the real command
        let mut k = 0;
        while k < words.len() {
            let w = &words[k];
            let assign = w.contains('=') && w.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') && !w.contains('/');
            if assign || matches!(w.as_str(), "sudo" | "command" | "env" | "nohup" | "time" | "exec" | "xargs" | "doas" | "nice") {
                k += 1;
            } else {
                break;
            }
        }
        let Some(name) = words.get(k).map(|w| w.rsplit('/').next().unwrap_or(w).to_string()) else { continue };
        let args: Vec<&str> = words[k + 1..].iter().map(String::as_str).collect();
        // an empty word is an option's value (`sed -i ''`), never a file
        let plain: Vec<&str> = args.iter().copied().filter(|a| !a.is_empty() && !a.starts_with('-') && *a != "--").collect();
        let has =
            |f: &str| args.iter().any(|a| *a == f || (f.len() == 2 && a.starts_with('-') && !a.starts_with("--") && a.contains(&f[1..])));
        let write = |p: &str, out: &mut Vec<Target>| out.push(Target { path: p.to_string(), write: true });
        match name.as_str() {
            "kula" => {
                let sub = plain.first().copied().unwrap_or("");
                let next = plain.get(1).copied().unwrap_or("");
                let off = match sub {
                    "task" | "team" => next != "show" && next != "list" && !next.is_empty(),
                    "agents" => matches!(next, "accept" | "dismiss" | "connect"),
                    "hooks" => next == "uninstall",
                    "research" => matches!(next, "init" | "stop"),
                    _ => false,
                };
                if off {
                    tamper =
                        Some(format!("`kula {sub} {next}` changes the fences agents work under – a person runs it (agents can `suggest`)"));
                }
            }
            "git" => {
                let sub = plain.first().copied().unwrap_or("");
                if sub == "commit"
                    && (args.contains(&"--no-verify") || args.iter().any(|a| a.starts_with('-') && !a.starts_with("--") && a.contains('n')))
                {
                    tamper = Some("`git commit --no-verify` skips kula's pre-commit fence check".into());
                }
                if sub == "config" && args.iter().any(|a| a.contains("hooksPath")) {
                    tamper = Some("changing core.hooksPath would switch kula's git hooks off".into());
                }
                if matches!(sub, "rm" | "mv" | "checkout" | "restore" | "clean") {
                    plain.iter().skip(1).filter(|a| looks_like_path(a)).for_each(|a| write(a, &mut out));
                }
            }
            "rm" | "rmdir" | "mv" | "touch" | "truncate" | "chmod" | "chown" | "chgrp" | "unlink" | "shred" | "mkdir" => {
                let skip = usize::from(matches!(name.as_str(), "chmod" | "chown" | "chgrp"));
                plain.iter().skip(skip).for_each(|a| write(a, &mut out));
            }
            "cp" | "install" | "ln" | "rsync" => {
                if let Some(last) = plain.last() {
                    write(last, &mut out);
                }
                plain[..plain.len().saturating_sub(1)]
                    .iter()
                    .filter(|a| looks_like_path(a))
                    .for_each(|a| out.push(Target { path: a.to_string(), write: false }));
            }
            "tee" => plain.iter().for_each(|a| write(a, &mut out)),
            "dd" => args.iter().filter_map(|a| a.strip_prefix("of=")).for_each(|a| write(a, &mut out)),
            "sed" | "perl" | "ruby" if has("-i") || args.iter().any(|a| a.starts_with("-i") || a.starts_with("-pi")) => {
                // the script is the word after -e (or -f), else the first plain word
                let scripts: Vec<&str> = args.windows(2).filter(|w| matches!(w[0], "-e" | "-f" | "--expression")).map(|w| w[1]).collect();
                let skip = usize::from(scripts.is_empty());
                plain.iter().filter(|a| !scripts.contains(a)).skip(skip).filter(|a| looks_like_path(a)).for_each(|a| write(a, &mut out));
            }
            // an inline script (`python -c`, `node -e`, `sh -c`) can write anything it names:
            // every path in it counts as a write
            "python" | "python3" | "node" | "deno" | "bun" | "ruby" | "perl" | "php" | "sh" | "bash" | "zsh" | "osascript"
                if args.iter().any(|a| matches!(*a, "-c" | "-e" | "--eval" | "-r")) =>
            {
                args.windows(2)
                    .filter(|w| matches!(w[0], "-c" | "-e" | "--eval" | "-r"))
                    .flat_map(|w| w[1].split(|c: char| !(c.is_ascii_alphanumeric() || "_./-".contains(c))))
                    .filter(|a| {
                        looks_like_path(a)
                            && a.chars().any(|c| c.is_ascii_alphabetic())
                            && (!a.starts_with('.') || a.starts_with("./") || a.starts_with("../"))
                    })
                    .for_each(|a| write(a, &mut out));
            }
            _ => plain.iter().filter(|a| looks_like_path(a)).for_each(|a| out.push(Target { path: a.to_string(), write: false })),
        }
    }
    (out, tamper)
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
        ("an autoresearch loop", "`research` · `experiment`", "`kula research status` · `kula research try \"<hypothesis>\"`"),
    ] {
        s.push_str(&format!("| {w} | {t} | {c} |\n"));
    }
    s.push_str("\n### Fences\n\n");
    s.push_str("**locked** code may be read, never edited. **hidden** code must not be opened. **review** code may be edited; a person reviews it. ");
    s.push_str("An active task (`kula task show`) makes everything outside its scope read only. ");
    s.push_str("These are enforced, not advice: kula's pre-tool hook refuses fenced edits, reads and shell commands, its pre-commit hook refuses an agent's commit of fenced changes, and kula's own config (`kula.toml`, `.kula/`, the agent hooks) is never an agent's to change – `suggest` instead.");
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
    if !cfg.teams.is_empty() {
        s.push_str("\n### Teams\n\nWhile a team is at work (`kula team start <name>`), each agent works in its own workflow:\n\n");
        s.push_str("| team | agent | workflow | role |\n|---|---|---|---|\n");
        for t in &cfg.teams {
            for m in &t.members {
                s.push_str(&format!(
                    "| `{}` | {} | {} | {} |\n",
                    t.name,
                    {
                        let on = match (m.provider(&cfg.agents.default), m.model.as_str()) {
                            (p, "") => p.to_string(),
                            (p, model) => format!("{p}, {model}"),
                        };
                        if m.name.is_empty() { on } else { format!("{} ({on})", m.name) }
                    },
                    if m.workflow.is_empty() { "–" } else { &m.workflow },
                    m.role.replace('|', "/")
                ));
            }
        }
    }
    s.push_str("\nNo hooks in your harness? Run under `kula run -w <workflow> -- <your agent>`: fenced files are held for the run and anything fenced it changes is put back.\n");
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
    fn shell_commands_name_the_files_they_write() {
        let w = |c: &str| shell_targets(c).0.into_iter().filter(|t| t.write).map(|t| t.path).collect::<Vec<_>>();
        assert_eq!(w("sed -i '' 's/a/b/' src/store.rs"), ["src/store.rs"]);
        assert_eq!(w("sed -i.bak -e 's/a/b/' src/x.rs src/y.rs"), ["src/x.rs", "src/y.rs"]);
        assert_eq!(w("echo hi > out.txt 2>&1"), ["out.txt"]);
        assert_eq!(w("cp a.rs b.rs && rm -rf build/"), ["b.rs", "build/"]);
        assert_eq!(w(r#"python3 -c "open('src/crypto.py','w').write('x')""#), ["src/crypto.py"]);
        assert_eq!(w("node -e \"require('fs').writeFileSync('a.json', '')\""), ["a.json"]);
        assert!(shell_targets("git commit --no-verify -m x").1.is_some());
        assert!(shell_targets("kula task show").1.is_none());
    }

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
