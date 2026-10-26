//! `kula.toml` – the project's own settings, committed next to the code.
//!
//! Everything has a default, so a repo without the file behaves exactly as
//! before; `kula init` writes one so a team shares the same graph, hooks and
//! CI gate.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
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
    /// Saved marks from the logo studio (`[[logo]]`): where each SVG lives
    /// (`.kula/logos/<kind>/<name>.svg`) and the dials that produced it.
    #[serde(rename = "logo", default)]
    pub logos: Vec<Logo>,
    /// Built-in workflows hidden by name (`workflow_hide`); restorable.
    #[serde(default)]
    pub disabled: Vec<String>,
    /// `[embed]` – optional EmbeddingGemma embeddings for Syntagm (E1). Off by default.
    pub embed: Embed,
}

/// `[embed]` – the optional embedding engine behind Syntagm's refinement.
///
/// ```toml
/// [embed]
/// enabled = true       # off by default – nothing downloads without it
/// threads = 0          # 0 = max(1, cores / 4) – the machine stays responsive
/// batch = 16           # texts per embedding batch, capped at 64
/// pause_ms = 250       # pause between batches; the run stretches it under load
/// fast = false         # true = full speed: no pause, 64-text batches, all cores
/// ```
///
/// The defaults are gentle on purpose: small batches, a short pause and a
/// quarter of the cores, so embedding never makes the machine feel busy.
/// `fast = true` (or `kula embed run --fast`) restores full speed.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Embed {
    /// Embeddings are opt-in: nothing downloads or runs until this is true.
    pub enabled: bool,
    /// Bounded worker pool for embedding; 0 picks max(1, cores / 4) (all cores when fast).
    pub threads: usize,
    /// Texts per embedding batch (hard cap 64).
    pub batch: usize,
    /// Pause between batches, milliseconds; the adaptive loop may stretch it.
    pub pause_ms: u64,
    /// Full speed: skip pauses, use the full batch cap and every core.
    pub fast: bool,
}

impl Default for Embed {
    fn default() -> Self {
        Embed { enabled: false, threads: 0, batch: 16, pause_ms: 250, fast: false }
    }
}

impl Embed {
    /// Effective worker count: at most max(1, cores / 4) by default so the
    /// machine stays responsive; `fast` restores all cores.
    pub fn pool(&self) -> usize {
        let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
        if self.threads > 0 {
            self.threads
        } else if self.fast {
            cores
        } else {
            (cores / 4).max(1)
        }
    }
    /// Effective batch size, capped at 64 (embed::MAX_BATCH); `fast` takes the cap.
    pub fn batch_size(&self) -> usize {
        if self.fast {
            64
        } else if self.batch == 0 {
            16
        } else {
            self.batch.min(64)
        }
    }
    /// Pause between batches: none when fast, otherwise the configured pause.
    pub fn pause(&self) -> u64 {
        if self.fast {
            0
        } else {
            self.pause_ms
        }
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
    pub members: Vec<Member>,
    /// Where each member sits on the team canvas: workflow → [x, y]. Kept in
    /// kula.toml so the canvas remembers its arrangement.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub positions: BTreeMap<String, Vec<f64>>,
    /// The team's own fences: the same rules a `[[guard]]` holds, but they
    /// apply only to runs started from this team.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub fences: Vec<GuardRule>,
    /// Paths and globs the team may touch – its domain. Everything else is
    /// fenced for its runs, unless a fence says otherwise.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub domains: Vec<String>,
    /// How far the team may go: cost, turns, autonomy.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limits: Option<Limits>,
}

/// How far a team may go on its own.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Limits {
    /// The most one run from this team may cost (units are whatever the
    /// provider bills in); 0 for no cap.
    #[serde(skip_serializing_if = "is_zero_f64")]
    pub max_cost: f64,
    /// The most turns one run may take; 0 for no cap.
    #[serde(skip_serializing_if = "is_zero_usize")]
    pub max_turns: usize,
    /// How much the team may do without asking: ask (default) · act · full.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub autonomy: String,
}

fn is_zero_f64(n: &f64) -> bool {
    *n == 0.0
}

impl Limits {
    /// The autonomy level as stored: empty reads as `ask`. Kept for the
    /// guard's autonomy checks coming with wave 2.
    #[allow(dead_code)]
    pub fn autonomy(&self) -> &str {
        match self.autonomy.as_str() {
            "act" | "full" => &self.autonomy,
            _ => "ask",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Member {
    /// The seat's own name ("Atlas"): how teammates point at it. Optional –
    /// without one, the agent below is the name, as before.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub name: String,
    /// The service that runs this seat: claude · cursor · codex · gemini, any
    /// MCP client name, or `any` (empty) for whichever agent is connected.
    /// Fuse 5: this is the seat's own choice; agents no longer store one.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub service: String,
    /// The agent that runs it (pre-fuse-5 spelling). Still read; a saved team
    /// moves it onto `service`.
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
}

impl Member {
    /// How the team refers to this seat: its name, else the workflow it works
    /// in (the old `agent` spelling counts as a last resort, for configs
    /// written before seats had workflows). Never the service: two seats on
    /// the same service are two different people.
    pub fn key(&self) -> &str {
        if !self.name.is_empty() {
            &self.name
        } else if !self.workflow.is_empty() {
            &self.workflow
        } else {
            &self.agent
        }
    }
    /// The service that runs it, for people: `any` when unset. Fuse 5 spells
    /// it `service`; the old `agent` field still reads (the migration moves
    /// it onto `service` when a team is saved, and `load` normalises it).
    pub fn runner(&self) -> &str {
        let s = if self.service.is_empty() { &self.agent } else { &self.service };
        if s.is_empty() {
            "any"
        } else {
            s
        }
    }
    /// The provider that actually runs it: its own, else the repo default.
    pub fn provider<'a>(&'a self, default: &'a str) -> &'a str {
        match self.runner() {
            "any" if !default.is_empty() => default,
            r => r,
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
    /// Fuse 5: runs go out from teams. When true, a bare agent (no team) may
    /// still be deployed from the Workspace.
    pub allow_solo: bool,
    /// Settings the agents Settings tab may write into their own sections of
    /// kula.toml ([check], [index], [project], [embed]); None leaves the
    /// section alone, so older saves keep working.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_risk: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclude: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_file_kb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embed_pause_ms: Option<u64>,
}

impl Default for Agents {
    fn default() -> Self {
        Agents {
            hide_secrets: true,
            memory: true,
            docs: vec![],
            default: String::new(),
            allow_solo: false,
            max_risk: None,
            exclude: None,
            max_file_kb: None,
            default_branch: None,
            embed_pause_ms: None,
        }
    }
}

/// A saved logo's mark parameters, kept beside the SVG file in kula.toml.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Logo {
    /// agent · team · research – the folder and colour family it belongs to.
    pub kind: String,
    /// The name it was saved under (the SVG file's stem).
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<crate::logos::LogoParams>,
}

impl Default for Logo {
    fn default() -> Self {
        Logo { kind: "agent".into(), name: String::new(), params: None }
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
    /// The repo's `kula.toml`, or defaults when there is none. Fuse 5: seats
    /// that still spell their runner `agent =` read as `service` – the old
    /// field stays in the file until the team is next saved.
    pub fn load(root: &Path) -> Result<Config> {
        let p = root.join(FILE);
        let mut cfg = match std::fs::read_to_string(&p) {
            Ok(s) => toml::from_str::<Config>(&s).with_context(|| format!("reading {}", p.display()))?,
            Err(_) => Config::default(),
        };
        cfg.migrate();
        Ok(cfg)
    }

    /// Move old spellings onto the new ones, in memory: a seat's `agent`
    /// becomes its `service` when the seat has no service of its own yet.
    pub fn migrate(&mut self) {
        for t in &mut self.teams {
            for m in &mut t.members {
                if m.service.is_empty() && !m.agent.is_empty() {
                    m.service = m.agent.clone();
                }
            }
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
             # reason = \"schema changes go through the DBA\"\n\n\
             # [embed]\n\
             # enabled = false    # optional EmbeddingGemma for Syntagm – downloads a model when true\n",
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
    let mut seen = std::collections::HashSet::new();
    for t in teams {
        if !crate::workflow::valid_name(&t.name) {
            anyhow::bail!("team names are letters, digits, - and _: {:?}", t.name);
        }
        for r in &t.fences {
            if r.paths.is_empty() && r.symbols.is_empty() {
                anyhow::bail!("team {}: a fence needs paths or symbols", t.name);
            }
            if !matches!(r.level.as_str(), "locked" | "hidden" | "review") {
                anyhow::bail!("team {}: fence level must be locked, hidden or review, not {:?}", t.name, r.level);
            }
        }
        if !matches!(t.limits.as_ref().map(|l| l.autonomy.as_str()).unwrap_or("ask"), "" | "ask" | "act" | "full") {
            anyhow::bail!("team {}: autonomy must be ask, act or full", t.name);
        }
        if !seen.insert(&t.name) {
            anyhow::bail!("two teams are called {}", t.name);
        }
        if t.members.iter().any(|m| m.key().trim().is_empty()) {
            anyhow::bail!("team {}: every member has a name or a workflow", t.name);
        }
        let names: Vec<&str> = t.members.iter().map(|m| m.key()).collect();
        if let Some(d) = names.iter().enumerate().find(|(i, n)| names[..*i].contains(n)).map(|x| x.1) {
            anyhow::bail!("team {}: two members are called {d}", t.name);
        }
        for m in &t.members {
            // reports_to stays inside the team (it is the team's own
            // hierarchy); a hand-off may cross teams – quality's critics take
            // work from core and frontend, so any seat of any team is fair.
            if !m.reports_to.is_empty() && (!names.contains(&m.reports_to.as_str()) || m.reports_to == m.key()) {
                anyhow::bail!("team {}: {} reports to {:?}, which is not another member", t.name, m.key(), m.reports_to);
            }
        }
        let all_seats: Vec<&str> = teams.iter().flat_map(|t| t.members.iter().map(|m| m.key())).collect();
        for t in teams {
            for m in &t.members {
                for other in &m.hands_off {
                    if !all_seats.contains(&other.as_str()) || other == &m.key() {
                        anyhow::bail!("team {}: {} hands off to {other:?}, which is not another seat", t.name, m.key());
                    }
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
    // Save through the migrated shapes: old `agent =` spellings come back as
    // `service =` on every seat that had one.
    let migrated: Vec<Team> = teams
        .iter()
        .map(|t| Team {
            members: t
                .members
                .iter()
                .map(|m| Member { service: if m.service.is_empty() { m.agent.clone() } else { m.service.clone() }, ..m.clone() })
                .collect(),
            ..t.clone()
        })
        .collect();
    edit(root, |d| set_tables(d, "team", &migrated))
}

// ---------------------------------------------------------------- team edits
// Single-team actions for the Teams canvas (fuse4): each loads the config,
// mutates one team and saves through set_teams, so every rule (names, member
// keys, nesting, no loops) keeps holding.

/// Load the teams, hand them to `f` and save; `f` may error to refuse.
fn edit_teams<F>(root: &Path, f: F) -> Result<Config>
where
    F: FnOnce(&mut Vec<Team>) -> Result<()>,
{
    let cfg = Config::load(root)?;
    let mut teams = cfg.teams.clone();
    f(&mut teams)?;
    set_teams(root, &teams)
}

/// Create or replace one team by name.
pub fn upsert_team(root: &Path, team: &Team) -> Result<Config> {
    anyhow::ensure!(!team.name.trim().is_empty(), "a team needs a name");
    edit_teams(root, |teams| {
        teams.retain(|t| t.name != team.name);
        teams.push(team.clone());
        Ok(())
    })
}

/// Remove one team by name; removing a name that is not there is fine.
pub fn remove_team(root: &Path, name: &str) -> Result<Config> {
    edit_teams(root, |teams| {
        teams.retain(|t| t.name != name);
        Ok(())
    })
}

/// Add a seat working in `workflow`. With an `agent` it is that agent's seat;
/// without one the seat is named after the workflow (a seat must have a name
/// or an agent, and `any` twice would collide).
pub fn team_add_member(root: &Path, team: &str, workflow: &str, agent: &str) -> Result<Config> {
    anyhow::ensure!(!workflow.trim().is_empty(), "name the workflow the seat works in");
    let m = if agent.trim().is_empty() {
        crate::config::Member { name: workflow.trim().to_string(), workflow: workflow.trim().to_string(), ..Default::default() }
    } else {
        crate::config::Member { service: agent.trim().to_string(), workflow: workflow.trim().to_string(), ..Default::default() }
    };
    edit_teams(root, |teams| {
        let t = teams.iter_mut().find(|t| t.name == team).ok_or_else(|| anyhow!("no team {team:?}"))?;
        t.members.push(m);
        Ok(())
    })
}

/// Remove every seat of `team` that works in `workflow`; none is fine.
pub fn team_remove_member(root: &Path, team: &str, workflow: &str) -> Result<Config> {
    edit_teams(root, |teams| {
        let t = teams.iter_mut().find(|t| t.name == team).ok_or_else(|| anyhow!("no team {team:?}"))?;
        t.members.retain(|m| m.workflow != workflow);
        Ok(())
    })
}

/// Remember where the canvas dragged each member: workflow → [x, y].
pub fn set_team_layout(root: &Path, team: &str, positions: &BTreeMap<String, Vec<f64>>) -> Result<Config> {
    anyhow::ensure!(!team.trim().is_empty(), "name the team");
    edit_teams(root, |teams| {
        let t = teams.iter_mut().find(|t| t.name == team).ok_or_else(|| anyhow!("no team {team:?}"))?;
        t.positions = positions.clone();
        Ok(())
    })
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
        t["allow_solo"] = toml_edit::value(a.allow_solo);
        // The Settings view may also reach into the neighbouring sections;
        // left out means unchanged.
        if let Some(v) = &a.max_risk {
            let c = d.entry("check").or_insert(toml_edit::table()).as_table_mut().context("[check] must be a table")?;
            c["max_risk"] = toml_edit::value(v);
        }
        if a.exclude.is_some() || a.max_file_kb.is_some() {
            let i = d.entry("index").or_insert(toml_edit::table()).as_table_mut().context("[index] must be a table")?;
            if let Some(v) = &a.exclude {
                i["exclude"] = toml_edit::value(v.iter().collect::<toml_edit::Array>());
            }
            if let Some(v) = a.max_file_kb {
                i["max_file_kb"] = toml_edit::value(v as i64);
            }
        }
        if let Some(v) = &a.default_branch {
            let p = d.entry("project").or_insert(toml_edit::table()).as_table_mut().context("[project] must be a table")?;
            p["default_branch"] = toml_edit::value(v);
        }
        if let Some(v) = a.embed_pause_ms {
            let e = d.entry("embed").or_insert(toml_edit::table()).as_table_mut().context("[embed] must be a table")?;
            e["pause_ms"] = toml_edit::value(v as i64);
        }
        Ok(())
    })
}

/// Save the mark parameters under one saved logo (`[[logo]]`); the SVG file
/// itself lives in `.kula/logos/` (src/logos.rs). Creates or replaces the row.
pub fn set_logo_params(root: &Path, kind: crate::logos::Kind, name: &str, params: &crate::logos::LogoParams) -> Result<Config> {
    let row = Logo { kind: kind.as_str().into(), name: name.into(), params: Some(params.clone()) };
    edit(root, |d| {
        let mut rows: Vec<Logo> = {
            let cfg = Config::load(root).unwrap_or_default();
            cfg.logos
        };
        rows.retain(|l| !(l.kind == row.kind && l.name == row.name));
        rows.push(row);
        set_tables(d, "logo", &rows)
    })
}

/// Drop one logo's row (its file is removed by src/logos.rs remove).
/// Kept for the logo_delete route planned with the studio UI.
#[allow(dead_code)]
pub fn remove_logo(root: &Path, kind: crate::logos::Kind, name: &str) -> Result<()> {
    edit(root, |d| {
        let mut rows: Vec<Logo> = {
            let cfg = Config::load(root).unwrap_or_default();
            cfg.logos
        };
        rows.retain(|l| !(l.kind == kind.as_str() && l.name == name));
        set_tables(d, "logo", &rows)
    })
    .map(|_| ())
}

/// Hide a built-in workflow by name (`disabled = [...]` in kula.toml); it
/// stays defined and can come back with `restore_workflow`.
pub fn disable_workflow(root: &Path, name: &str) -> Result<Config> {
    edit(root, |d| {
        let mut names: Vec<String> = Config::load(root).unwrap_or_default().disabled;
        if !names.iter().any(|n| n == name) {
            names.push(name.to_string());
        }
        d["disabled"] = toml_edit::value(names.iter().collect::<toml_edit::Array>());
        Ok(())
    })
}

/// Bring a hidden built-in back.
pub fn restore_workflow(root: &Path, name: &str) -> Result<Config> {
    edit(root, |d| {
        let names: Vec<String> = Config::load(root).unwrap_or_default().disabled.into_iter().filter(|n| n != name).collect();
        if names.is_empty() {
            d.remove("disabled");
        } else {
            d["disabled"] = toml_edit::value(names.iter().collect::<toml_edit::Array>());
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
    fn team_edits_round_trip_and_keep_positions() {
        let dir = std::env::temp_dir().join(format!("kula-team-edit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("kula.toml"), "[agents]\nmemory = true\n").unwrap();
        let team = |name: &str| Team {
            name: name.into(),
            members: vec![Member { name: "Atlas".into(), workflow: "explore".into(), ..Default::default() }],
            ..Default::default()
        };
        upsert_team(&dir, &team("ship")).unwrap();
        team_add_member(&dir, "ship", "tests", "cursor").unwrap();
        let mut pos = BTreeMap::new();
        pos.insert("explore".to_string(), vec![120.0, 240.5]);
        pos.insert("tests".to_string(), vec![400.0, 80.0]);
        set_team_layout(&dir, "ship", &pos).unwrap();
        let cfg = Config::load(&dir).unwrap();
        let t = cfg.teams.iter().find(|t| t.name == "ship").unwrap();
        assert_eq!(t.members.len(), 2);
        assert_eq!(t.positions.get("explore").unwrap(), &vec![120.0, 240.5]);
        // the toml text keeps the positions so a hand-written file round-trips
        let text = std::fs::read_to_string(dir.join("kula.toml")).unwrap();
        assert!(text.contains("positions"), "{text}");
        team_remove_member(&dir, "ship", "tests").unwrap();
        assert_eq!(Config::load(&dir).unwrap().teams[0].members.len(), 1);
        // removing a team twice is fine
        remove_team(&dir, "ship").unwrap();
        remove_team(&dir, "ship").unwrap();
        assert!(Config::load(&dir).unwrap().teams.is_empty());
        assert!(team_add_member(&dir, "ship", "tests", "cursor").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// fuse5 · Remove one saved workflow by name. Built-ins are hidden, not
/// removed: their name lands in `disabled` and `restore_workflow` brings
/// them back. A kula.toml workflow is deleted outright.
pub fn workflow_delete(root: &Path, name: &str) -> Result<Config> {
    let cfg = Config::load(root)?;
    let is_builtin = crate::workflow::builtin().iter().any(|w| w.name == name);
    let saved = cfg.workflows.iter().any(|w| w.name == name);
    if is_builtin {
        // hidden, not removed – restorable; a saved override goes too
        if saved {
            edit(root, |d| {
                let left: Vec<crate::workflow::Workflow> =
                    Config::load(root).unwrap_or_default().workflows.into_iter().filter(|w| w.name != name).collect();
                set_tables(d, "workflow", &left)
            })?;
        }
        disable_workflow(root, name)
    } else if saved {
        edit(root, |d| {
            let mut left: Vec<crate::workflow::Workflow> =
                Config::load(root).unwrap_or_default().workflows.into_iter().filter(|w| w.name != name).collect();
            left.retain(|w| w.name != name);
            set_tables(d, "workflow", &left)
        })
    } else {
        anyhow::bail!("no workflow called {name:?}")
    }
}

#[cfg(test)]
mod b2_tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("kula-b2-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(
            d.join("kula.toml"),
            "[agents]\nmemory = true\n\n[[team]]\nname = \"ship\"\nmembers = [{ agent = \"claude\", workflow = \"tests\" }]\n",
        )
        .unwrap();
        d
    }

    /// fuse5 · team_save accepts fences, domains and limits; validation holds.
    #[test]
    fn team_save_takes_fences_domains_and_limits() {
        let dir = tmp("fences");
        let t = Team {
            name: "ship".into(),
            members: vec![Member { name: "atlas".into(), workflow: "tests".into(), ..Default::default() }],
            fences: vec![GuardRule {
                paths: vec!["migrations/**".into()],
                level: "locked".into(),
                reason: "schema is the DBA's".into(),
                ..Default::default()
            }],
            domains: vec!["src/**".into()],
            limits: Some(Limits { max_cost: 5.0, max_turns: 40, autonomy: "act".into() }),
            ..Default::default()
        };
        upsert_team(&dir, &t).unwrap();
        let cfg = Config::load(&dir).unwrap();
        let got = cfg.teams.iter().find(|t| t.name == "ship").unwrap();
        assert_eq!(got.fences[0].paths, vec!["migrations/**".to_string()]);
        assert_eq!(got.domains, vec!["src/**".to_string()]);
        assert_eq!(got.limits.as_ref().unwrap().max_turns, 40);
        assert_eq!(got.limits.as_ref().unwrap().autonomy(), "act");
        // a bad level or autonomy is refused, and the file is untouched
        let mut bad = t.clone();
        bad.fences[0].level = "open".into();
        assert!(upsert_team(&dir, &bad).is_err());
        bad.fences[0].level = "locked".into();
        bad.limits = Some(Limits { autonomy: "yolo".into(), ..Default::default() });
        assert!(upsert_team(&dir, &bad).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// fuse5 · an old seat spelled `agent =` reads as `service`, and saving
    /// the team persists the move while the old field stays readable.
    #[test]
    fn old_agent_fields_migrate_onto_seat_service() {
        let dir = tmp("migrate");
        let cfg = Config::load(&dir).unwrap();
        let seat = &cfg.teams[0].members[0];
        assert_eq!(seat.service, "claude", "the load migration fills service from agent");
        assert_eq!(seat.runner(), "claude");
        // Fuse 5 B3: a seat is keyed by its name, else its workflow – never
        // its service, so two seats on the same service do not collide.
        assert_eq!(seat.key(), "tests");
        // saving keeps the old field (older kula builds still read it)
        upsert_team(&dir, &cfg.teams[0]).unwrap();
        let text = std::fs::read_to_string(dir.join("kula.toml")).unwrap();
        assert!(text.contains("service = \"claude\""), "{text}");
        assert!(text.contains("agent = \"claude\""), "the old field stays: {text}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// fuse5 B3 · seats are keyed by name (else workflow), never the service:
    /// two seats on the same service are allowed and distinct.
    #[test]
    fn seats_keyed_by_name_not_service() {
        let dir = tmp("seats");
        let t = Team {
            name: "ship".into(),
            members: vec![
                Member { name: "atlas".into(), service: "claude".into(), workflow: "fix".into(), ..Default::default() },
                Member { name: "bestla".into(), service: "claude".into(), workflow: "polish".into(), ..Default::default() },
                Member { service: "codex".into(), workflow: "tests".into(), ..Default::default() },
            ],
            ..Default::default()
        };
        upsert_team(&dir, &t).unwrap();
        let cfg = Config::load(&dir).unwrap();
        let got = cfg.teams.iter().find(|t| t.name == "ship").unwrap();
        let keys: Vec<&str> = got.members.iter().map(|m| m.key()).collect();
        assert_eq!(keys, vec!["atlas", "bestla", "tests"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// fuse5 B3 · settings_save reaches into the neighbouring sections
    /// (check/index/project/embed); left out means unchanged.
    #[test]
    fn settings_save_writes_cross_section_fields() {
        let dir = tmp("settings");
        let a = Agents {
            hide_secrets: false,
            memory: false,
            docs: vec![],
            default: String::new(),
            allow_solo: true,
            max_risk: Some("low".into()),
            exclude: Some(vec!["vendor/**".into()]),
            max_file_kb: Some(512),
            default_branch: Some("trunk".into()),
            embed_pause_ms: Some(400),
        };
        set_agents(&dir, &a).unwrap();
        let text = std::fs::read_to_string(dir.join("kula.toml")).unwrap();
        assert!(text.contains("max_risk = \"low\""), "{text}");
        assert!(text.contains("vendor/**"), "{text}");
        assert!(text.contains("max_file_kb = 512"), "{text}");
        assert!(text.contains("default_branch = \"trunk\""), "{text}");
        assert!(text.contains("pause_ms = 400"), "{text}");
        assert!(text.contains("allow_solo = true"), "{text}");
        let cfg = Config::load(&dir).unwrap();
        assert_eq!(cfg.check.max_risk, "low");
        assert_eq!(cfg.index.max_file_kb, 512);
        assert_eq!(cfg.project.default_branch, "trunk");
        assert_eq!(cfg.embed.pause_ms, 400);
        // a second save that leaves the fields out keeps them
        set_agents(&dir, &Agents { hide_secrets: true, memory: false, ..Default::default() }).unwrap();
        let text = std::fs::read_to_string(dir.join("kula.toml")).unwrap();
        assert!(text.contains("pause_ms = 400"), "{text}");
        let _ = std::fs::remove_dir_all(&dir);
    }
    #[test]
    /// fuse5 · workflow_delete: a kula.toml workflow goes, a built-in is
    /// hidden and restorable.
    fn workflow_delete_hides_builtins_and_removes_customs() {
        let dir = tmp("wdel");
        workflow_delete(&dir, "fix").unwrap();
        let cfg = Config::load(&dir).unwrap();
        assert!(crate::workflow::all(&cfg).iter().all(|w| w.name != "fix"), "the built-in is hidden");
        assert_eq!(cfg.disabled, vec!["fix".to_string()]);
        restore_workflow(&dir, "fix").unwrap();
        let cfg = Config::load(&dir).unwrap();
        assert!(crate::workflow::all(&cfg).iter().any(|w| w.name == "fix"), "restored");
        // a custom workflow is removed outright
        let w = crate::workflow::Workflow { name: "mine".into(), about: "x".into(), ..Default::default() };
        set_workflows(&dir, &[w]).unwrap();
        workflow_delete(&dir, "mine").unwrap();
        assert!(Config::load(&dir).unwrap().workflows.is_empty());
        // and a missing name is refused
        assert!(workflow_delete(&dir, "nonesuch").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod b3_tests {
    use super::*;

    /// fuse5 B3 · the committed kula.toml (kula's own agentic setup) parses,
    /// and every reference in it resolves: team tree, seats, @scopes.
    #[test]
    fn committed_kula_toml_loads() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let cfg = Config::load(root).unwrap_or_else(|e| panic!("the committed kula.toml does not load: {e}"));
        assert_eq!(cfg.project.name, "kula");
        assert_eq!(cfg.teams.len(), 6, "the dogfood setup wires six teams");
        for t in &cfg.teams {
            assert!(!t.members.is_empty(), "team {} has no seats", t.name);
            for m in &t.members {
                assert!(!m.key().trim().is_empty(), "team {}: a seat has an empty name", t.name);
                assert!(
                    m.workflow.is_empty() || crate::workflow::all(&cfg).iter().any(|w| w.name == m.workflow),
                    "team {}: seat {} works in {}, which is not a workflow",
                    t.name,
                    m.key(),
                    m.workflow
                );
                let names: Vec<&str> = t.members.iter().map(|m| m.key()).collect();
                let all_seats: Vec<&str> = cfg.teams.iter().flat_map(|x| x.members.iter().map(|m| m.key())).collect();
                // reports_to is the team's own hierarchy; a hand-off may cross teams
                assert!(m.reports_to.is_empty() || (names.contains(&m.reports_to.as_str()) && m.reports_to != m.key()), "team {}: reports_to {:?} is not another seat", t.name, m.reports_to);
                for other in &m.hands_off {
                    assert!(all_seats.contains(&other.as_str()) && other != &m.key(), "team {}: hands_off {other:?} is not another seat", t.name);
                }
            }
            if !t.under.is_empty() {
                assert!(cfg.teams.iter().any(|x| x.name == t.under && x.name != t.name), "team {}: under {:?} is not a team", t.name, t.under);
            }
        }
        // every @scope a workflow or seat uses names a [[scope]]
        let scopes: Vec<&str> = cfg.scopes.iter().map(|s| s.name.as_str()).collect();
        for w in crate::workflow::all(&cfg) {
            for s in &w.scope {
                if let Some(name) = s.strip_prefix('@') {
                    assert!(scopes.contains(&name), "workflow {} uses @{name}, which is not a [[scope]]", w.name);
                }
            }
        }
    }
}
