//! Skills: one set for every agent, kept in git.
//!
//! A skill is a folder with a SKILL.md (frontmatter `name`, `description`, then
//! the instructions) and any files it needs. The repository keeps one copy in
//! `.agents/skills/<name>/`, which Codex reads as it is; `kula skill sync`
//! writes the same skill where each other agent looks for it – Claude Code and
//! Gemini CLI as a copy of the folder, Cursor as a rule. Skills an agent
//! already has that the source lacks can be adopted into it, so the whole team
//! – people and agents – edits one set and reviews changes like any other code.

use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

pub const SOURCE: &str = ".agents/skills";

#[derive(Debug, Clone, Serialize)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub body: String,
    /// Other files in the skill's folder, relative to it.
    pub files: Vec<String>,
    /// Per agent: "synced", "differs", "missing" or "native" (reads the source itself).
    pub targets: BTreeMap<String, &'static str>,
}

/// A skill one agent has that the source does not.
#[derive(Debug, Clone, Serialize)]
pub struct Stray {
    pub agent: String,
    pub name: String,
    pub path: String,
    pub description: String,
}

/// The agents a repository uses: kula's own detection, plus any that already hold skills.
fn agents(root: &Path) -> Vec<&'static str> {
    let mut out = crate::agents::detected(root);
    if !out.contains(&"codex") {
        out.push("codex");
    }
    out
}

/// Where `agent` reads skill `name`, relative to the root. Codex reads the source.
fn target(agent: &str, name: &str) -> Option<String> {
    match agent {
        "claude" => Some(format!(".claude/skills/{name}/SKILL.md")),
        "gemini" => Some(format!(".gemini/skills/{name}/SKILL.md")),
        "cursor" => Some(format!(".cursor/rules/{name}.mdc")),
        _ => None,
    }
}

fn valid(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// Frontmatter and body of a SKILL.md or .mdc.
fn parse(text: &str) -> (BTreeMap<String, String>, String) {
    let mut fm = BTreeMap::new();
    if let Some(rest) = text.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---") {
            for line in rest[..end].lines() {
                if let Some((k, v)) = line.split_once(':') {
                    fm.insert(k.trim().to_string(), v.trim().trim_matches('"').to_string());
                }
            }
            let body = rest[end + 4..].trim_start_matches('\n').to_string();
            return (fm, body);
        }
    }
    (fm, text.to_string())
}

fn skill_md(name: &str, description: &str, body: &str) -> String {
    format!("---\nname: {name}\ndescription: {}\n---\n\n{}\n", description.replace('\n', " "), body.trim_end())
}

fn cursor_rule(description: &str, body: &str) -> String {
    format!("---\ndescription: {}\nalwaysApply: false\n---\n\n{}\n", description.replace('\n', " "), body.trim_end())
}

fn files_in(dir: &Path, base: &Path, out: &mut Vec<String>) {
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = e.path();
        if p.is_dir() {
            files_in(&p, base, out);
        } else if let Ok(rel) = p.strip_prefix(base) {
            let rel = rel.to_string_lossy().replace('\\', "/");
            if rel != "SKILL.md" {
                out.push(rel);
            }
        }
    }
}

/// What the agent's copy of `name` should hold, for comparison and writing.
fn expected(agent: &str, s: &Skill) -> String {
    if agent == "cursor" {
        cursor_rule(&s.description, &s.body)
    } else {
        skill_md(&s.name, &s.description, &s.body)
    }
}

/// Every skill in the source, with each agent's copy checked against it.
pub fn list(root: &Path) -> Vec<Skill> {
    let mut out = vec![];
    let ags = agents(root);
    for e in std::fs::read_dir(root.join(SOURCE)).into_iter().flatten().flatten() {
        let dir = e.path();
        let Ok(text) = std::fs::read_to_string(dir.join("SKILL.md")) else { continue };
        let name = e.file_name().to_string_lossy().to_string();
        let (fm, body) = parse(&text);
        let mut files = vec![];
        files_in(&dir, &dir, &mut files);
        files.sort();
        let mut s = Skill {
            name: name.clone(),
            description: fm.get("description").cloned().unwrap_or_default(),
            body,
            files,
            targets: BTreeMap::new(),
        };
        for a in &ags {
            let state = match target(a, &name) {
                None => "native",
                Some(t) => match std::fs::read_to_string(root.join(&t)) {
                    Err(_) => "missing",
                    Ok(have) if have.trim() == expected(a, &s).trim() => "synced",
                    Ok(_) => "differs",
                },
            };
            s.targets.insert(a.to_string(), state);
        }
        out.push(s);
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Skills the agents hold that the source does not – kula's own files excluded.
pub fn strays(root: &Path) -> Vec<Stray> {
    let have: Vec<String> = list(root).into_iter().map(|s| s.name).collect();
    let mut out = vec![];
    for (agent, dir) in [("claude", ".claude/skills"), ("gemini", ".gemini/skills")] {
        for e in std::fs::read_dir(root.join(dir)).into_iter().flatten().flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let p = e.path().join("SKILL.md");
            if let (false, Ok(text)) = (have.contains(&name), std::fs::read_to_string(&p)) {
                out.push(Stray {
                    agent: agent.into(),
                    path: format!("{dir}/{name}/SKILL.md"),
                    description: parse(&text).0.get("description").cloned().unwrap_or_default(),
                    name,
                });
            }
        }
    }
    for e in std::fs::read_dir(root.join(".cursor/rules")).into_iter().flatten().flatten() {
        let f = e.file_name().to_string_lossy().to_string();
        let Some(name) = f.strip_suffix(".mdc") else { continue };
        if name.starts_with("kula-") || have.iter().any(|h| h == name) {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(e.path()) {
            out.push(Stray {
                agent: "cursor".into(),
                path: format!(".cursor/rules/{f}"),
                description: parse(&text).0.get("description").cloned().unwrap_or_default(),
                name: name.into(),
            });
        }
    }
    out
}

/// Create or replace a skill's SKILL.md in the source; its other files stay.
pub fn save(root: &Path, name: &str, description: &str, body: &str) -> Result<()> {
    if !valid(name) {
        bail!("skill names are lowercase letters, digits, - and _: {name:?}");
    }
    if description.trim().is_empty() {
        bail!("say when to use the skill: agents pick skills by their description");
    }
    let dir = root.join(SOURCE).join(name);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("SKILL.md"), skill_md(name, description.trim(), body))?;
    Ok(())
}

/// Remove a skill from the source and every agent's copy.
pub fn remove(root: &Path, name: &str) -> Result<()> {
    if !valid(name) {
        bail!("no skill called {name:?}");
    }
    let _ = std::fs::remove_dir_all(root.join(SOURCE).join(name));
    for a in ["claude", "gemini"] {
        let _ = std::fs::remove_dir_all(root.join(format!(".{a}/skills/{name}")));
    }
    let _ = std::fs::remove_file(root.join(format!(".cursor/rules/{name}.mdc")));
    Ok(())
}

fn copy_dir(from: &Path, to: &Path) -> Result<()> {
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)?.flatten() {
        let (src, dst) = (e.path(), to.join(e.file_name()));
        if src.is_dir() {
            copy_dir(&src, &dst)?;
        } else {
            std::fs::copy(&src, &dst).with_context(|| format!("copying {}", src.display()))?;
        }
    }
    Ok(())
}

/// Write every skill where each agent reads it. Returns the files written.
pub fn sync(root: &Path) -> Result<Vec<String>> {
    let mut written = vec![];
    for s in list(root) {
        for (a, state) in &s.targets {
            if *state == "synced" || *state == "native" {
                continue;
            }
            let t = target(a, &s.name).expect("only agents with a target are checked");
            let dst = root.join(&t);
            if a == "cursor" {
                std::fs::create_dir_all(dst.parent().unwrap())?;
                std::fs::write(&dst, expected(a, &s))?;
            } else {
                // the whole folder, so scripts and references come along
                copy_dir(&root.join(SOURCE).join(&s.name), dst.parent().unwrap())?;
            }
            written.push(t);
        }
    }
    Ok(written)
}

/// What a sync would overwrite: a unified diff of the agent's copy against the
/// source, shown before `skills_sync` replaces it. None when there is nothing to compare.
pub fn diff(root: &Path, agent: &str, name: &str) -> Option<String> {
    let s = list(root).into_iter().find(|s| s.name == name)?;
    let t = target(agent, name)?;
    let have = std::fs::read_to_string(root.join(&t)).ok()?;
    Some(unified_diff(&format!("{t} (agent copy)"), &have, &format!(".agents/skills/{name} (source)"), &expected(agent, &s)))
}

/// A small unified diff – line based, LCS, three lines of context. Enough to
/// read what a sync would change, without pulling in a diff crate.
fn unified_diff(a_name: &str, a: &str, b_name: &str, b: &str) -> String {
    let (x, y): (Vec<&str>, Vec<&str>) = (a.lines().collect(), b.lines().collect());
    let n = x.len();
    let m = y.len();
    // LCS table, row by row.
    let mut lcs = vec![vec![0usize; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            lcs[i][j] = if x[i] == y[j] { lcs[i + 1][j + 1] + 1 } else { lcs[i + 1][j].max(lcs[i][j + 1]) };
        }
    }
    // Walk it into change hunks: runs of (same | old-only | new-only).
    #[derive(PartialEq, Clone, Copy)]
    enum Op {
        Same,
        Del,
        Add,
    }
    let mut ops: Vec<(Op, usize)> = vec![];
    let (mut i, mut j) = (0, 0);
    while i < n && j < m {
        if x[i] == y[j] {
            ops.push((Op::Same, i));
            i += 1;
            j += 1;
        } else if lcs[i + 1][j] >= lcs[i][j + 1] {
            ops.push((Op::Del, i));
            i += 1;
        } else {
            ops.push((Op::Add, j));
            j += 1;
        }
    }
    for k in i..n {
        ops.push((Op::Del, k));
    }
    for k in j..m {
        ops.push((Op::Add, k));
    }
    if ops.iter().all(|(op, _)| *op == Op::Same) {
        return String::new();
    }
    // One hunk from three lines before the first change to three after the
    // last – skills are short, so one hunk is always readable.
    let changed: Vec<usize> = ops.iter().enumerate().filter(|(_, (op, _))| *op != Op::Same).map(|(i, _)| i).collect();
    let first = changed[0].saturating_sub(3);
    let last = (changed[changed.len() - 1] + 4).min(ops.len());
    let mut out = format!("--- {a_name}\n+++ {b_name}\n");
    let hunk = &ops[first..last];
    let (mut a_no, mut b_no) = (1usize, 1usize);
    for (op, _) in ops[..first].iter() {
        match op {
            Op::Add => b_no += 1,
            _ => {
                a_no += 1;
                b_no += 1;
            }
        }
    }
    let (astart, bstart) = (a_no, b_no);
    let same = hunk.iter().filter(|(op, _)| *op == Op::Same).count();
    let del = hunk.iter().filter(|(op, _)| *op == Op::Del).count() + same;
    let add = hunk.iter().filter(|(op, _)| *op == Op::Add).count() + same;
    out.push_str(&format!("@@ -{},{} +{},{} @@\n", astart, del, bstart, add));
    for (op, k) in hunk {
        match op {
            Op::Same => {
                out.push_str(&format!(" {}\n", x[*k]));
            }
            Op::Del => out.push_str(&format!("-{}\n", x[*k])),
            Op::Add => out.push_str(&format!("+{}\n", y[*k])),
        }
    }
    out
}

/// Take a skill one agent has into the source, then share it with the rest.
pub fn adopt(root: &Path, agent: &str, name: &str) -> Result<Vec<String>> {
    let s = strays(root)
        .into_iter()
        .find(|s| s.agent == agent && s.name == name)
        .ok_or_else(|| anyhow::anyhow!("{agent} has no skill {name} to adopt"))?;
    let slug: String =
        name.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect();
    let text = std::fs::read_to_string(root.join(&s.path))?;
    let (fm, body) = parse(&text);
    let description = fm.get("description").cloned().filter(|d| !d.is_empty()).unwrap_or_else(|| format!("{name}, adopted from {agent}"));
    if agent == "cursor" {
        save(root, &slug, &description, &body)?;
    } else {
        copy_dir(root.join(&s.path).parent().unwrap(), &root.join(SOURCE).join(&slug))?;
        save(root, &slug, &description, &body)?;
    }
    sync(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_source_every_agent() {
        let root = std::env::temp_dir().join(format!("kula-skills-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".cursor")).unwrap();
        save(&root, "release-notes", "Write release notes from the merged PRs", "1. Read the log.\n2. Group by area.").unwrap();
        std::fs::write(root.join(SOURCE).join("release-notes/template.md"), "## Added").unwrap();
        let s = &list(&root)[0];
        assert_eq!(s.files, vec!["template.md"]);
        assert_eq!(s.targets["claude"], "missing");
        assert_eq!(s.targets["codex"], "native");
        let w = sync(&root).unwrap();
        assert!(w.contains(&".claude/skills/release-notes/SKILL.md".to_string()));
        assert!(root.join(".claude/skills/release-notes/template.md").exists());
        assert!(std::fs::read_to_string(root.join(".cursor/rules/release-notes.mdc")).unwrap().contains("alwaysApply: false"));
        assert!(list(&root)[0].targets.values().all(|t| *t == "synced" || *t == "native"));
        // an agent's own skill is adopted into the source and shared
        std::fs::create_dir_all(root.join(".claude/skills/triage")).unwrap();
        std::fs::write(root.join(".claude/skills/triage/SKILL.md"), skill_md("triage", "Sort new issues", "Label them.")).unwrap();
        assert_eq!(strays(&root).len(), 1);
        adopt(&root, "claude", "triage").unwrap();
        assert!(strays(&root).is_empty());
        assert!(root.join(".cursor/rules/triage.mdc").exists());
        remove(&root, "triage").unwrap();
        assert!(!root.join(".claude/skills/triage").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn diff_shows_what_a_sync_would_overwrite() {
        let root = std::env::temp_dir().join(format!("kula-skilldiff-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".cursor")).unwrap();
        save(&root, "triage", "Sort new issues", "1. Reproduce.\n2. Label.").unwrap();
        assert_eq!(diff(&root, "claude", "triage"), None, "nothing to compare while the copy is missing");
        sync(&root).unwrap();
        assert_eq!(diff(&root, "claude", "triage").unwrap_or_default(), "", "a synced copy has no diff");
        // the agent's copy was edited: the diff says what a sync would replace
        std::fs::write(
            root.join(".claude/skills/triage/SKILL.md"),
            skill_md("triage", "Sort new issues", "1. Reproduce.\n2. Label the severity.\n3. Assign."),
        )
        .unwrap();
        let d = diff(&root, "claude", "triage").unwrap();
        assert!(d.contains("--- .claude/skills/triage/SKILL.md (agent copy)"), "{d}");
        assert!(d.contains("+++ .agents/skills/triage (source)"), "{d}");
        assert!(d.contains("@@"), "{d}");
        assert!(d.contains("-2. Label the severity."), "{d}");
        assert!(d.contains("+2. Label."), "{d}");
        // sync makes them equal again and the diff empties
        sync(&root).unwrap();
        assert_eq!(diff(&root, "claude", "triage").unwrap_or_default(), "");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn diff_hunks_carry_honest_line_numbers() {
        let a = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten";
        let b = "one\ntwo\nTHREE\nfour\nfive\nsix\nseven\neight\nNINE\nten";
        let d = unified_diff("a", a, "b", b);
        // two edits, one hunk: starts at line 1 in both files (3 lines of
        // context), covering the whole file – 10 lines on each side
        assert!(d.contains("@@ -1,10 +1,10 @@"), "{d}");
        assert!(d.contains("-three\n+THREE\n"), "{d}");
        assert!(d.contains("-nine\n+NINE\n"), "{d}");
        // leading and trailing context are the unchanged lines
        assert!(d.contains("\n two\n"), "{d}");
        assert!(d.contains("\n ten"), "{d}");
    }
}
