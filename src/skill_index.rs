//! The skills index: every skill and instruction file an agent would load
//! here, found the way the agents themselves find them.
//!
//! A skill is a folder holding a SKILL.md (front matter `name`, `description`,
//! then instructions) – the shape both Anthropic's and OpenAI's skill repos use
//! on GitHub. Claude Code reads `.claude/skills/<name>/SKILL.md` in the repo,
//! in nested folders and in plugins (`<plugin>/skills/<name>/SKILL.md`), plus
//! `~/.claude/skills`; legacy `.claude/commands/*.md` still work. Codex reads
//! `.agents/skills` from the working folder up to the repo root, then
//! `~/.agents/skills` (`~/.codex/skills` before that) and `/etc/codex/skills`.
//! Gemini CLI mirrors Claude's layout under `.gemini/`, Cursor keeps rules as
//! `.cursor/rules/*.mdc`. Instruction files are CLAUDE.md for Claude Code,
//! AGENTS.override.md then AGENTS.md per folder for Codex, GEMINI.md for
//! Gemini, each at any depth, plus the user-wide copies.
//!
//! In-repo files are found through `git ls-files` (committed and untracked,
//! ignored files left out), so a skill anywhere in the tree is listed exactly
//! once, as it would be on GitHub.

use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    pub name: String,
    pub description: String,
    /// claude · codex · gemini · cursor · shared (`.agents/skills`, read by Codex and synced to the rest)
    pub agent: String,
    /// repo · nested · plugin · user · admin
    pub scope: String,
    /// skill · command · rule
    pub kind: String,
    /// Repo-relative, or `~/…` / absolute outside the repo.
    pub path: String,
    /// The front matter beyond name and description (allowed-tools, user-invocable, …).
    pub meta: BTreeMap<String, String>,
    /// The instructions, cut at 6 KB.
    pub body: String,
    /// Plugin name for plugin skills (`/plugin:skill`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Instruction {
    pub path: String,
    /// claude · codex · gemini
    pub agent: String,
    /// repo · nested · user
    pub scope: String,
    pub bytes: u64,
    /// The first heading or line, for the list.
    pub headline: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Index {
    pub skills: Vec<Entry>,
    pub instructions: Vec<Instruction>,
    /// Where we looked, in order, so the page can say it.
    pub searched: Vec<String>,
}

const BODY_MAX: usize = 6 * 1024;

/// The home folder to index user skills from. `KULA_SKILL_HOME` overrides it
/// (empty: skip user skills) so tests never read a real home.
fn home() -> Option<PathBuf> {
    match std::env::var_os("KULA_SKILL_HOME") {
        Some(h) if h.is_empty() => None,
        Some(h) => Some(PathBuf::from(h)),
        None => std::env::var_os("HOME").map(PathBuf::from),
    }
}

fn parse(text: &str) -> (BTreeMap<String, String>, String) {
    let t = text.replace("\r\n", "\n");
    if let Some(rest) = t.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---") {
            let mut fm = BTreeMap::new();
            for line in rest[..end].lines() {
                if line.starts_with(' ') || line.starts_with('\t') {
                    continue; // nested YAML (hooks, metadata) – listed by key only
                }
                if let Some((k, v)) = line.split_once(':') {
                    fm.insert(k.trim().to_string(), v.trim().trim_matches(['"', '\'']).to_string());
                }
            }
            let body = rest[end + 4..].trim_start_matches('\n').to_string();
            return (fm, body);
        }
    }
    (BTreeMap::new(), t)
}

fn cut(s: &str) -> String {
    if s.len() <= BODY_MAX {
        return s.to_string();
    }
    let mut i = BODY_MAX;
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    format!("{}\n…", &s[..i])
}

fn entry(text: &str, fallback: &str, agent: &str, scope: &str, kind: &str, path: String, plugin: Option<String>) -> Entry {
    let (mut fm, body) = parse(text);
    let name = fm.remove("name").filter(|n| !n.is_empty()).unwrap_or_else(|| fallback.to_string());
    let mut description = fm.remove("description").unwrap_or_default();
    if let Some(w) = fm.remove("when_to_use") {
        if !w.is_empty() {
            description = if description.is_empty() { w } else { format!("{description} {w}") };
        }
    }
    if description.is_empty() {
        description = body.lines().map(str::trim).find(|l| !l.is_empty() && !l.starts_with('#')).unwrap_or("").chars().take(160).collect();
    }
    Entry { name, description, agent: agent.into(), scope: scope.into(), kind: kind.into(), path, meta: fm, body: cut(&body), plugin }
}

/// Every file git sees in the work tree (tracked + untracked, ignores honoured).
fn repo_files(root: &Path) -> Vec<String> {
    let out = Command::new("git").arg("-C").arg(root).args(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).output();
    match out {
        Ok(o) if o.status.success() => {
            let mut v: Vec<String> =
                o.stdout.split(|b| *b == 0).filter(|s| !s.is_empty()).map(|s| String::from_utf8_lossy(s).into_owned()).collect();
            v.sort();
            v.dedup();
            v
        }
        _ => vec![],
    }
}

/// Which agent and scope a repo SKILL.md belongs to, from where it sits.
fn classify(path: &str) -> (&'static str, &'static str, Option<String>) {
    let parts: Vec<&str> = path.split('/').collect();
    // .../<dir>/skills/<name>/SKILL.md
    let n = parts.len();
    let holder = if n >= 4 { parts[n - 4] } else { "" };
    let nested = n > 4;
    let scope = |top: &'static str| if nested { "nested" } else { top };
    match holder {
        ".agents" => ("shared", scope("repo"), None),
        ".claude" => ("claude", scope("repo"), None),
        ".gemini" => ("gemini", scope("repo"), None),
        ".codex" => ("codex", scope("repo"), None),
        // a plugin or a skills repo: <plugin>/skills/<name>/SKILL.md, or skills/<name>/SKILL.md at the root
        "" => ("shared", "repo", None),
        p => ("claude", "plugin", Some(p.to_string())),
    }
}

/// The index for `root`.
pub fn index(root: &Path) -> Index {
    let mut skills = vec![];
    let mut instructions = vec![];
    let mut searched = vec![
        "this repo: every */skills/*/SKILL.md (.agents, .claude, .gemini, .codex, nested, plugins)".to_string(),
        "this repo: .claude/commands/*.md, .cursor/rules/*.mdc".into(),
        "this repo: CLAUDE.md, AGENTS.md, AGENTS.override.md, GEMINI.md at any depth".into(),
    ];
    let files = repo_files(root);
    let read = |p: &str| std::fs::read_to_string(root.join(p)).ok();
    for p in &files {
        let parts: Vec<&str> = p.split('/').collect();
        let file = *parts.last().unwrap_or(&"");
        let n = parts.len();
        if file == "SKILL.md" && n >= 3 && parts[n - 3] == "skills" {
            let (agent, scope, plugin) = classify(p);
            if let Some(t) = read(p) {
                skills.push(entry(&t, parts[n - 2], agent, scope, "skill", p.clone(), plugin));
            }
        } else if n >= 3 && parts[n - 3] == ".claude" && parts[n - 2] == "commands" && file.ends_with(".md") {
            if let Some(t) = read(p) {
                skills.push(entry(
                    &t,
                    file.trim_end_matches(".md"),
                    "claude",
                    if n > 3 { "nested" } else { "repo" },
                    "command",
                    p.clone(),
                    None,
                ));
            }
        } else if n >= 3 && parts[n - 3] == ".cursor" && parts[n - 2] == "rules" && file.ends_with(".mdc") {
            if let Some(t) = read(p) {
                skills.push(entry(
                    &t,
                    file.trim_end_matches(".mdc"),
                    "cursor",
                    if n > 3 { "nested" } else { "repo" },
                    "rule",
                    p.clone(),
                    None,
                ));
            }
        } else if let Some(agent) = match file {
            "CLAUDE.md" | "CLAUDE.local.md" => Some("claude"),
            "AGENTS.md" | "AGENTS.override.md" => Some("codex"),
            "GEMINI.md" => Some("gemini"),
            _ => None,
        } {
            let bytes = std::fs::metadata(root.join(p)).map(|m| m.len()).unwrap_or(0);
            let headline = read(p)
                .and_then(|t| {
                    t.lines().map(str::trim).find(|l| !l.is_empty()).map(|l| l.trim_start_matches('#').trim().chars().take(120).collect())
                })
                .unwrap_or_default();
            instructions.push(Instruction {
                path: p.clone(),
                agent: agent.into(),
                scope: if n > 1 { "nested".into() } else { "repo".into() },
                bytes,
                headline,
            });
        }
    }
    if let Some(h) = home() {
        let tilde = |p: &Path| p.strip_prefix(&h).map(|r| format!("~/{}", r.display())).unwrap_or_else(|_| p.display().to_string());
        for (dir, agent) in
            [(".claude/skills", "claude"), (".agents/skills", "codex"), (".codex/skills", "codex"), (".gemini/skills", "gemini")]
        {
            searched.push(format!("~/{dir}/*/SKILL.md"));
            user_dir(&h.join(dir), agent, "user", &tilde, &mut skills);
        }
        // installed plugins only (a marketplace lists far more than you have):
        // ~/.claude/plugins/installed_plugins.json → <installPath>/skills/<name>/SKILL.md
        searched.push("installed Claude plugins: <installPath>/skills/*/SKILL.md".into());
        installed_plugins(&h, &tilde, &mut skills);
        for (p, agent) in [
            (".claude/CLAUDE.md", "claude"),
            (".codex/AGENTS.override.md", "codex"),
            (".codex/AGENTS.md", "codex"),
            (".gemini/GEMINI.md", "gemini"),
        ] {
            let f = h.join(p);
            if let Ok(t) = std::fs::read_to_string(&f) {
                let headline = t
                    .lines()
                    .map(str::trim)
                    .find(|l| !l.is_empty())
                    .map(|l| l.trim_start_matches('#').trim().chars().take(120).collect())
                    .unwrap_or_default();
                instructions.push(Instruction {
                    path: tilde(&f),
                    agent: agent.into(),
                    scope: "user".into(),
                    bytes: t.len() as u64,
                    headline,
                });
            }
        }
        searched.push("~/.claude/CLAUDE.md, ~/.codex/AGENTS.md, ~/.gemini/GEMINI.md".into());
    }
    let admin = Path::new("/etc/codex/skills");
    if admin.is_dir() {
        searched.push("/etc/codex/skills".into());
        user_dir(admin, "codex", "admin", &|p: &Path| p.display().to_string(), &mut skills);
    }
    skills.sort_by(|a, b| a.name.cmp(&b.name).then(a.path.cmp(&b.path)));
    Index { skills, instructions, searched }
}

fn user_dir(dir: &Path, agent: &str, scope: &str, show: &dyn Fn(&Path) -> String, out: &mut Vec<Entry>) {
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let f = e.path().join("SKILL.md");
        if let Ok(t) = std::fs::read_to_string(&f) {
            out.push(entry(&t, &e.file_name().to_string_lossy(), agent, scope, "skill", show(&f), None));
        } else if e.file_name() == "synced" || e.file_name() == ".system" {
            user_dir(&e.path(), agent, scope, show, out); // claude.ai synced skills, Codex's preinstalled ones
        }
    }
}

/// Skills of the plugins Claude Code has installed, as `plugin:skill`.
fn installed_plugins(home: &Path, show: &dyn Fn(&Path) -> String, out: &mut Vec<Entry>) {
    let Ok(text) = std::fs::read_to_string(home.join(".claude/plugins/installed_plugins.json")) else { return };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { return };
    let Some(plugins) = v.get("plugins").and_then(|p| p.as_object()) else { return };
    for (key, installs) in plugins {
        let name = key.split('@').next().unwrap_or(key).to_string();
        let Some(path) = installs.as_array().and_then(|a| a.last()).and_then(|i| i.get("installPath")).and_then(|p| p.as_str()) else {
            continue;
        };
        let before = out.len();
        user_dir(&PathBuf::from(path).join("skills"), "claude", "plugin", show, out);
        for s in &mut out[before..] {
            s.plugin = Some(name.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    // both tests set KULA_SKILL_HOME; the test harness runs them in parallel
    static ENV: Mutex<()> = Mutex::new(());

    fn repo() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        Command::new("git").arg("-C").arg(r).args(["init", "-q"]).status().unwrap();
        let w = |p: &str, t: &str| {
            std::fs::create_dir_all(r.join(p).parent().unwrap()).unwrap();
            std::fs::write(r.join(p), t).unwrap();
        };
        w(".agents/skills/review/SKILL.md", "---\nname: review\ndescription: Review a diff\n---\n1. Read it.");
        w(".claude/skills/deploy/SKILL.md", "---\ndescription: Ship it\nallowed-tools: Bash(git *)\n---\nGo.");
        w("tools/lint/skills/fmt/SKILL.md", "---\nname: fmt\ndescription: Format\n---\nfmt.");
        w("web/.claude/skills/ui/SKILL.md", "---\nname: ui\ndescription: UI work\n---\nui.");
        w(".claude/commands/old.md", "Run the old thing.");
        w(".cursor/rules/style.mdc", "---\ndescription: House style\n---\nstyle.");
        w("AGENTS.md", "# How to work here\n");
        w("web/CLAUDE.md", "# Web notes\n");
        d
    }

    #[test]
    fn finds_skills_where_the_agents_look() {
        let _g = ENV.lock().unwrap_or_else(|e| e.into_inner());
        std::env::set_var("KULA_SKILL_HOME", "");
        let d = repo();
        let ix = index(d.path());
        let by = |n: &str| ix.skills.iter().find(|s| s.name == n).unwrap_or_else(|| panic!("no {n}: {:?}", ix.skills));
        assert_eq!(by("review").agent, "shared");
        let deploy = by("deploy");
        assert_eq!((deploy.agent.as_str(), deploy.scope.as_str()), ("claude", "repo"));
        assert_eq!(deploy.meta.get("allowed-tools").map(String::as_str), Some("Bash(git *)"));
        let fmt = by("fmt");
        assert_eq!((fmt.scope.as_str(), fmt.plugin.as_deref()), ("plugin", Some("lint")));
        assert_eq!(by("ui").scope, "nested");
        assert_eq!(by("old").kind, "command");
        assert_eq!(by("old").description, "Run the old thing.");
        assert_eq!(by("style").agent, "cursor");
        let ins: Vec<_> = ix.instructions.iter().map(|i| (i.path.as_str(), i.agent.as_str(), i.scope.as_str())).collect();
        assert!(ins.contains(&("AGENTS.md", "codex", "repo")), "{ins:?}");
        assert!(ins.contains(&("web/CLAUDE.md", "claude", "nested")), "{ins:?}");
        assert_eq!(ix.instructions.iter().find(|i| i.path == "AGENTS.md").unwrap().headline, "How to work here");
    }

    #[test]
    fn user_skills_come_from_the_given_home() {
        let _g = ENV.lock().unwrap_or_else(|e| e.into_inner());
        let d = repo();
        let h = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(h.path().join(".claude/skills/mine")).unwrap();
        std::fs::write(h.path().join(".claude/skills/mine/SKILL.md"), "---\nname: mine\ndescription: Personal\n---\nx").unwrap();
        let kit = h.path().join(".claude/plugins/cache/m/kit/abc");
        std::fs::create_dir_all(kit.join("skills/kitty")).unwrap();
        std::fs::write(kit.join("skills/kitty/SKILL.md"), "---\nname: kitty\ndescription: From a plugin\n---\nx").unwrap();
        // listed by a marketplace but not installed: left out
        std::fs::create_dir_all(h.path().join(".claude/plugins/marketplaces/m/plugins/other/skills/nope")).unwrap();
        std::fs::write(h.path().join(".claude/plugins/marketplaces/m/plugins/other/skills/nope/SKILL.md"), "---\nname: nope\n---\nx")
            .unwrap();
        let installed = serde_json::json!({ "version": 2, "plugins": { "kit@m": [{ "installPath": kit }] } });
        std::fs::write(h.path().join(".claude/plugins/installed_plugins.json"), installed.to_string()).unwrap();
        std::env::set_var("KULA_SKILL_HOME", h.path());
        let ix = index(d.path());
        std::env::set_var("KULA_SKILL_HOME", "");
        let mine = ix.skills.iter().find(|s| s.name == "mine").expect("user skill");
        assert_eq!((mine.scope.as_str(), mine.path.as_str()), ("user", "~/.claude/skills/mine/SKILL.md"));
        let kitty = ix.skills.iter().find(|s| s.name == "kitty").expect("plugin skill");
        assert_eq!((kitty.scope.as_str(), kitty.plugin.as_deref()), ("plugin", Some("kit")));
        assert!(!ix.skills.iter().any(|s| s.name == "nope"), "an uninstalled marketplace plugin is not listed");
    }
}
