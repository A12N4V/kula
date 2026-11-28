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
    /// `[[scope]]` named slices of the graph (`kula graph isolate --save`);
    /// a workflow or task reuses one as `scope = ["@name"]`.
    #[serde(rename = "scope")]
    pub scopes: Vec<Scope>,
    /// `[[schedule]]` team runs on a clock or on a push.
    #[serde(rename = "schedule", skip_serializing_if = "Vec::is_empty")]
    pub schedules: Vec<Schedule>,
}

/// A team run kula starts on its own while `kula serve` is up.
///
/// ```toml
/// [[schedule]]
/// team = "core"
/// goal = "tidy the parser"
/// cron = "0 3 * * *"      # or: on = "push" | "pr"
/// budget = 2.0            # dollars
/// ```
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Schedule {
    /// A name to pause it by; defaults to the team and goal.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub name: String,
    pub team: String,
    pub goal: String,
    /// Five fields: minute hour day month weekday, in local time.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub cron: String,
    /// `push` (the default branch moved) or `pr` (another branch moved).
    #[serde(skip_serializing_if = "String::is_empty")]
    pub on: String,
    /// Dollar cap for each run.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget: Option<f64>,
    /// Flow ids the run is held to.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub flows: Vec<String>,
}

impl Schedule {
    pub fn key(&self) -> String {
        if !self.name.is_empty() {
            return self.name.clone();
        }
        crate::orch::task::slug(&format!("{} {}", self.team, self.goal))
    }
}

/// A named part of the codebase.
///
/// ```toml
/// [[scope]]
/// name = "auth"
/// select = ["src/auth/**", "symbol:hashToken~1"]
/// paths = ["src/auth/session.ts", "src/util/crypto.ts"]
/// ```
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Scope {
    pub name: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub about: String,
    /// Selectors, re-run by `kula graph isolate @name` (see `isolate.rs`).
    pub select: Vec<String>,
    /// Default hops for symbol selectors.
    #[serde(skip_serializing_if = "is_zero_usize")]
    pub hops: usize,
    /// The files the selectors picked when saved: what `@name` means in a workflow scope.
    pub paths: Vec<String>,
}

fn is_zero_usize(n: &usize) -> bool {
    *n == 0
}

impl Config {
    /// Replace `@name` entries with the saved scope's files; anything else stays.
    pub fn expand_scope(&self, entries: &[String]) -> Vec<String> {
        let mut out = Vec::new();
        for e in entries {
            match e.strip_prefix('@').and_then(|n| self.scopes.iter().find(|s| s.name == n)) {
                Some(s) => out.extend(s.paths.iter().cloned()),
                None => out.push(e.clone()),
            }
        }
        out
    }
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
    /// Hub colour for the team's group, `#rrggbb`.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub color: String,
    /// What kind of team this is ("build", "research", "review"); groups teams on the hub.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub category: String,
    /// Gate command for this team's deploys; blank detects one from the manifests.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub test: String,
    pub members: Vec<Member>,
}

/// A seat's own fences, on top of the repository's and its workflow's. Each
/// entry is a path glob or a symbol (`name` or `path:name`).
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SeatFence {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub lock: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub hide: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub review: Vec<String>,
}

impl SeatFence {
    pub fn is_empty(&self) -> bool {
        self.lock.is_empty() && self.hide.is_empty() && self.review.is_empty()
    }
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
    /// The model it should use ("claude-opus-5-5", "gpt-5"); empty for the
    /// agent's own default.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub model: String,
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
    /// Hub colour for this seat's node, `#rrggbb`.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub color: String,
    /// Free labels the hub groups and filters seats by.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Skills linked for this seat only at launch; empty means every repo skill.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<String>,
    /// MCP servers this seat gets at launch; empty means the agent's own set.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub mcp: Vec<String>,
    /// A memory file (repo relative) given to this seat at launch.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub memory: String,
    /// Fences for this seat only.
    #[serde(skip_serializing_if = "SeatFence::is_empty")]
    pub fence: SeatFence,
    /// Token budget for this seat per run; 0 means unset (lint flags it).
    #[serde(skip_serializing_if = "is_zero_usize")]
    pub budget: usize,
    /// How many of this seat may run in parallel; 0 means unset.
    #[serde(skip_serializing_if = "is_zero_usize")]
    pub max_parallel: usize,
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
    /// The provider that actually runs it: its own, else the repo default.
    pub fn provider<'a>(&'a self, default: &'a str) -> &'a str {
        match self.runner() {
            "any" if !default.is_empty() => default,
            r => r,
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
    /// The provider a seat set to `any` runs on: the first agent connected,
    /// until someone picks another.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub default: String,
    /// `[agents.commands]` the command per agent id; `{prompt}` becomes the prompt.
    #[serde(skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub commands: std::collections::BTreeMap<String, Vec<String>>,
}

impl Default for Agents {
    fn default() -> Self {
        Agents { hide_secrets: true, memory: true, docs: vec![], default: String::new(), commands: Default::default() }
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
    let (_, out, cfg) = render_edit(root, f)?;
    std::fs::write(root.join(FILE), out)?;
    Ok(cfg)
}

/// Apply an edit in memory: the file as it is, the file as it would be, and the parsed result.
fn render_edit(root: &Path, f: impl FnOnce(&mut toml_edit::DocumentMut) -> Result<()>) -> Result<(String, String, Config)> {
    let p = root.join(FILE);
    let text = std::fs::read_to_string(&p).unwrap_or_else(|_| Config::default().render());
    let mut doc: toml_edit::DocumentMut = text.parse().with_context(|| format!("reading {}", p.display()))?;
    f(&mut doc)?;
    let out = doc.to_string();
    // Never write a file kula itself can't read back.
    let cfg: Config = toml::from_str(&out).context("the edit would make kula.toml invalid")?;
    Ok((text, out, cfg))
}

/// Replace an array of tables (`[[guard]]`, `[[workflow]]`) with `items`.
fn set_tables<T: Serialize>(doc: &mut toml_edit::DocumentMut, key: &str, items: &[T]) -> Result<()> {
    // The comment written above the first table belongs to the section, not to
    // that one entry: keep it across a rewrite.
    let lead = doc
        .get(key)
        .and_then(|i| i.as_array_of_tables())
        .and_then(|a| a.get(0))
        .and_then(|t| t.decor().prefix().and_then(|p| p.as_str()).map(str::to_string))
        .filter(|p| p.contains('#'));
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
        if let (Some(p), Some(first)) = (lead, a.get_mut(0)) {
            first.decor_mut().set_prefix(p);
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

pub fn set_scopes(root: &Path, scopes: &[Scope]) -> Result<Config> {
    let mut seen = std::collections::HashSet::new();
    for s in scopes {
        if !crate::workflow::valid_name(&s.name) {
            anyhow::bail!("scope names are letters, digits, - and _: {:?}", s.name);
        }
        if !seen.insert(&s.name) {
            anyhow::bail!("two scopes are called {}", s.name);
        }
    }
    edit(root, |d| set_tables(d, "scope", scopes))
}

pub fn set_teams(root: &Path, teams: &[Team]) -> Result<Config> {
    check_teams(teams)?;
    edit(root, |d| set_tables(d, "team", teams))
}

/// What `set_teams` would write, without writing it: (before, after). Same checks, same bytes.
pub fn preview_teams(root: &Path, teams: &[Team]) -> Result<(String, String)> {
    check_teams(teams)?;
    let (before, after, _) = render_edit(root, |d| set_tables(d, "team", teams))?;
    Ok((before, after))
}

fn check_teams(teams: &[Team]) -> Result<()> {
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
        if !t.color.is_empty() && !is_hex_colour(&t.color) {
            anyhow::bail!("team {}: colour is #rrggbb, got {:?}", t.name, t.color);
        }
        for m in &t.members {
            if !m.color.is_empty() && !is_hex_colour(&m.color) {
                anyhow::bail!("team {}: {} colour is #rrggbb, got {:?}", t.name, m.key(), m.color);
            }
            if let Some(bad) = m.tags.iter().chain(&m.skills).chain(&m.mcp).find(|x| x.trim().is_empty() || x.contains(['\n', '"'])) {
                anyhow::bail!("team {}: {} has a blank or odd tag, skill or MCP name: {bad:?}", t.name, m.key());
            }
            if m.memory.contains("..") || m.memory.starts_with('/') {
                anyhow::bail!("team {}: {} memory must be a path inside the repository", t.name, m.key());
            }
            if m.fence.lock.iter().chain(&m.fence.hide).chain(&m.fence.review).any(|x| x.trim().is_empty()) {
                anyhow::bail!("team {}: {} has a blank fence entry", t.name, m.key());
            }
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
    Ok(())
}

fn is_hex_colour(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit())
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
        // left out means unchanged: settings saves that predate it keep the default
        if !a.default.is_empty() {
            t["default"] = toml_edit::value(&a.default);
        }
        Ok(())
    })
}

/// Make `id` the default provider if none is set yet (the first connect wins).
pub fn default_agent_if_unset(root: &Path, id: &str) -> Result<()> {
    let cfg = Config::load(root)?;
    if cfg.agents.default.is_empty() {
        set_agents(root, &Agents { default: id.to_string(), ..cfg.agents })?;
    }
    Ok(())
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

/// One seat, fully resolved: what a launcher or renderer needs. A pure
/// function of the config – same toml, same spec.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct SeatSpec {
    /// Team it belongs to.
    pub team: String,
    /// The seat's key: its name, else its agent ("team/seat").
    pub key: String,
    /// What runs it: claude · codex · gemini · cursor · any.
    pub agent: String,
    /// Model override, empty for the CLI's own default.
    #[serde(default)]
    pub model: String,
    /// The workflow it works in.
    #[serde(default)]
    pub workflow: String,
    /// Scope entries narrowed for this seat.
    #[serde(default)]
    pub scope: Vec<String>,
    /// What it is for.
    #[serde(default)]
    pub role: String,
    /// Team prompt first, then the member's – last wins, appended in order.
    #[serde(default)]
    pub prompt: String,
    /// Its lead (an agent key); none for the team's lead.
    #[serde(default)]
    pub reports_to: String,
    /// Who receives its work when done.
    #[serde(default)]
    pub hands_off: Vec<String>,
    /// Skills linked for this seat only; empty means every repo skill.
    #[serde(default)]
    pub skills: Vec<String>,
    /// MCP servers this seat gets; empty means the agent's own set.
    #[serde(default)]
    pub mcp: Vec<String>,
    /// Memory file (repo relative) layered into memory.md.
    #[serde(default)]
    pub memory: String,
    /// Seat fences (lock · hide · review).
    #[serde(default)]
    pub fence: SeatFence,
    /// Token budget per run; 0 means unset.
    #[serde(default)]
    pub budget: usize,
    /// Parallel copies allowed; 0 means unset.
    #[serde(default)]
    pub max_parallel: usize,
    /// Tags and colour ride through to the UI.
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub color: String,
}

impl SeatSpec {
    /// The id used everywhere: `<team>/<key>`.
    pub fn id(&self) -> String {
        format!("{}/{}", self.team, self.key)
    }
}

/// Merge every team's members into resolved seats: defaults → `[[team]]` →
/// member, last wins. Deterministic: teams and members in file order.
pub fn merge_config(cfg: &Config) -> Vec<SeatSpec> {
    let mut out = vec![];
    for t in &cfg.teams {
        for m in &t.members {
            out.push(SeatSpec {
                team: t.name.clone(),
                key: m.key().to_string(),
                agent: m.runner().to_string(),
                model: m.model.clone(),
                workflow: m.workflow.clone(),
                scope: m.scope.clone(),
                role: m.role.clone(),
                prompt: {
                    let mut p = String::new();
                    if !t.prompt.trim().is_empty() {
                        p.push_str(t.prompt.trim());
                        p.push('\n');
                    }
                    if !m.prompt.trim().is_empty() {
                        p.push_str(m.prompt.trim());
                        p.push('\n');
                    }
                    p.trim().to_string()
                },
                reports_to: m.reports_to.clone(),
                hands_off: m.hands_off.clone(),
                skills: m.skills.clone(),
                mcp: m.mcp.clone(),
                memory: m.memory.clone(),
                fence: m.fence.clone(),
                budget: m.budget,
                max_parallel: m.max_parallel,
                tags: m.tags.clone(),
                color: m.color.clone(),
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_connect_sets_the_default_and_later_ones_keep_it() {
        let dir = std::env::temp_dir().join(format!("kula-default-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("kula.toml"), "[agents]\nmemory = true\n").unwrap();
        default_agent_if_unset(&dir, "codex").unwrap();
        default_agent_if_unset(&dir, "claude").unwrap();
        let cfg = Config::load(&dir).unwrap();
        assert_eq!(cfg.agents.default, "codex");
        // a settings save that predates the field leaves it alone
        set_agents(&dir, &Agents { default: String::new(), ..cfg.agents.clone() }).unwrap();
        assert_eq!(Config::load(&dir).unwrap().agents.default, "codex");
        let any = Member { name: "Quill".into(), ..Default::default() };
        let pinned = Member { agent: "gemini".into(), ..Default::default() };
        assert_eq!(any.provider("codex"), "codex");
        assert_eq!(pinned.provider("codex"), "gemini");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_team_preview_is_byte_for_byte_what_a_save_writes() {
        let dir = std::env::temp_dir().join(format!("kula-preview-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let start = "# kept\n[agents]\nmemory = true\n";
        std::fs::write(dir.join("kula.toml"), start).unwrap();
        let lead = Member { name: "Atlas".into(), workflow: "fix".into(), ..Default::default() };
        let hand = Member { name: "Quill".into(), reports_to: "Atlas".into(), ..Default::default() };
        let teams = vec![Team { name: "ship".into(), members: vec![lead, hand], ..Default::default() }];
        let (before, after) = preview_teams(&dir, &teams).unwrap();
        assert_eq!(before, start);
        assert_eq!(std::fs::read_to_string(dir.join("kula.toml")).unwrap(), start, "a preview writes nothing");
        set_teams(&dir, &teams).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("kula.toml")).unwrap(), after);
        // a loop is refused before anything renders
        let mut bad = teams.clone();
        bad[0].members[0].reports_to = "Quill".into();
        assert!(preview_teams(&dir, &bad).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn hub_fields_round_trip_and_old_files_still_parse() {
        let dir = std::env::temp_dir().join(format!("kula-hub-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // an old file: no hub keys anywhere, and a comment that must survive
        let old = "# hand written\n[[team]]\nname = \"ship\"\nmembers = [{ name = \"Atlas\" }]\n";
        std::fs::write(dir.join("kula.toml"), old).unwrap();
        let cfg = Config::load(&dir).unwrap();
        assert_eq!(cfg.teams[0].members[0].fence, SeatFence::default());
        let mut teams = cfg.teams.clone();
        teams[0].color = "#f97f3a".into();
        teams[0].category = "build".into();
        let m = &mut teams[0].members[0];
        m.color = "#5aa0e0".into();
        m.tags = vec!["backend".into()];
        m.skills = vec!["review".into()];
        m.mcp = vec!["kula".into()];
        m.memory = "docs/atlas.md".into();
        m.fence.lock = vec!["migrations/**".into(), "charge_card".into()];
        set_teams(&dir, &teams).unwrap();
        let text = std::fs::read_to_string(dir.join("kula.toml")).unwrap();
        assert!(text.contains("# hand written"), "{text}");
        assert_eq!(Config::load(&dir).unwrap().teams, teams);
        // a seat with none of them writes none of them
        let plain =
            vec![Team { name: "bare".into(), members: vec![Member { name: "Q".into(), ..Default::default() }], ..Default::default() }];
        let (_, after) = preview_teams(&dir, &plain).unwrap();
        for k in ["color", "tags", "skills", "mcp", "memory", "fence", "category"] {
            assert!(!after.contains(k), "{k} written for an empty seat:\n{after}");
        }
        // bad values are refused
        let mut bad = teams.clone();
        bad[0].members[0].color = "orange".into();
        assert!(preview_teams(&dir, &bad).is_err());
        let mut bad = teams.clone();
        bad[0].members[0].memory = "../x.md".into();
        assert!(preview_teams(&dir, &bad).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
