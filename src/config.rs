//! `kula.toml` – the project's own settings, committed next to the code.
//!
//! Everything has a default, so a repo without the file behaves exactly as
//! before; `kula init` writes one so a team shares the same graph, hooks and
//! CI gate.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const FILE: &str = "kula.toml";

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Config {
    pub project: Project,
    pub index: Index,
    pub hooks: Hooks,
    pub check: Check,
    pub agents: Agents,
    /// `[[guard]]` rules: code agents may not touch, or may not even see.
    #[serde(rename = "guard")]
    pub guards: Vec<GuardRule>,
    /// `[[workflow]]` work modes; see `workflow.rs` for the built-ins.
    #[serde(rename = "workflow")]
    pub workflows: Vec<crate::workflow::Workflow>,
    /// `[[team]]` agent teams: each agent in its own workflow.
    #[serde(rename = "team")]
    pub teams: Vec<Team>,
}

/// A team of agents, each working in its own workflow.
///
/// ```toml
/// [[team]]
/// name = "ship"
/// about = "Claude Code researches, Cursor writes tests, Codex reviews"
/// members = [
///   { agent = "claude", workflow = "autoresearch", role = "speed up the indexer" },
///   { agent = "cursor", workflow = "tests" },
///   { agent = "codex", workflow = "explore", role = "review" },
/// ]
/// ```
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Team {
    pub name: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub about: String,
    /// Instructions every member gets, before its own.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub prompt: String,
    /// The team this one answers to: its lead reports to that team's lead, so
    /// teams nest into a society of teams.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub under: String,
    pub members: Vec<Member>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Member {
    /// The seat's own name ("Atlas"): how teammates point at it. Optional –
    /// without one, the agent below is the name, as before.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub name: String,
    /// What runs this seat: claude · cursor · codex · gemini, any MCP client
    /// name, or `any` (empty) for whichever agent is connected.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub agent: String,
    /// The workflow this agent works in while the team is active.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub workflow: String,
    /// Narrows the workflow's scope for this agent.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub scope: Vec<String>,
    /// What this agent is for, in a few words.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub role: String,
    /// Its own system prompt, after the team's and before its workflow's.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub prompt: String,
    /// The member it answers to (an agent name); none for the lead.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub reports_to: String,
    /// Who it hands its work to when it is done (agent names).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub hands_off: Vec<String>,
}

impl Member {
    /// How the team refers to this seat: its name, else its agent.
    pub fn key(&self) -> &str {
        if self.name.is_empty() {
            &self.agent
        } else {
            &self.name
        }
    }
    /// The agent that runs it, for people: `any` when unset.
    pub fn runner(&self) -> &str {
        if self.agent.is_empty() {
            "any"
        } else {
            &self.agent
        }
    }
}

/// What kula tells and allows AI agents (MCP, hooks).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Agents {
    /// Keep likely secrets (.env, keys, certificates) out of every agent answer.
    pub hide_secrets: bool,
    /// Let agents keep memories anchored to symbols (`remember` / `recall`).
    pub memory: bool,
    /// Docs every agent should read first; AGENTS.md and friends are found on their own.
    pub docs: Vec<String>,
}

impl Default for Agents {
    fn default() -> Self {
        Agents { hide_secrets: true, memory: true, docs: vec![] }
    }
}

/// One fence around part of the codebase.
///
/// ```toml
/// [[guard]]
/// paths = ["migrations/**"]
/// symbols = ["charge_card"]
/// level = "locked"          # locked | hidden | review
/// reason = "schema changes go through the DBA"
/// ```
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct GuardRule {
    /// gitignore-style globs, relative to the repository root.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<String>,
    /// Symbol names, or `path:name` to pin one.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub symbols: Vec<String>,
    /// locked: read, never edit. hidden: never read or edit. review: edit, flagged for a human.
    pub level: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub reason: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Project {
    /// Display name; the directory name when empty.
    pub name: String,
    /// The branch proposals and `kula check` compare against; detected when empty.
    pub default_branch: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Index {
    /// Extra gitignore-style globs to leave out of the graph (on top of .gitignore).
    pub exclude: Vec<String>,
    /// Skip source files larger than this (generated bundles, vendored blobs).
    pub max_file_kb: u64,
}

impl Default for Index {
    fn default() -> Self {
        Index { exclude: vec![], max_file_kb: 1024 }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Hooks {
    /// Reindex in the background after commit, checkout and merge.
    pub reindex: bool,
}

impl Default for Hooks {
    fn default() -> Self {
        Hooks { reindex: true }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Check {
    /// `kula check` fails when a change's risk is above this: none | low | medium | high.
    pub max_risk: String,
}

impl Default for Check {
    fn default() -> Self {
        Check { max_risk: "medium".into() }
    }
}

impl Config {
    /// The repo's `kula.toml`, or defaults when there is none.
    pub fn load(root: &Path) -> Result<Config> {
        let p = root.join(FILE);
        match std::fs::read_to_string(&p) {
            Ok(s) => toml::from_str(&s).with_context(|| format!("reading {}", p.display())),
            Err(_) => Ok(Config::default()),
        }
    }

    pub fn exists(root: &Path) -> bool {
        root.join(FILE).exists()
    }

    /// The commented file `kula init` writes.
    pub fn render(&self) -> String {
        let q = |s: &str| format!("{s:?}");
        let excl = self.index.exclude.iter().map(|e| q(e)).collect::<Vec<_>>().join(", ");
        format!(
            "# kula.toml – shared settings for this repository's graph. Commit it.\n\
             # Docs: https://github.com/A12N4V/kula#configuration\n\n\
             [project]\n\
             name = {}\n\
             default_branch = {}   # what proposals and `kula check` compare against\n\n\
             [index]\n\
             exclude = [{}]   # gitignore-style globs, on top of .gitignore\n\
             max_file_kb = {}\n\n\
             [hooks]\n\
             reindex = {}   # keep the graph current after commit / checkout / merge\n\n\
             [check]\n\
             max_risk = {}   # CI gate: none | low | medium | high\n\n\
             [agents]\n\
             hide_secrets = {}   # keep .env, keys and certificates out of every agent answer\n\
             memory = {}         # let agents remember facts about the code (`kula memory`)\n\n\
             # Fence code off from AI agents. locked: read, never edit · hidden: never shown ·\n\
             # review: editable, flagged in `kula check`. Paths are globs; symbols are names.\n\
             # [[guard]]\n\
             # paths = [\"migrations/**\"]\n\
             # level = \"locked\"\n\
             # reason = \"schema changes go through the DBA\"\n",
            q(&self.project.name),
            q(&self.project.default_branch),
            excl,
            self.index.max_file_kb,
            self.hooks.reindex,
            q(&self.check.max_risk),
            self.agents.hide_secrets,
            self.agents.memory,
        )
    }
}

// ------------------------------------------------------------------ edits

/// Rewrite part of kula.toml in place, keeping every comment and table the
/// edit doesn't touch. Starts from the commented default when there is none.
fn edit(root: &Path, f: impl FnOnce(&mut toml_edit::DocumentMut) -> Result<()>) -> Result<Config> {
    let p = root.join(FILE);
    let text = std::fs::read_to_string(&p).unwrap_or_else(|_| Config::default().render());
    let mut doc: toml_edit::DocumentMut = text.parse().with_context(|| format!("reading {}", p.display()))?;
    f(&mut doc)?;
    let out = doc.to_string();
    // Never write a file kula itself can't read back.
    let cfg: Config = toml::from_str(&out).context("the edit would make kula.toml invalid")?;
    std::fs::write(&p, out)?;
    Ok(cfg)
}

/// Replace an array of tables (`[[guard]]`, `[[workflow]]`) with `items`.
fn set_tables<T: Serialize>(doc: &mut toml_edit::DocumentMut, key: &str, items: &[T]) -> Result<()> {
    doc.remove(key);
    if items.is_empty() {
        return Ok(());
    }
    #[derive(Serialize)]
    struct Wrap<'a, T> {
        #[serde(rename = "_")]
        items: &'a [T],
    }
    let frag: toml_edit::DocumentMut = toml::to_string(&Wrap { items })?.parse()?;
    let mut item = frag["_"].clone();
    if let Some(a) = item.as_array_of_tables_mut() {
        for t in a.iter_mut() {
            t.decor_mut().set_prefix("\n");
        }
    }
    doc.insert(key, item);
    renumber(doc);
    Ok(())
}

/// Lay every table out in key order, each one's subtables right after it, so a
/// team's members never end up below some other section.
fn renumber(doc: &mut toml_edit::DocumentMut) {
    fn walk(t: &mut toml_edit::Table, n: &mut isize) {
        for (_, item) in t.iter_mut() {
            match item {
                toml_edit::Item::Table(t) => {
                    t.set_position(*n);
                    *n += 1;
                    walk(t, n);
                }
                toml_edit::Item::ArrayOfTables(a) => {
                    for t in a.iter_mut() {
                        t.set_position(*n);
                        *n += 1;
                        walk(t, n);
                    }
                }
                _ => {}
            }
        }
    }
    walk(doc.as_table_mut(), &mut 0);
}

pub fn set_guards(root: &Path, rules: &[GuardRule]) -> Result<Config> {
    for r in rules {
        if r.paths.is_empty() && r.symbols.is_empty() {
            anyhow::bail!("a guard needs paths or symbols");
        }
        if !matches!(r.level.as_str(), "locked" | "hidden" | "review") {
            anyhow::bail!("guard level must be locked, hidden or review, not {:?}", r.level);
        }
    }
    edit(root, |d| set_tables(d, "guard", rules))
}

/// Save the repository's own workflows (built-ins it hasn't overridden stay implicit).
pub fn set_workflows(root: &Path, wfs: &[crate::workflow::Workflow]) -> Result<Config> {
    let mut seen = std::collections::HashSet::new();
    for w in wfs {
        if !crate::workflow::valid_name(&w.name) {
            anyhow::bail!("workflow names are letters, digits, - and _: {:?}", w.name);
        }
        if !seen.insert(&w.name) {
            anyhow::bail!("two workflows are called {}", w.name);
        }
    }
    let wfs: Vec<_> = wfs.iter().map(|w| crate::workflow::Workflow { builtin: false, ..w.clone() }).collect();
    edit(root, |d| set_tables(d, "workflow", &wfs))
}

pub fn set_teams(root: &Path, teams: &[Team]) -> Result<Config> {
    let mut seen = std::collections::HashSet::new();
    for t in teams {
        if !crate::workflow::valid_name(&t.name) {
            anyhow::bail!("team names are letters, digits, - and _: {:?}", t.name);
        }
        if !seen.insert(&t.name) {
            anyhow::bail!("two teams are called {}", t.name);
        }
        if t.members.iter().any(|m| m.key().trim().is_empty()) {
            anyhow::bail!("team {}: every member has a name or an agent", t.name);
        }
        let names: Vec<&str> = t.members.iter().map(|m| m.key()).collect();
        if let Some(d) = names.iter().enumerate().find(|(i, n)| names[..*i].contains(n)).map(|x| x.1) {
            anyhow::bail!("team {}: two members are called {d}", t.name);
        }
        for m in &t.members {
            for other in std::iter::once(&m.reports_to).filter(|r| !r.is_empty()).chain(m.hands_off.iter()) {
                if !names.contains(&other.as_str()) || other == m.key() {
                    anyhow::bail!("team {}: {} points at {other:?}, which is not another member", t.name, m.key());
                }
            }
        }
        // a hierarchy, not a loop
        for m in &t.members {
            let (mut cur, mut seen) = (m.reports_to.clone(), 0);
            while !cur.is_empty() {
                seen += 1;
                if seen > t.members.len() {
                    anyhow::bail!("team {}: who reports to whom goes round in a circle", t.name);
                }
                cur = t.members.iter().find(|x| x.key() == cur).map(|x| x.reports_to.clone()).unwrap_or_default();
            }
        }
    }
    // teams of teams: each `under` names another team, and the nesting never loops
    for t in teams {
        let (mut cur, mut hops) = (t.under.clone(), 0);
        while !cur.is_empty() {
            hops += 1;
            if cur == t.name || hops > teams.len() {
                anyhow::bail!("team {}: which team answers to which goes round in a circle", t.name);
            }
            let Some(up) = teams.iter().find(|x| x.name == cur) else {
                anyhow::bail!("team {} answers to {cur:?}, which is not a team", t.name);
            };
            cur = up.under.clone();
        }
    }
    edit(root, |d| set_tables(d, "team", teams))
}

pub fn set_agents(root: &Path, a: &Agents) -> Result<Config> {
    edit(root, |d| {
        let t = d.entry("agents").or_insert(toml_edit::table()).as_table_mut().context("[agents] must be a table")?;
        t["hide_secrets"] = toml_edit::value(a.hide_secrets);
        t["memory"] = toml_edit::value(a.memory);
        if a.docs.is_empty() {
            t.remove("docs");
        } else {
            t["docs"] = toml_edit::value(a.docs.iter().collect::<toml_edit::Array>());
        }
        Ok(())
    })
}

pub fn risk_rank(r: &str) -> u8 {
    match r {
        "none" => 0,
        "low" => 1,
        "medium" => 2,
        "high" => 3,
        _ => 4,
    }
}
