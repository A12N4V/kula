//! kula – git, with a map.

mod agent;
mod agent_config;
mod agents;
mod cache;
mod clean;
mod config;
mod git;
mod graph;
mod guard;
mod index;
mod isolate;
mod kg;
mod mcp;
mod memory;
mod meta;
mod project;
mod research;
mod run;
mod server;
mod setup;
mod skills;
mod store;
mod term;
mod workflow;

use anyhow::{bail, Result};
use clap::{Parser, Subcommand};
use git::Repo;
use store::Store;
use term::*;

/// `kula --help`: the commands grouped by what you're doing, not alphabetically.
const HELP: &str = "\
{before-help}kula {version} – git, with a map

{usage-heading} {usage}

Start
  init         set kula up here: kula.toml, git hooks, MCP + agent hook, CI, first graph
  index        build or rebuild the knowledge graph
  view         open the web UI (graph, changes, history, agents)
  status       branch, changes and whether the graph is current
  hooks        git hooks that keep the graph current: install | uninstall | status
  doctor       check the environment

Explore the code
  query        search symbols and files
  context      everything about one symbol: callers, callees, container, source
  impact       what breaks if a symbol changes (--down: what it depends on)
  trace        shortest call path between two symbols
  flows        execution flows from entry points
  clusters     functional clusters
  deps         external packages: imported, declared, unused
  kg           the graph as RDF: export it, or ask it in SPARQL

Review changes
  lg           commit graph
  compare      graph-aware branch comparison
  graph-diff   contrast the graphs of two revisions (WORKTREE for uncommitted)
  check        CI gate: blast radius against a base, and guarded code

Work with AI agents
  pack         the code a task needs, fitted to a token budget
  before       before editing a symbol: callers, tests, risk, guards, memories
  verify       after editing: what moved, what broke, what was fenced
  agents       connect Claude Code, Cursor, Codex, Gemini; sync AGENTS.md; suggestions
  workflow     work modes: explore, fix, refactor, tests, docs, autoresearch, your own
  team         agent teams: each agent in its own workflow
  research     autoresearch: an agent improves a metric, kula measures and keeps score
  run          run any agent harness held to kula's fences: kula run -w fix -- aider
  task         the task an agent is on, its workflow, and the code it may change
  guard        fences agents may not cross: list, check, the pre-tool and pre-commit hooks
  memory       facts about the code that agents keep, marked stale when it changes
  mcp          serve all of this to agents over MCP (stdio)

Collaborate, stored in git
  issue  pr  note  sync

Everything else is git: `kula commit -am fix`, `kula rebase -i main` and any other
git command pass straight through (`kula git <args>` to be explicit).

Options:
{options}
";

#[derive(Parser)]
#[command(
    name = "kula",
    version,
    about = "git, with a map – a local-first git client with a knowledge-graph view",
    long_about = None,
    help_template = HELP,
)]
struct Cli {
    /// Run as if started in this directory.
    #[arg(short = 'C', global = true, value_name = "PATH")]
    dir: Option<std::path::PathBuf>,
    /// Emit JSON instead of human output (graph commands).
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    cmd: Option<Cmd>,
}

#[derive(Subcommand)]
enum Cmd {
    /// Set kula up in this project: kula.toml, hooks, MCP, CI, first graph (like `npm init`).
    #[command(after_help = "Examples:\n  kula init -y --hooks --agents --ci github")]
    Init {
        /// Accept every default without asking.
        #[arg(short, long)]
        yes: bool,
        /// Install git hooks that reindex after commit/checkout/merge.
        #[arg(long, overrides_with = "no_hooks")]
        hooks: bool,
        #[arg(long)]
        no_hooks: bool,
        /// Register the MCP server in .mcp.json for AI agents.
        #[arg(long, overrides_with = "no_agents")]
        agents: bool,
        #[arg(long)]
        no_agents: bool,
        /// Add a CI check: github | gitlab | none.
        #[arg(long, value_name = "PROVIDER")]
        ci: Option<String>,
        /// Don't build the graph at the end.
        #[arg(long)]
        no_index: bool,
    },
    /// Build or rebuild the knowledge graph (.kula/graph.db).
    #[command(after_help = "Examples:\n  kula index          ·  kula index --if-stale --quiet   (what the hooks run)")]
    Index {
        /// Only rebuild when HEAD moved since the last index (what the hooks run).
        #[arg(long)]
        if_stale: bool,
        /// Print nothing.
        #[arg(short, long)]
        quiet: bool,
    },
    /// External packages: who imports them, and whether manifests declare them.
    #[command(after_help = "Examples:\n  kula deps --undeclared   ·  kula deps --unused")]
    Deps {
        /// Only packages imported but not declared in any manifest.
        #[arg(long)]
        undeclared: bool,
        /// Only packages declared but never imported by indexed code.
        #[arg(long)]
        unused: bool,
    },
    /// Agent context: the code a task needs, ranked by graph distance and fitted to a token budget.
    #[command(after_help = "Examples:\n  kula pack \"how does login validate a token\" --budget 6000")]
    Pack {
        /// Symbols, files or a question.
        #[arg(required = true)]
        targets: Vec<String>,
        #[arg(short, long, default_value_t = 6000)]
        budget: usize,
    },
    /// Before editing a symbol: callers, tests that reach it, co-changing files, risk, advice.
    #[command(after_help = "Examples:\n  kula before hashToken")]
    Before { symbol: String },
    /// After editing: the worktree against HEAD through the graph; exits 2 on dangling callers.
    #[command(after_help = "Examples:\n  kula verify")]
    Verify,
    /// CI gate: the graph blast radius of HEAD against a base; fails above max_risk.
    #[command(after_help = "Examples:\n  kula check --base origin/main --md   ·  kula check --max-risk low")]
    Check {
        /// Base ref (defaults to kula.toml's default_branch).
        #[arg(long)]
        base: Option<String>,
        /// none | low | medium | high (defaults to kula.toml's check.max_risk).
        #[arg(long)]
        max_risk: Option<String>,
        /// Markdown for a PR comment or job summary.
        #[arg(long)]
        md: bool,
    },
    /// Git hooks that keep the graph current: install | uninstall | status.
    #[command(after_help = "Examples:\n  kula hooks install   ·  kula hooks status")]
    Hooks {
        #[arg(default_value = "status")]
        action: String,
    },
    /// Open the web UI (graph, changes, history, branches, issues, notes).
    #[command(after_help = "Examples:\n  kula view   ·  kula view --port 7420 --no-open")]
    View {
        #[arg(short, long, default_value_t = 7420)]
        port: u16,
        /// Don't open a browser.
        #[arg(long)]
        no_open: bool,
    },
    /// Repository overview: branch, changes, index freshness.
    #[command(after_help = "Examples:\n  kula status   ·  kula status --json")]
    Status,
    /// Pretty commit graph.
    #[command(after_help = "Examples:\n  kula lg -n 40")]
    Lg {
        #[arg(short = 'n', default_value_t = 20)]
        limit: usize,
    },
    /// Search symbols and files.
    #[command(after_help = "Examples:\n  kula query token   ·  kula query \"login session\" --limit 30")]
    Query {
        text: Vec<String>,
        #[arg(short, long, default_value_t = 15)]
        limit: usize,
    },
    /// 360° view of a symbol: callers, callees, container, source.
    #[command(after_help = "Examples:\n  kula context hashToken")]
    Context { symbol: String },
    /// Blast radius of changing a symbol.
    #[command(after_help = "Examples:\n  kula impact salt   ·  kula impact salt --down --depth 2")]
    Impact {
        symbol: String,
        /// Follow dependencies (what it uses) instead of dependents.
        #[arg(long)]
        down: bool,
        #[arg(short, long, default_value_t = 3)]
        depth: usize,
    },
    /// Shortest call path between two symbols.
    #[command(after_help = "Examples:\n  kula trace handleLogin salt")]
    Trace { from: String, to: String },
    /// Execution flows discovered from entry points.
    #[command(after_help = "Examples:\n  kula flows   ·  kula flows --limit 20")]
    Flows {
        #[arg(short, long, default_value_t = 10)]
        limit: usize,
    },
    /// Functional clusters (communities) in the codebase.
    #[command(after_help = "Examples:\n  kula clusters")]
    Clusters,
    /// Graph-aware branch comparison.
    #[command(after_help = "Examples:\n  kula compare main   ·  kula compare main feature/auth")]
    Compare { base: String, head: Option<String> },
    /// Contrast the knowledge graphs of two revisions (use WORKTREE for uncommitted code).
    #[command(after_help = "Examples:\n  kula graph-diff main   ·  kula graph-diff main WORKTREE --all")]
    #[command(name = "graph-diff", alias = "gdiff")]
    GraphDiff {
        base: String,
        head: Option<String>,
        /// Also list unchanged symbols' counts per file.
        #[arg(long)]
        all: bool,
    },
    /// Isolate part of the graph: a path, a cluster, a symbol's neighbourhood or a branch's diff, with its boundary.
    #[command(
        after_help = "Examples:\n  kula graph isolate src/auth/**\n  kula graph isolate symbol:login~2 cluster:worker\n  kula graph isolate diff:main --save review\n  kula graph scopes"
    )]
    #[command(subcommand)]
    Graph(GraphCmd),
    /// Local issues stored in git.
    #[command(after_help = "Examples:\n  kula issue new \"login fails on empty token\" --label bug --anchor src/auth.rs:login")]
    #[command(subcommand)]
    Issue(IssueCmd),
    /// Proposals – local pull requests between branches.
    #[command(after_help = "Examples:\n  kula pr new \"split auth\" --base main")]
    #[command(subcommand, name = "pr", alias = "proposal")]
    Pr(PrCmd),
    /// Notes & annotations on the repo, files, symbols or commits.
    #[command(after_help = "Examples:\n  kula note add repo \"we are mid-migration off the legacy pool\"")]
    #[command(subcommand)]
    Note(NoteCmd),
    /// Fences for AI agents (kula.toml [[guard]]): list them, check paths, or run as an agent's pre-edit hook.
    #[command(after_help = "Examples:\n  kula guard list   ·  kula guard check src/billing.rs")]
    #[command(subcommand)]
    Guard(GuardCmd),
    /// The task an agent is on, its workflow, and the part of the code it may change.
    #[command(after_help = "Examples:\n  kula task start \"split auth\" --workflow refactor --scope \"src/auth/**\"")]
    #[command(subcommand)]
    Task(TaskCmd),
    /// Work modes for agents: each brings its own fences, scope, steps, docs and memory policy.
    #[command(after_help = "Examples:\n  kula workflow list   ·  kula workflow show refactor")]
    #[command(subcommand, alias = "wf")]
    Workflow(WorkflowCmd),
    /// Agent teams (kula.toml [[team]]): each agent works in its own workflow.
    #[command(after_help = "Examples:\n  kula team save ship -m claude=fix:lead -m cursor=tests   ·  kula team start ship")]
    #[command(subcommand)]
    Team(TeamCmd),
    /// Autoresearch: an agent changes code, kula runs the metric and keeps what's better.
    #[command(after_help = "Examples:\n  kula research init --metric \"cargo test --quiet\" --goal min --scope \"src/**\"")]
    #[command(subcommand)]
    Research(ResearchCmd),
    /// One set of skills for every agent: .agents/skills, synced to each agent's own place.
    #[command(
        after_help = "Examples:\n  kula skill list  ·  kula skill new release-notes -d \"Write release notes from merged PRs\"  ·  kula skill sync  ·  kula skill adopt claude triage"
    )]
    #[command(subcommand)]
    Skill(SkillCmd),
    /// Run any agent harness held to kula's fences: `kula run -w fix -- aider`.
    #[command(after_help = "Examples:\n  kula run -w fix --agent aider -- aider")]
    Run {
        /// The workflow to work in (starts a task in it).
        #[arg(short, long)]
        workflow: Option<String>,
        /// Who is running: claude, cursor, codex, gemini, aider, …
        #[arg(short, long, default_value = "agent")]
        agent: String,
        /// The task's title.
        #[arg(short, long)]
        title: Option<String>,
        #[arg(trailing_var_arg = true, allow_hyphen_values = true, required = true)]
        cmd: Vec<String>,
    },
    /// Bring any agent to kula: connect it, sync AGENTS.md, review what agents suggest.
    #[command(after_help = "Examples:\n  kula agents connect all   ·  kula agents sync")]
    #[command(subcommand)]
    Agents(AgentsCmd),
    /// Agent memories pinned to symbols and files; marked stale when that code changes.
    #[command(after_help = "Examples:\n  kula memory add charge_card \"amounts are integer cents\"")]
    #[command(subcommand, alias = "mem")]
    Memory(MemoryCmd),
    /// The knowledge graph as RDF: export Turtle / JSON-LD / N-Triples, or query it in SPARQL.
    #[command(after_help = "Examples:\n  kula kg export -f ttl -o graph.ttl   ·  kula kg examples")]
    #[command(subcommand)]
    Kg(KgCmd),
    /// Pull what others shared: issues, memories and the agent setup (skills,
    /// MCP servers, instruction files), then regenerate every agent's copy.
    /// Never pushes. After a fork: `kula sync upstream`.
    #[command(after_help = "Examples:\n  kula sync   ·  kula sync upstream   ·  kula sync --overwrite")]
    Sync {
        #[arg(default_value = "origin")]
        remote: String,
        /// Replace setup files you changed locally with the shared versions.
        #[arg(long)]
        overwrite: bool,
    },
    /// Publish this repo's agent setup, issues and memories to a remote, so
    /// anyone who clones or forks gets them with `kula sync`. Private until you do.
    #[command(after_help = "Examples:\n  kula share   ·  kula share upstream")]
    Share {
        #[arg(default_value = "origin")]
        remote: String,
    },
    /// Serve the graph to AI agents over MCP (stdio).
    #[command(after_help = "Examples:\n  kula mcp")]
    Mcp,
    /// Check the environment.
    #[command(after_help = "Examples:\n  kula doctor")]
    Doctor,
    /// Free disk space: old `kula run` snapshots, temp files, a compacted store.
    /// `kula view` does this by itself after the idle timer (Settings → Disk).
    #[command(
        after_help = "Examples:\n  kula clean   ·  kula clean --all   ·  kula clean --after 30   ·  kula clean --after 0 (timer off)"
    )]
    Clean {
        /// Remove every kept run, not only those older than the timer
        #[arg(long)]
        all: bool,
        /// Set the idle timer in minutes (0 turns auto-clean off) and exit
        #[arg(long, value_name = "MIN")]
        after: Option<u32>,
        /// Show what would go without removing anything
        #[arg(long)]
        dry_run: bool,
    },
    /// Deep compaction: prune superseded research experiments from finished
    /// runs, dedupe exact-duplicate memories, compact the graph store.
    /// Nothing user-made goes that a live run still references, and every
    /// removal is reported (memory dedupe is its own commit on refs/kula/meta).
    #[command(after_help = "Examples:\n  kula gc   ·  kula gc --dry-run")]
    Gc {
        /// Show what would go without removing anything
        #[arg(long)]
        dry_run: bool,
    },
    /// Explicit git passthrough: `kula git <args>`.
    #[command(after_help = "Examples:\n  kula git stash list")]
    Git {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    #[command(external_subcommand)]
    External(Vec<String>),
}

#[derive(Subcommand)]
enum IssueCmd {
    /// Open an issue.
    #[command(after_help = "Examples:\n  kula issue new \"login fails on empty token\" --label bug --anchor src/auth.rs:login")]
    New {
        title: String,
        #[arg(short, long, default_value = "")]
        body: String,
        #[arg(short, long)]
        label: Vec<String>,
        /// Anchor to a symbol or file.
        #[arg(short, long)]
        anchor: Vec<String>,
    },
    /// List issues.
    #[command(after_help = "Examples:\n  kula issue list   ·  kula issue list --all")]
    List {
        #[arg(long)]
        all: bool,
    },
    /// Show one issue.
    #[command(after_help = "Examples:\n  kula issue show 3")]
    Show { id: u64 },
    /// Close an issue.
    #[command(after_help = "Examples:\n  kula issue close 3")]
    Close { id: u64 },
    /// Reopen an issue.
    #[command(after_help = "Examples:\n  kula issue reopen 3")]
    Reopen { id: u64 },
    /// Comment on an issue.
    #[command(after_help = "Examples:\n  kula issue comment 3 \"reproduced on 1.2\"")]
    Comment { id: u64, body: String },
}

#[derive(Subcommand)]
enum PrCmd {
    /// Propose merging HEAD (or --head) into --base.
    #[command(after_help = "Examples:\n  kula pr new \"split auth\" --base main")]
    New {
        title: String,
        #[arg(long, default_value = "main")]
        base: String,
        #[arg(long)]
        head: Option<String>,
        #[arg(short, long, default_value = "")]
        body: String,
    },
    /// List proposals.
    #[command(after_help = "Examples:\n  kula pr list   ·  kula pr list --all")]
    List {
        #[arg(long)]
        all: bool,
    },
    /// Show a proposal with its graph impact.
    #[command(after_help = "Examples:\n  kula pr show 2")]
    Show { id: u64 },
    /// Merge (no-ff) into the base branch.
    #[command(after_help = "Examples:\n  kula pr merge 2")]
    Merge { id: u64 },
    #[command(after_help = "Examples:\n  kula pr close 2")]
    Close { id: u64 },
    /// Comment on a proposal.
    #[command(after_help = "Examples:\n  kula pr comment 2 \"needs a rebase first\"")]
    Comment { id: u64, body: String },
}

#[derive(Subcommand)]
enum GuardCmd {
    /// Every guard rule, the active task, and the files they fence.
    #[command(after_help = "Examples:\n  kula guard list")]
    List,
    /// Exit 1 if an agent may not edit these paths (or the staged files).
    #[command(after_help = "Examples:\n  kula guard check src/billing.rs   ·  kula guard check --staged")]
    Check {
        paths: Vec<String>,
        /// Check the files staged for commit.
        #[arg(long)]
        staged: bool,
    },
    /// Git pre-commit hook: refuse an agent's commit that holds fenced changes.
    #[command(after_help = "Examples:\n  kula guard commit")]
    Commit,
    /// Agent pre-tool hook: reads the tool call as JSON on stdin, exits 2 to block a fenced edit or read.
    #[command(
        after_help = "Examples:\n  echo '{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"migrations/1.sql\"}}' | kula guard hook"
    )]
    Hook {
        /// claude | cursor | codex | gemini (only changes the reply format; payloads are detected).
        #[arg(long, default_value = "claude")]
        agent: String,
        /// Treat the call as a read (Cursor's beforeReadFile).
        #[arg(long)]
        read: bool,
    },
}

#[derive(Subcommand)]
enum WorkflowCmd {
    /// Every workflow: built in and from kula.toml.
    #[command(after_help = "Examples:\n  kula workflow list")]
    List,
    /// One workflow: fences, scope, steps, docs, memory policy.
    #[command(after_help = "Examples:\n  kula workflow show refactor")]
    Show { name: String },
    /// Install a workflow as each agent's own: a Claude Code subagent, a Cursor rule, a Gemini command.
    #[command(after_help = "Examples:\n  kula workflow install refactor   ·  kula workflow install fix claude cursor")]
    Install {
        name: String,
        /// claude, cursor, gemini, or all.
        #[arg(default_value = "all")]
        agents: Vec<String>,
    },
    /// The workflow as instructions, for any harness's system prompt.
    #[command(after_help = "Examples:\n  kula workflow prompt refactor")]
    Prompt { name: String },
}

#[derive(Subcommand)]
enum TeamCmd {
    /// Every team in kula.toml, and the active one.
    List,
    /// Save a team: --member agent=workflow[:role], once per agent.
    Save {
        name: String,
        #[arg(long, default_value = "")]
        about: String,
        #[arg(short, long, required = true)]
        member: Vec<String>,
        /// The agent the others answer to.
        #[arg(long)]
        lead: Option<String>,
        /// Instructions every member gets.
        #[arg(long)]
        prompt: Option<String>,
        /// The team this one answers to ("" for none): teams nest into a society.
        #[arg(long)]
        under: Option<String>,
    },
    /// Put a team to work: each member agent now works in its own workflow.
    Start { name: String },
    /// Stand the team down.
    Stop,
    /// One member's full instructions: the team's prompt, its own, its place, its workflow.
    Prompt { name: String, agent: String },
}

#[derive(Subcommand)]
enum SkillCmd {
    /// Every skill, and whether each agent has the current copy.
    List,
    /// Start a skill in .agents/skills and share it with every agent.
    New {
        name: String,
        /// When an agent should use it – agents pick skills by this.
        #[arg(short, long)]
        description: String,
    },
    /// Write every skill where each agent reads it.
    Sync,
    /// Take a skill one agent already has into the shared set.
    Adopt { agent: String, name: String },
    /// Remove a skill from the set and from every agent.
    Rm { name: String },
}

#[derive(Subcommand)]
enum ResearchCmd {
    /// Make a workflow an autoresearch loop: the metric, which way is better, the scope.
    Init {
        /// A shell command; the last number it prints is the result.
        #[arg(short, long)]
        metric: String,
        /// min or max.
        #[arg(short, long, default_value = "min")]
        goal: String,
        /// What agents may change (globs or symbols).
        #[arg(short, long, num_args = 1..)]
        scope: Vec<String>,
        /// Experiments before it stops (0: no limit).
        #[arg(short, long, default_value_t = 0)]
        budget: u32,
        /// Seconds per run of the metric.
        #[arg(long, default_value_t = 600)]
        timeout: u64,
        #[arg(long, default_value = "autoresearch")]
        name: String,
    },
    /// Measure the baseline and start the loop (on a research/ branch).
    Start {
        #[arg(default_value = "autoresearch")]
        name: String,
        /// Stay on the current branch.
        #[arg(long)]
        here: bool,
    },
    /// Run one experiment: the working tree's change, measured; kept if better, reverted if not.
    Try { hypothesis: String },
    /// The run: baseline, best, and every experiment.
    Status,
    /// End the run (its branch and commits stay).
    Stop,
}

#[derive(Subcommand)]
enum AgentsCmd {
    /// Which agents are wired up (MCP server, pre-edit hook).
    Status,
    /// Write MCP + hook config for agents: claude, cursor, codex, gemini, or all.
    Connect {
        #[arg(default_value = "claude")]
        agents: Vec<String>,
    },
    /// Write the brief (tools, fences, workflows) into AGENTS.md and the instruction files that exist.
    Sync { files: Vec<String> },
    /// Print the brief.
    Brief,
    /// Fences and workflows agents have suggested.
    Suggestions,
    /// Accept a suggestion into kula.toml.
    Accept { id: u64 },
    /// Dismiss a suggestion.
    Dismiss { id: u64 },
    /// The agent config matrix: MCP servers and rules files per agent, against
    /// the shared source. With a NAME, sync that server from .agents/mcp.json to all.
    Mcp { name: Option<String> },
}

#[derive(Subcommand)]
enum GraphCmd {
    /// Show only a slice of the graph and what crosses its edge. Selectors are unioned:
    /// a path glob, cluster:<id|label>, symbol:<name>[~hops], diff:<base>[..head], @<scope>.
    Isolate {
        #[arg(required = true)]
        selectors: Vec<String>,
        /// Neighbourhood for symbol selectors without ~N.
        #[arg(long, default_value_t = 1)]
        hops: usize,
        /// Save it in kula.toml as a named [[scope]]; workflows reuse it as `scope = ["@name"]`.
        #[arg(long, value_name = "NAME")]
        save: Option<String>,
        /// One line about the saved scope.
        #[arg(long, requires = "save")]
        about: Option<String>,
        /// Rows per boundary list.
        #[arg(short, long, default_value_t = 12)]
        limit: usize,
    },
    /// The saved scopes.
    Scopes,
    /// Forget a saved scope.
    Forget { name: String },
}

#[derive(Subcommand)]
enum TaskCmd {
    /// Start a task; --scope limits what agents may change (globs or symbol names).
    Start {
        title: String,
        #[arg(short, long, num_args = 1..)]
        scope: Vec<String>,
        /// Run it in a workflow: explore, fix, refactor, tests, docs, or one from kula.toml.
        #[arg(short, long)]
        workflow: Option<String>,
    },
    /// The active task.
    Show,
    /// Finish the task and lift its scope.
    Done,
}

#[derive(Subcommand)]
enum MemoryCmd {
    /// Remember something about a target: repo | file:<path> | a symbol name.
    Add {
        target: String,
        text: String,
        /// Who is remembering (agent:<name> for agents).
        #[arg(long)]
        by: Option<String>,
    },
    /// Memories for a target and its neighbours, or matching --query; all when neither.
    Recall {
        target: Option<String>,
        #[arg(short, long)]
        query: Option<String>,
        #[arg(short, long, default_value_t = 20)]
        limit: usize,
    },
    /// The memory still holds: re-anchor it to the code as it is now.
    Confirm { id: u64 },
    /// Rewrite a memory, or move it to another target (re-anchoring it there).
    Edit {
        id: u64,
        text: Option<String>,
        #[arg(short, long)]
        target: Option<String>,
    },
    /// Flag a memory as no longer trustworthy, without forgetting it.
    Stale { id: u64 },
    /// Forget a memory.
    Rm { id: u64 },
}

#[derive(Subcommand)]
enum KgCmd {
    /// Write the graph as RDF: ttl | nt | jsonld | rdfxml.
    Export {
        #[arg(short, long, default_value = "ttl")]
        format: String,
        /// File to write (stdout when omitted).
        #[arg(short, long)]
        out: Option<std::path::PathBuf>,
    },
    /// Run a read-only SPARQL query (`-` reads it from stdin). kula:, code:, rdf:, rdfs:, xsd: are predeclared.
    Sparql {
        query: String,
        #[arg(short, long, default_value_t = 200)]
        limit: usize,
    },
    /// Example queries and the vocabulary.
    Examples,
}

#[derive(Subcommand)]
enum NoteCmd {
    /// Add a note. Target: repo | file:<path> | symbol:<name> | commit:<sha>.
    Add {
        target: String,
        body: String,
    },
    List {
        #[arg(long)]
        target: Option<String>,
    },
    Edit {
        id: u64,
        body: String,
    },
    Rm {
        id: u64,
    },
}

fn main() {
    let cli = Cli::parse();
    if let Err(e) = run(cli) {
        let msg = format!("{e:#}");
        eprintln!("{}", failure(&msg, next_step(&msg)));
        std::process::exit(1);
    }
}

/// What to run next for the errors a user hits, matched on the message's opening
/// words so hints survive the details that follow them.
fn next_step(msg: &str) -> Option<&'static str> {
    let short = msg.split('–').next().unwrap_or(msg).trim();
    let m = |p: &str| short.starts_with(p);
    if m("no workflow called") {
        Some("kula workflow list")
    } else if m("no team called") {
        Some("kula team list")
    } else if m("no issue") {
        Some("kula issue list --all")
    } else if m("no proposal") {
        Some("kula pr list --all")
    } else if m("no research yet") || m("the autoresearch workflow has no metric") {
        Some("kula research init --metric \"<command>\" --scope \"<paths>\"")
    } else if m("commit or stash your changes first") {
        Some("git commit -am \"wip\"")
    } else if m("not a git repository") || m("could not find repository") || m("not inside a git repository") {
        Some("git init  ·  kula init")
    } else if m("no active task") || m("no task") {
        Some("kula task start \"<title>\"")
    } else if m("no index") || m("no graph") {
        Some("kula index")
    } else {
        None
    }
}

fn passthrough(dir: &std::path::Path, args: &[String]) -> Result<()> {
    let status = std::process::Command::new("git").arg("-C").arg(dir).args(args).status()?;
    std::process::exit(status.code().unwrap_or(1));
}

fn graph_cmd(repo: &Repo, gc: GraphCmd, json: bool) -> Result<()> {
    let out = |v: &dyn erased::Json| println!("{}", v.to_json());
    match gc {
        GraphCmd::Isolate { selectors, hops, save, about, limit } => {
            let st = Store::open(repo)?;
            let (saved, s) = match save {
                Some(name) => {
                    let (sc, s) = isolate::save(repo, &st, &name, about.as_deref().unwrap_or(""), &selectors, hops)?;
                    (Some(sc), s)
                }
                None => (None, isolate::isolate(repo, &st, &selectors, hops)?),
            };
            if json {
                let mut v = serde_json::to_value(&s)?;
                if let Some(sc) = &saved {
                    v["saved"] = serde_json::to_value(sc)?;
                }
                out(&v);
                return Ok(());
            }
            let c = &s.counts;
            header(&format!("isolate {}", bold(&s.selectors.join(" + "))));
            println!(
                "  {} symbols · {} files · {} internal edges · {}",
                c.nodes,
                c.files,
                c.internal,
                dim(&s.clusters.iter().take(4).cloned().collect::<Vec<_>>().join(", "))
            );
            println!(
                "  {} {} from {} outside   {} {} to {} outside\n",
                accent("in"),
                c.inbound_edges,
                c.inbound,
                accent("out"),
                c.outbound_edges,
                c.outbound
            );
            let by_id: std::collections::HashMap<i64, &store::Node> = s.nodes.iter().map(|n| (n.id, n)).collect();
            for (title, list) in [("inbound – who uses it", &s.inbound), ("outbound – what it uses", &s.outbound)] {
                if list.is_empty() {
                    continue;
                }
                println!("  {}", bold(title));
                for p in list.iter().take(limit) {
                    let via: Vec<&str> = p.inside.iter().filter_map(|i| by_id.get(i)).map(|n| n.name.as_str()).take(3).collect();
                    println!(
                        "  {} {}  {}  {} {}",
                        community(p.node.community, kind_glyph(&p.node.kind)),
                        bold(&p.node.name),
                        dim(&format!("{}:{}", p.node.path, p.node.start_line)),
                        dim(&format!("×{} {}", p.edges, if title.starts_with("in") { "→" } else { "←" })),
                        via.join(", ")
                    );
                }
                if list.len() > limit {
                    println!("  {}", dim(&format!("… {} more", list.len() - limit)));
                }
                println!();
            }
            println!("  {}", bold("files"));
            for f in s.files.iter().take(limit) {
                println!("  {f}");
            }
            if s.files.len() > limit {
                println!("  {}", dim(&format!("… {} more", s.files.len() - limit)));
            }
            if let Some(sc) = saved {
                println!(
                    "\n  saved as {} in kula.toml – use it in a workflow as {}",
                    bold(&format!("@{}", sc.name)),
                    dim(&format!("scope = [\"@{}\"]", sc.name))
                );
            }
        }
        GraphCmd::Scopes => {
            let cfg = config::Config::load(&repo.root)?;
            if json {
                out(&cfg.scopes);
                return Ok(());
            }
            header("scopes");
            if cfg.scopes.is_empty() {
                println!("  {}", dim("none yet – kula graph isolate <selector> --save <name>"));
            }
            for s in &cfg.scopes {
                println!(
                    "  {} {:<20} {}  {}",
                    accent("@"),
                    s.name,
                    s.select.join(" + "),
                    dim(&format!("{} files{}", s.paths.len(), if s.about.is_empty() { String::new() } else { format!(" – {}", s.about) }))
                );
            }
        }
        GraphCmd::Forget { name } => {
            if !isolate::remove(repo, &name)? {
                bail!("no saved scope {name:?}");
            }
            if json {
                out(&serde_json::json!({ "removed": name }));
            } else {
                println!("  forgot @{name}");
            }
        }
    }
    Ok(())
}

fn print_node(n: &store::Node) {
    println!("  {} {}  {}", community(n.community, kind_glyph(&n.kind)), bold(&n.name), dim(&format!("{}:{}", n.path, n.start_line)));
}

fn run(cli: Cli) -> Result<()> {
    let cwd = cli.dir.clone().unwrap_or(std::env::current_dir()?);
    let json = cli.json;
    let Some(cmd) = cli.cmd else {
        println!("{}", banner());
        println!(
            "  {} build the graph      {} open the UI      {} all commands\n",
            bold("kula index"),
            bold("kula view"),
            bold("kula --help")
        );
        return Ok(());
    };
    if let Cmd::External(args) = &cmd {
        return passthrough(&cwd, args);
    }
    if let Cmd::Git { args } = &cmd {
        return passthrough(&cwd, args);
    }
    if let Cmd::Doctor = cmd {
        return doctor(&cwd);
    }
    if let Cmd::Init { yes, hooks, no_hooks, agents, no_agents, ci, no_index } = cmd {
        let pick = |on: bool, off: bool| {
            if on {
                Some(true)
            } else if off {
                Some(false)
            } else {
                None
            }
        };
        return project::init(
            &cwd,
            project::InitOpts { yes, hooks: pick(hooks, no_hooks), agents: pick(agents, no_agents), ci, index: !no_index },
        );
    }
    let repo = Repo::discover(&cwd)?;
    let out = |v: &dyn erased::Json| println!("{}", v.to_json());

    match cmd {
        Cmd::Index { if_stale, quiet } => {
            if if_stale && Store::freshness(&repo) == "current" {
                return Ok(());
            }
            if !quiet {
                eprint!("{} indexing {} …", accent("◯"), bold(&repo.name()));
            }
            let s = index::run(&repo, quiet)?;
            if quiet {
            } else if json {
                out(&s);
            } else {
                println!(
                    "{} {} files · {} parsed · {} symbols · {} edges · {} clusters  {}",
                    green("✓"),
                    s.files,
                    s.parsed,
                    bold(&s.symbols.to_string()),
                    s.edges,
                    s.communities,
                    dim(&format!("{}ms", s.millis))
                );
            }
        }
        Cmd::Deps { undeclared, unused } => {
            let st = open_or_index(&repo)?;
            let all = project::deps(&repo, &st)?;
            let list: Vec<&project::Dep> = all
                .iter()
                .filter(|d| {
                    (!undeclared || (!d.declared && !d.builtin && d.importers > 0)) && (!unused || (d.declared && d.importers == 0))
                })
                .collect();
            if json {
                out(&list.iter().map(|d| serde_json::to_value(d).unwrap()).collect::<Vec<_>>());
            } else {
                header(&format!("{} packages", list.len()));
                for d in &list {
                    let state = if d.builtin {
                        dim("builtin")
                    } else if d.declared && d.importers > 0 {
                        green("declared")
                    } else if d.declared {
                        yellow("unused")
                    } else {
                        red("undeclared")
                    };
                    println!("  {:<34} {:<6} {:>4} {}  {}", bold(&d.name), dim(d.ecosystem), d.importers, dim("files"), state);
                }
                let bad = all.iter().filter(|d| !d.declared && !d.builtin && d.importers > 0).count();
                if bad > 0 && !undeclared {
                    println!("\n  {} {} imported but not declared – `kula deps --undeclared`", yellow("!"), bad);
                }
            }
        }
        Cmd::Pack { targets, budget } => {
            let st = open_or_index(&repo)?;
            let p = agent::context_pack(&repo, &st, &targets, budget)?;
            if json {
                out(&serde_json::to_value(&p)?);
            } else {
                header(&format!("context pack · {} of {} tokens · {} items", p.used, p.budget, p.items.len()));
                for it in &p.items {
                    println!(
                        "\n{} {}  {}  {}",
                        accent("■"),
                        bold(&it.name),
                        dim(&format!("{}:{}–{}", it.path, it.lines[0], it.lines[1])),
                        dim(&format!("[{}{}]", it.why, if it.signature_only { " · signature" } else { "" }))
                    );
                    println!("{}", it.code);
                }
                if !p.omitted.is_empty() {
                    println!("\n{} over budget: {}", dim("…"), p.omitted.join(", "));
                }
            }
        }
        Cmd::Before { symbol } => {
            let st = open_or_index(&repo)?;
            let r = agent::pre_edit(&repo, &st, &symbol)?;
            if json {
                out(&serde_json::to_value(&r)?);
            } else {
                header(&format!("before editing {}", r.symbol.name));
                println!("  risk {}  ·  {} dependents in {} files", risk(&r.risk), r.dependents, r.files);
                if r.guard.level != guard::Level::Open {
                    println!("  {} {}  {}", level_tag(r.guard.level), dim(&r.guard.rule), r.guard.reason);
                }
                let list = |t: &str, v: &[String]| {
                    if !v.is_empty() {
                        println!("\n  {}", dim(t));
                        v.iter().take(12).for_each(|x| println!("    {x}"));
                    }
                };
                list("direct callers", &r.direct_callers);
                list("tests that reach it", &r.tests);
                list("changes with", &r.co_changes.iter().map(|(f, c)| format!("{f}  {}", dim(&format!("{c}×")))).collect::<Vec<_>>());
                list("notes", &r.notes);
                list(
                    "memories",
                    &r.memories
                        .iter()
                        .map(|m| {
                            format!(
                                "{} {}  {}",
                                if m.stale { yellow("stale") } else { green("fresh") },
                                m.body.lines().next().unwrap_or(""),
                                dim(&m.via)
                            )
                        })
                        .collect::<Vec<_>>(),
                );
                println!();
                r.advice.iter().for_each(|a| println!("  {} {a}", accent("›")));
            }
        }
        Cmd::Verify => {
            let r = agent::verify_edit(&repo, agents::agent_from_env().as_deref())?;
            if json {
                out(&serde_json::to_value(&r)?);
            } else {
                header(&format!("verify · {} changed", r.changed.len()));
                r.changed.iter().for_each(|c| println!("  {c}"));
                r.dangling.iter().for_each(|c| println!("  {} {c}", red("✗")));
                if !r.recheck.is_empty() {
                    println!("\n  {}", dim("re-read these callers"));
                    r.recheck.iter().for_each(|c| println!("    {c}"));
                }
                for (p, v) in &r.guard_violations {
                    println!("  {} {}  {}  {}", red("⊘"), level_tag(v.level), bold(p), dim(&v.reason));
                }
                println!(
                    "\n  {}",
                    if r.ok {
                        green("✓ no dangling calls, nothing fenced touched")
                    } else if !r.dangling.is_empty() {
                        red("✗ callers point at removed code")
                    } else {
                        red("✗ guarded code changed")
                    }
                );
            }
            if !r.ok {
                std::process::exit(2);
            }
        }
        Cmd::Check { base, max_risk, md } => {
            let cfg = config::Config::load(&repo.root)?;
            let base = base.unwrap_or_else(|| project::default_branch(&repo, &cfg));
            let max = max_risk.unwrap_or(cfg.check.max_risk);
            let st = Store::open(&repo).ok();
            let r = project::check(&repo, st.as_ref(), &base, &max)?;
            if json {
                out(&serde_json::to_value(&r)?);
            } else if md {
                print!("{}", project::check_markdown(&r));
            } else {
                header(&format!("check {} {} {}", r.base, dim("…"), r.head));
                println!(
                    "  risk {} {}  ·  {} files · {} symbols touched · {} dependents",
                    risk(&r.risk),
                    dim(&format!("(gate {})", r.max_risk)),
                    r.files,
                    r.touched,
                    r.affected
                );
                for (n, p, d) in &r.top {
                    println!("    {} {}  {}", dim(&"·".repeat(*d)), bold(n), dim(p));
                }
                if !r.undeclared.is_empty() {
                    println!("  {} undeclared: {}", yellow("!"), r.undeclared.join(", "));
                }
                for (p, level, reason) in &r.guarded {
                    let tag = if level == "review" { yellow(level) } else { red(level) };
                    println!("  {} {}  {}  {}", red("⊘"), tag, bold(p), dim(reason));
                }
                let fenced = r.guarded.iter().any(|g| g.1 == "locked" || g.1 == "hidden");
                println!(
                    "\n  {}",
                    if r.pass {
                        green("✓ within the gate")
                    } else if fenced {
                        red("✗ changes guarded code – a person must approve it")
                    } else {
                        red("✗ above the gate")
                    }
                );
            }
            if !r.pass {
                std::process::exit(2);
            }
        }
        Cmd::Hooks { action } => match action.as_str() {
            "install" => println!("{} {} hooks installed", green("✓"), project::hooks_install(&repo)?),
            "uninstall" | "remove" => println!("{} {} hooks removed", green("✓"), project::hooks_uninstall(&repo)?),
            _ => {
                for (h, on) in project::hooks_status(&repo)? {
                    println!("  {} {}", if on { green("●") } else { dim("○") }, h);
                }
            }
        },
        Cmd::View { port, no_open } => {
            // A missing graph is built by the server itself, behind the UI's progress loader.
            server::serve(repo, port, !no_open)?;
        }
        Cmd::Clean { all, after, dry_run } => {
            if let Some(m) = after {
                let p = clean::set_policy(&repo, clean::Policy { after_min: m })?;
                if json {
                    println!("{}", serde_json::to_string(&p)?);
                } else if p.after_min == 0 {
                    println!("auto-clean off");
                } else {
                    println!("auto-clean after {} min idle", p.after_min);
                }
                return Ok(());
            }
            let p = clean::policy(&repo);
            let age = if all { std::time::Duration::ZERO } else { std::time::Duration::from_secs(p.after_min as u64 * 60) };
            let r = clean::run(&repo, age, dry_run)?;
            if json {
                println!("{}", serde_json::to_string(&r)?);
            } else {
                let verb = if dry_run { "would remove" } else { "removed" };
                println!(
                    "{verb} {} kept run(s), {} temp file(s); freed {} · .kula is {}",
                    r.runs_removed,
                    r.temp_removed,
                    clean::human(r.freed_bytes),
                    clean::human(r.size_bytes)
                );
            }
        }
        Cmd::Gc { dry_run } => {
            let r = clean::gc(&repo, dry_run)?;
            if json {
                println!("{}", serde_json::to_string(&r)?);
            } else {
                let verb = if dry_run { "would prune" } else { "pruned" };
                println!(
                    "{verb} {} superseded research experiment(s), {} duplicate memor{}; freed {} · .kula is {}",
                    r.research_pruned,
                    r.memories_deduped,
                    if r.memories_deduped == 1 { "y" } else { "ies" },
                    clean::human(r.freed_bytes),
                    clean::human(r.size_bytes)
                );
            }
        }
        Cmd::Status => status(&repo, json)?,
        Cmd::Lg { limit } => {
            let n = format!("-n{limit}");
            passthrough(
                &repo.root,
                &[
                    "log".into(),
                    "--graph".into(),
                    "--exclude=refs/kula/*".into(),
                    "--all".into(),
                    n,
                    "--format=%C(auto)%h%d %s %C(dim)· %an, %ar%C(reset)".into(),
                    "--color=auto".into(),
                ],
            )?;
        }
        Cmd::Query { text, limit } => {
            let st = Store::open(&repo)?;
            let hits = st.search(&text.join(" "), limit)?;
            if json {
                out(&hits);
                return Ok(());
            }
            if hits.is_empty() {
                println!("{}", dim("no matches"));
            }
            for h in &hits {
                print_node(h);
            }
        }
        Cmd::Context { symbol } => {
            let st = Store::open(&repo)?;
            let n = graph::resolve_one(&st, &symbol)?;
            let c = graph::context(&repo, &st, n.id)?;
            if json {
                out(&c);
                return Ok(());
            }
            header(&format!(
                "{} {} {}",
                kind_glyph(&c.node.kind),
                c.node.name,
                dim(&format!("{}:{}-{}", c.node.path, c.node.start_line, c.node.end_line))
            ));
            if let Some(cm) = &c.community {
                println!("  {} {}", dim("cluster"), community(c.node.community, cm));
            }
            for (label, list) in [
                ("callers", &c.callers),
                ("callees", &c.callees),
                ("contains", &c.children),
                ("imports", &c.imports),
                ("imported by", &c.imported_by),
            ] {
                if list.is_empty() {
                    continue;
                }
                println!("\n  {} {}", bold(label), dim(&format!("({})", list.len())));
                for x in list.iter().take(25) {
                    print_node(x);
                }
            }
            let notes: Vec<_> = meta::load(&repo)?
                .notes
                .into_iter()
                .filter(|x| x.target.ends_with(&c.node.name) || x.target.ends_with(&c.node.path))
                .collect();
            if !notes.is_empty() {
                println!("\n  {}", bold("notes"));
                for x in notes {
                    println!("  {} {} {}", magenta("✎"), x.body, dim(&format!("– {}", x.author)));
                }
            }
        }
        Cmd::Impact { symbol, down, depth } => {
            let st = Store::open(&repo)?;
            let n = graph::resolve_one(&st, &symbol)?;
            let imp = graph::impact(&st, n.id, !down, depth)?;
            if json {
                out(&imp);
                return Ok(());
            }
            header(&format!("impact of {} {}", bold(&imp.root.name), dim(&format!("({})", imp.direction))));
            println!(
                "  risk {}   {} symbols · {} files · {} clusters\n",
                risk(&imp.risk),
                imp.hits.len(),
                imp.files,
                imp.communities.len()
            );
            for d in 1..=depth {
                let layer: Vec<_> = imp.hits.iter().filter(|h| h.depth == d).collect();
                if layer.is_empty() {
                    continue;
                }
                println!("  {} {}", accent(&format!("d{d}")), dim(if d == 1 { "direct" } else { "transitive" }));
                for h in layer.iter().take(30) {
                    print_node(&h.node);
                }
                if layer.len() > 30 {
                    println!("  {}", dim(&format!("… {} more", layer.len() - 30)));
                }
            }
        }
        Cmd::Trace { from, to } => {
            let st = Store::open(&repo)?;
            let a = graph::resolve_one(&st, &from)?;
            let b = graph::resolve_one(&st, &to)?;
            let path = graph::trace(&st, a.id, b.id)?;
            if json {
                out(&path);
                return Ok(());
            }
            if path.is_empty() {
                println!("{} no call path from {} to {}", dim("○"), a.name, b.name);
            }
            for (i, n) in path.iter().enumerate() {
                println!(
                    "  {}{} {}  {}",
                    "  ".repeat(i),
                    if i == 0 { accent("●") } else { dim("└→") },
                    bold(&n.name),
                    dim(&format!("{}:{}", n.path, n.start_line))
                );
            }
        }
        Cmd::Flows { limit } => {
            let st = Store::open(&repo)?;
            let f = graph::flows(&st, limit)?;
            if json {
                out(&f);
                return Ok(());
            }
            header("execution flows");
            for fl in f {
                println!("  {} {}  {} {}", accent("▶"), bold(&fl.entry.name), dim(&fl.entry.path), dim(&format!("reaches {}", fl.reach)));
                let names: Vec<String> = fl.steps.iter().filter(|s| s.depth == 1).take(6).map(|s| s.node.name.clone()).collect();
                if !names.is_empty() {
                    println!("      {}", dim(&format!("→ {}", names.join(", "))));
                }
            }
        }
        Cmd::Clusters => {
            let st = Store::open(&repo)?;
            let c = st.communities()?;
            if json {
                out(&c);
                return Ok(());
            }
            header("clusters");
            for x in c.iter().filter(|x| x.size > 1).take(30) {
                println!("  {} {:<48} {}", community(x.id, "■"), x.label, dim(&x.size.to_string()));
            }
        }
        Cmd::Compare { base, head } => {
            let head = head.unwrap_or_else(|| repo.branch());
            let st = Store::open(&repo).ok();
            let c = graph::compare(&repo, st.as_ref(), &base, &head)?;
            if json {
                out(&c);
                return Ok(());
            }
            print_compare(&c);
        }
        Cmd::GraphDiff { base, head, all } => {
            let head = head.unwrap_or_else(|| repo.branch());
            let b = index::snapshot_any(&repo, &base)?;
            let h = index::snapshot_any(&repo, &head)?;
            let d = graph::graph_diff(&b, &h, &base, &head, Some(!all));
            if json {
                out(&d);
                return Ok(());
            }
            print_graph_diff(&d);
        }
        Cmd::Issue(ic) => issue_cmd(&repo, ic, json)?,
        Cmd::Pr(pc) => pr_cmd(&repo, pc, json)?,
        Cmd::Note(nc) => note_cmd(&repo, nc, json)?,
        Cmd::Guard(gc) => guard_cmd(&repo, gc, json)?,
        Cmd::Task(tc) => task_cmd(&repo, tc, json)?,
        Cmd::Graph(gc) => graph_cmd(&repo, gc, json)?,
        Cmd::Workflow(wc) => workflow_cmd(&repo, wc, json)?,
        Cmd::Agents(ac) => agents_cmd(&repo, ac, json)?,
        Cmd::Team(tc) => team_cmd(&repo, tc, json)?,
        Cmd::Research(rc) => research_cmd(&repo, rc, json)?,
        Cmd::Skill(sc) => skill_cmd(&repo.root, sc, json)?,
        Cmd::Run { workflow, agent, title, cmd } => {
            let r = run::run(&repo, run::Opts { workflow, agent, title, cmd })?;
            if json {
                println!("{}", serde_json::to_string(&r)?);
            } else if r.restored.is_empty() && r.moved.is_empty() {
                eprintln!("kula run: {} fenced file{} untouched", r.fenced_files, if r.fenced_files == 1 { "" } else { "s" });
            } else {
                for (p, why) in &r.restored {
                    eprintln!("  {} put back {}  {}", red("⊘"), bold(p), dim(why));
                }
                for (p, why) in &r.moved {
                    eprintln!("  {} moved out {}  {}", red("⊘"), bold(p), dim(why));
                }
                eprintln!("  {}", dim(&format!("the agent's versions are in {}", r.kept_in)));
            }
            std::process::exit(if r.restored.is_empty() && r.moved.is_empty() { r.code } else { 3 });
        }
        Cmd::Memory(mc) => memory_cmd(&repo, mc, json)?,
        Cmd::Kg(kc) => kg_cmd(&repo, kc, json)?,
        Cmd::Sync { remote, overwrite } => {
            print!("{}", meta::sync(&repo, &remote, false)?);
            match setup::pull(&repo, &remote, overwrite)? {
                None => println!("remote has no shared agent setup"),
                Some(r) => {
                    for f in &r.written {
                        println!("  {} {f}", green("+"));
                    }
                    for f in &r.kept {
                        println!("  {} {f}  {}", yellow("="), dim("changed here, kept yours (--overwrite takes theirs)"));
                    }
                    let skills = skills::sync(&repo.root)?;
                    let docs = agents::sync(&repo, &[])?;
                    println!(
                        "agent setup: {} files restored, {} kept, {} agent copies regenerated",
                        r.written.len(),
                        r.kept.len(),
                        skills.len() + docs.len()
                    );
                }
            }
        }
        Cmd::Share { remote } => {
            let shared = setup::snapshot(&repo)?;
            print!("{}", meta::sync(&repo, &remote, true)?);
            setup::push(&repo, &remote)?;
            println!("shared the agent setup ({} files) on {}", shared.len(), setup::REF);
            println!("{}", dim("anyone who clones gets it with `kula sync` (a fork: `kula sync upstream`)"));
        }
        Cmd::Mcp => mcp::run(repo)?,
        Cmd::Doctor | Cmd::Init { .. } | Cmd::Git { .. } | Cmd::External(_) => unreachable!(),
    }
    Ok(())
}

/// The store, building the graph first if this repo has none yet.
fn open_or_index(repo: &Repo) -> Result<Store> {
    if !Store::path(repo).exists() {
        eprint!("{} first run – indexing …", accent("◯"));
        index::run(repo, false)?;
    }
    Store::open(repo)
}

fn print_compare(c: &graph::Compare) {
    header(&format!("{} {} {}", c.base, dim("…"), c.head));
    println!(
        "  {} ahead · {} behind · {} files · {} symbols touched · risk {}\n",
        green(&c.ahead.to_string()),
        red(&c.behind.to_string()),
        c.files.len(),
        c.touched,
        risk(&c.risk)
    );
    if !c.commits.is_empty() {
        println!("  {}", bold("commits"));
        for x in c.commits.iter().take(12) {
            println!("  {} {}", yellow(&x.short), x.subject);
        }
        println!();
    }
    println!("  {}", bold("files"));
    for f in &c.files {
        let st = match f.status.as_str() {
            "A" => green("A"),
            "D" => red("D"),
            _ => yellow(&f.status),
        };
        println!("  {st} {}", f.path);
        for s in f.symbols.iter().take(8) {
            println!("      {} {}", community(s.community, kind_glyph(&s.kind)), s.name);
        }
    }
    if !c.affected.is_empty() {
        println!("\n  {} {}", bold("ripples into"), dim(&format!("({} dependents)", c.affected.len())));
        for h in c.affected.iter().take(15) {
            println!("  {} {}  {}", accent(&format!("d{}", h.depth)), h.node.name, dim(&h.node.path));
        }
    }
}

fn print_graph_diff(d: &graph::GraphDiff) {
    let s = &d.summary;
    header(&format!("graph {} {} {}", d.base, dim("→"), d.head));
    println!(
        "  {} added · {} removed · {} modified · {} unchanged   {} calls added · {} removed · {} files\n",
        green(&format!("+{}", s.added)),
        red(&format!("-{}", s.removed)),
        yellow(&format!("~{}", s.modified)),
        dim(&s.same.to_string()),
        green(&format!("+{}", s.edges_added)),
        red(&format!("-{}", s.edges_removed)),
        s.files_touched
    );
    for (status, mark, label) in [("added", green("+"), "added"), ("removed", red("-"), "removed"), ("modified", yellow("~"), "modified")] {
        let list: Vec<_> = d.nodes.iter().filter(|n| n.status == status && n.kind != "file").collect();
        if list.is_empty() {
            continue;
        }
        println!("  {} {}", bold(label), dim(&format!("({})", list.len())));
        for n in list.iter().take(40) {
            let owner = n.container.as_ref().map(|c| format!("{c}.")).unwrap_or_default();
            println!(
                "  {mark} {} {}{}  {}",
                community(n.community, kind_glyph(&n.kind)),
                dim(&owner),
                bold(&n.name),
                dim(&format!("{}:{}", n.path, n.start_line))
            );
        }
        if list.len() > 40 {
            println!("    {}", dim(&format!("… {} more", list.len() - 40)));
        }
        println!();
    }
    let calls: Vec<_> = d.edges.iter().filter(|e| e.status != "same" && e.kind == "CALLS").collect();
    if !calls.is_empty() {
        println!("  {} {}", bold("call graph"), dim(&format!("({} changed edges)", calls.len())));
        let name = |id: i64| d.nodes.iter().find(|n| n.id == id).map(|n| n.name.clone()).unwrap_or_default();
        for e in calls.iter().take(20) {
            let m = if e.status == "added" { green("+") } else { red("-") };
            println!("  {m} {} → {}", name(e.src), name(e.dst));
        }
    }
}

fn status(repo: &Repo, json: bool) -> Result<()> {
    let files = repo.status()?;
    let head = repo.head();
    let fresh = Store::freshness(repo);
    if json {
        println!("{}", serde_json::json!({ "branch": repo.branch(), "head": head, "index": fresh, "files": files }));
        return Ok(());
    }
    header(&format!("{} {}", repo.name(), accent(&repo.branch())));
    let idx = match fresh {
        "current" => green("● graph current"),
        "stale" => yellow("● graph behind HEAD – run `kula index`"),
        _ => dim("○ no graph yet – run `kula index`"),
    };
    println!("  {idx}");
    if files.is_empty() {
        println!("  {}", dim("working tree clean"));
        return Ok(());
    }
    let staged: Vec<_> = files.iter().filter(|f| f.staged).collect();
    let unstaged: Vec<_> = files.iter().filter(|f| f.unstaged && !f.untracked).collect();
    let untracked: Vec<_> = files.iter().filter(|f| f.untracked).collect();
    println!();
    for (title, list, col) in [("staged", staged, 0), ("changed", unstaged, 1), ("untracked", untracked, 2)] {
        if list.is_empty() {
            continue;
        }
        println!("  {} {}", bold(&list.len().to_string()), bold(title));
        for f in list {
            let code = if col == 0 { &f.index } else { &f.worktree };
            let c = match col {
                0 => green(code),
                1 => yellow(code),
                _ => dim("?"),
            };
            println!("    {c} {}", f.path);
        }
    }
    Ok(())
}

fn issue_cmd(repo: &Repo, c: IssueCmd, json: bool) -> Result<()> {
    match c {
        IssueCmd::New { title, body, label, anchor } => {
            let i = meta::issue_new(repo, &title, &body, label, anchor)?;
            println!("{} opened issue {} {}", green("✓"), accent(&format!("#{}", i.id)), i.title);
        }
        IssueCmd::List { all } => {
            let m = meta::load(repo)?;
            let list: Vec<_> = m.issues.iter().filter(|i| all || i.status == "open").collect();
            if json {
                println!("{}", serde_json::to_string_pretty(&list)?);
                return Ok(());
            }
            if list.is_empty() {
                println!("{}", dim("no issues"));
            }
            for i in list {
                let dot = if i.status == "open" { green("●") } else { dim("○") };
                let labels = if i.labels.is_empty() { String::new() } else { magenta(&format!(" [{}]", i.labels.join(", "))) };
                println!(
                    "  {dot} {} {}{}  {}",
                    accent(&format!("#{}", i.id)),
                    i.title,
                    labels,
                    dim(&format!("{} · {}", i.author, rel_time(i.created)))
                );
            }
        }
        IssueCmd::Show { id } => {
            let m = meta::load(repo)?;
            let Some(i) = m.issues.iter().find(|i| i.id == id) else { bail!("no issue #{id}") };
            if json {
                println!("{}", serde_json::to_string_pretty(i)?);
                return Ok(());
            }
            header(&format!("#{} {}  {}", i.id, i.title, dim(&i.status)));
            println!("  {}\n", dim(&format!("{} · {}", i.author, rel_time(i.created))));
            if !i.body.is_empty() {
                println!("  {}\n", i.body);
            }
            for a in &i.anchors {
                println!("  {} {}", accent("⌖"), a);
            }
            for c in &i.comments {
                println!("  {} {}  {}", blue("│"), c.body, dim(&format!("– {}, {}", c.author, rel_time(c.at))));
            }
        }
        IssueCmd::Close { id } => {
            meta::issue_set_status(repo, id, "closed")?;
            println!("{} closed #{id}", green("✓"));
        }
        IssueCmd::Reopen { id } => {
            meta::issue_set_status(repo, id, "open")?;
            println!("{} reopened #{id}", green("✓"));
        }
        IssueCmd::Comment { id, body } => {
            meta::comment(repo, id, &body)?;
            println!("{} commented on #{id}", green("✓"));
        }
    }
    Ok(())
}

fn pr_cmd(repo: &Repo, c: PrCmd, json: bool) -> Result<()> {
    match c {
        PrCmd::New { title, base, head, body } => {
            let head = head.unwrap_or_else(|| repo.branch());
            let p = meta::proposal_new(repo, &title, &body, &base, &head)?;
            println!("{} proposal {} {} {}", green("✓"), accent(&format!("#{}", p.id)), p.title, dim(&format!("{} → {}", p.head, p.base)));
        }
        PrCmd::List { all } => {
            let m = meta::load(repo)?;
            let list: Vec<_> = m.proposals.iter().filter(|p| all || p.status == "open").collect();
            if json {
                println!("{}", serde_json::to_string_pretty(&list)?);
                return Ok(());
            }
            if list.is_empty() {
                println!("{}", dim("no proposals"));
            }
            for p in list {
                let dot = match p.status.as_str() {
                    "open" => green("●"),
                    "merged" => magenta("◆"),
                    _ => dim("○"),
                };
                println!(
                    "  {dot} {} {}  {}",
                    accent(&format!("#{}", p.id)),
                    p.title,
                    dim(&format!("{} → {} · {}", p.head, p.base, rel_time(p.created)))
                );
            }
        }
        PrCmd::Show { id } => {
            let m = meta::load(repo)?;
            let Some(p) = m.proposals.iter().find(|p| p.id == id) else { bail!("no proposal #{id}") };
            if json {
                println!("{}", serde_json::to_string_pretty(p)?);
                return Ok(());
            }
            header(&format!("#{} {}  {}", p.id, p.title, dim(&p.status)));
            if !p.body.is_empty() {
                println!("  {}", p.body);
            }
            println!();
            if p.status == "open" {
                let st = Store::open(repo).ok();
                print_compare(&graph::compare(repo, st.as_ref(), &p.base, &p.head)?);
            }
            for c in &p.comments {
                println!("  {} {}  {}", blue("│"), c.body, dim(&format!("– {}, {}", c.author, rel_time(c.at))));
            }
        }
        PrCmd::Merge { id } => {
            let p = meta::proposal_merge(repo, id)?;
            println!("{} merged #{id} into {} {}", green("✓"), p.base, dim(p.merged_sha.as_deref().unwrap_or("")));
        }
        PrCmd::Close { id } => {
            meta::proposal_set_status(repo, id, "closed")?;
            println!("{} closed #{id}", green("✓"));
        }
        PrCmd::Comment { id, body } => {
            meta::comment(repo, id, &body)?;
            println!("{} commented on #{id}", green("✓"));
        }
    }
    Ok(())
}

fn note_cmd(repo: &Repo, c: NoteCmd, json: bool) -> Result<()> {
    match c {
        NoteCmd::Add { target, body } => {
            let target = if target == "repo" || target.contains(':') { target } else { format!("symbol:{target}") };
            let n = meta::note_add(repo, &target, &body)?;
            println!("{} note {} on {}", green("✓"), accent(&format!("#{}", n.id)), n.target);
        }
        NoteCmd::List { target } => {
            let m = meta::load(repo)?;
            let list: Vec<_> = m.notes.iter().filter(|n| target.as_ref().map(|t| n.target.contains(t.as_str())).unwrap_or(true)).collect();
            if json {
                println!("{}", serde_json::to_string_pretty(&list)?);
                return Ok(());
            }
            if list.is_empty() {
                println!("{}", dim("no notes"));
            }
            for n in list {
                println!(
                    "  {} {} {}  {}",
                    magenta("✎"),
                    accent(&format!("#{}", n.id)),
                    bold(&n.target),
                    dim(&format!("{} · {}", n.author, rel_time(n.updated)))
                );
                for l in n.body.lines() {
                    println!("      {l}");
                }
            }
        }
        NoteCmd::Edit { id, body } => {
            meta::note_edit(repo, id, &body)?;
            println!("{} updated note #{id}", green("✓"));
        }
        NoteCmd::Rm { id } => {
            meta::note_rm(repo, id)?;
            println!("{} removed note #{id}", green("✓"));
        }
    }
    Ok(())
}

fn doctor(cwd: &std::path::Path) -> Result<()> {
    header("kula doctor");
    let git = std::process::Command::new("git").arg("--version").output();
    match git {
        Ok(o) if o.status.success() => println!("  {} {}", green("✓"), String::from_utf8_lossy(&o.stdout).trim()),
        _ => println!("  {} git not found on PATH", red("✗")),
    }
    match Repo::discover(cwd) {
        Ok(r) => {
            println!("  {} repository {}", green("✓"), r.root.display());
            match Store::open(&r) {
                Ok(s) => println!("  {} graph {}", green("✓"), dim(&s.meta("stats").unwrap_or_default())),
                Err(_) => println!("  {} no graph – run `kula index`", yellow("●")),
            }
        }
        Err(_) => println!("  {} not inside a git repository", yellow("●")),
    }
    println!("  {} kula {}", green("✓"), env!("CARGO_PKG_VERSION"));
    Ok(())
}

/// Object-safe JSON printing for heterogeneous command results.
fn level_tag(l: guard::Level) -> String {
    match l {
        guard::Level::Hidden => red("hidden"),
        guard::Level::Locked => red("locked"),
        guard::Level::Scope => yellow("scope"),
        guard::Level::Review => yellow("review"),
        guard::Level::Open => green("open"),
    }
}

/// Whether a whitespace-split word of `cmd` equals `w` (no quote smarts –
/// a cheap pre-filter before the strict shell layer runs).
fn words_has(cmd: &str, w: &str) -> bool {
    cmd.split_whitespace().any(|x| x.trim_matches(|c| c == '\'' || c == '"') == w)
}

/// A path as the repository sees it: relative, forward slashes, symlinks
/// resolved. A path that does not exist yet is resolved through its nearest
/// existing ancestor, so a new file behind a symlinked directory (or behind
/// `/tmp` → `/private/tmp`) lands on its real repo-relative name.
fn repo_rel(repo: &Repo, p: &str) -> String {
    let pb = std::path::Path::new(p);
    let root = repo.root.canonicalize().unwrap_or_else(|_| repo.root.clone());
    let abs = if pb.is_absolute() { pb.to_path_buf() } else { root.join(pb) };
    let full = canonicalize_ancestors(&abs);
    let rel = full.strip_prefix(&root).map(|r| r.to_path_buf()).unwrap_or(full);
    rel.to_string_lossy().replace('\\', "/").trim_start_matches("./").to_string()
}

/// Canonicalize the nearest existing ancestor of `p` and rejoin the tail.
fn canonicalize_ancestors(p: &std::path::Path) -> std::path::PathBuf {
    let mut anc = p.to_path_buf();
    let mut tail: Vec<std::ffi::OsString> = vec![];
    while !(anc.exists() || anc.symlink_metadata().is_ok()) {
        match anc.file_name() {
            Some(f) => {
                tail.push(f.to_owned());
                if !anc.pop() {
                    break;
                }
            }
            None => break,
        }
    }
    match anc.canonicalize() {
        Ok(c) => tail.iter().rev().fold(c, |a, f| a.join(f)),
        // a dangling symlink still resolves: follow the link and try again
        Err(_) => match anc.read_link() {
            Ok(t) => {
                let target = if t.is_absolute() { t } else { anc.parent().unwrap_or(std::path::Path::new(".")).join(t) };
                tail.iter().rev().fold(canonicalize_ancestors(&target), |a, f| a.join(f))
            }
            Err(_) => p.to_path_buf(),
        },
    }
}

fn guard_cmd(repo: &Repo, c: GuardCmd, json: bool) -> Result<()> {
    let st = Store::open(repo).ok();
    match c {
        GuardCmd::List => {
            let g = guard::Guards::load(repo)?;
            let files = match &st {
                Some(st) => guard::guarded_files(repo, st)?,
                None => vec![],
            };
            if json {
                let rules: Vec<_> = g
                    .rules()
                    .into_iter()
                    .map(|(r, l)| serde_json::json!({ "level": l, "paths": r.paths, "symbols": r.symbols, "reason": r.reason }))
                    .collect();
                println!(
                    "{}",
                    serde_json::json!({ "rules": rules, "task": g.task(), "files": files.iter().map(|(p, v)| serde_json::json!({ "path": p, "verdict": v })).collect::<Vec<_>>() })
                );
                return Ok(());
            }
            header("guards");
            if g.rules().is_empty() {
                println!("  {}", dim("no [[guard]] rules in kula.toml – secrets are still hidden from agents"));
            }
            for (i, (r, l)) in g.rules().iter().enumerate() {
                let what = [r.paths.clone(), r.symbols.clone()].concat().join(", ");
                println!("  {} {}  {}  {}", dim(&format!("#{}", i + 1)), level_tag(*l), bold(&what), dim(&r.reason));
            }
            if let Some(t) = g.task() {
                println!(
                    "\n  {} {}  {}",
                    accent("task"),
                    bold(&t.title),
                    dim(&if t.scope.is_empty() { "whole repository".into() } else { t.scope.join(", ") })
                );
            }
            let fenced: Vec<_> = files.iter().filter(|(_, v)| v.level != guard::Level::Scope).collect();
            if !fenced.is_empty() {
                println!("\n  {} fenced files", fenced.len());
                for (p, v) in fenced.iter().take(40) {
                    println!("    {}  {}", level_tag(v.level), p);
                }
            }
        }
        GuardCmd::Check { paths, staged } => {
            let mut touched: Vec<(String, Vec<String>)> = paths.iter().map(|p| (repo_rel(repo, p), vec![])).collect();
            if staged {
                let staged_syms = st
                    .as_ref()
                    .map(|st| guard::diff_symbols(repo, st, &["diff", "--cached", "-U0", "--no-color", "--no-renames"]))
                    .unwrap_or_default();
                for p in repo.run(&["diff", "--cached", "--name-only"])?.lines().map(String::from) {
                    let syms = staged_syms.iter().find(|(fp, _)| *fp == p).map(|(_, s)| s.clone()).unwrap_or_default();
                    if !touched.iter().any(|(tp, _)| *tp == p) {
                        touched.push((p.clone(), syms));
                    }
                }
            }
            let bad = guard::violations_with(repo, st.as_ref(), &touched, agents::agent_from_env().as_deref())?;
            if json {
                println!(
                    "{}",
                    serde_json::json!({ "ok": bad.is_empty(), "violations": bad.iter().map(|(p, v)| serde_json::json!({ "path": p, "verdict": v })).collect::<Vec<_>>() })
                );
            } else if bad.is_empty() {
                println!("  {} agents may edit {} path(s)", green("✓"), paths.len());
            } else {
                for (p, v) in &bad {
                    println!("  {} {}  {}  {}", red("⊘"), level_tag(v.level), bold(p), dim(&v.reason));
                }
            }
            if !bad.is_empty() {
                std::process::exit(1);
            }
        }
        GuardCmd::Commit => {
            // Only agents are held here; a person's commit is theirs. Identity
            // is a fresh session marker first (an agent was here recently, even
            // if this shell scrubbed its environment), then the environment,
            // then "person".
            let marker = guard::session_agent(repo);
            let Some(agent) = marker.clone().or_else(agents::agent_from_env) else { return Ok(()) };
            let g = guard::Guards::for_agent(repo, Some(&agent))?;
            let staged = repo.run(&["diff", "--cached", "--name-only", "-z"])?;
            let syms: Vec<(String, Vec<String>)> = st
                .as_ref()
                .map(|st| guard::diff_symbols(repo, st, &["diff", "--cached", "-U0", "--no-color", "--no-renames"]))
                .unwrap_or_default();
            let bad: Vec<(String, guard::Verdict)> = staged
                .split('\0')
                .filter(|p| !p.is_empty())
                .map(|p| {
                    let names = syms.iter().find(|(fp, _)| fp == p).map(|(_, s)| s.clone()).unwrap_or_default();
                    (p.to_string(), g.edit_touched(st.as_ref(), p, &names))
                })
                .filter(|(_, v)| !v.level.editable())
                .collect();
            if !bad.is_empty() {
                eprintln!("kula guard: {agent}'s commit holds fenced changes – a person commits these:");
                for (p, v) in &bad {
                    eprintln!("  {} {}  {}", p, v.level.as_str(), v.reason);
                }
                if marker.is_some() {
                    eprintln!("  (an agent session marker under .git/kula is fresh – a person waits for it to expire, or commits with --no-verify)");
                }
                std::process::exit(1);
            }
        }
        GuardCmd::Hook { agent, read } => {
            // One hook for every agent: Claude Code, Cursor, Codex and Gemini CLI all send the
            // tool call as JSON on stdin and treat exit 2 as "blocked, stderr is the reason".
            // File tools, patches and shell commands are all read for what they touch.
            let mut input = String::new();
            std::io::Read::read_to_string(&mut std::io::stdin(), &mut input)?;
            let v: serde_json::Value = serde_json::from_str(&input).unwrap_or_default();
            let deny = |msg: String| -> ! {
                if agent == "cursor" {
                    println!(
                        "{}",
                        serde_json::json!({ "permission": "deny", "continue": true, "user_message": msg, "agent_message": msg })
                    );
                }
                eprintln!("{msg}");
                std::process::exit(2);
            };
            let call = agents::hook_call(&v);
            if let Some(why) = call.tamper {
                deny(format!("kula guard: refused – {why}."));
            }
            let g = guard::Guards::for_agent(repo, Some(&agent))?;
            // A second layer over the shell tokenizer: the bypasses it cannot
            // see (eval, command substitution, heredocs, git rewrites, cd'd
            // relative writes, identity scrubbing). Only when this repo has
            // fences, and only refusals – never permissions.
            let payload_cwd = v["cwd"].as_str().unwrap_or("");
            let cwd_rel = if payload_cwd.is_empty() { String::new() } else { repo_rel(repo, payload_cwd) };
            let cmd = v["tool_input"]["command"].as_str().unwrap_or("");
            let suspicious = cmd.contains('$')
                || cmd.contains('`')
                || cmd.contains("<<")
                || words_has(cmd, "eval")
                || words_has(cmd, "git")
                || words_has(cmd, "awk")
                || words_has(cmd, "find")
                || words_has(cmd, "chmod")
                || words_has(cmd, "chown")
                || words_has(cmd, "patch")
                || words_has(cmd, "env")
                || words_has(cmd, "unset")
                || words_has(cmd, "cd");
            if suspicious {
                let fenced = guard::fenced_paths(repo, &g, st.as_ref());
                let hidden = guard::hidden_paths(repo, &g);
                if !fenced.is_empty() || !hidden.is_empty() {
                    let (more, why) = guard::shell_guard(cmd, &cwd_rel, &fenced, &hidden);
                    if let Some(why) = why {
                        deny(why);
                    }
                    for p in more {
                        let verdict = g.edit(st.as_ref(), &p);
                        if !verdict.level.editable() {
                            deny(format!(
                                "kula guard: {} is {} for agents – {} ({}). Leave it to a person, or `suggest` a change to the fence.",
                                p,
                                verdict.level.as_str(),
                                verdict.reason,
                                verdict.rule
                            ));
                        }
                    }
                }
            }
            // An agent ran here: stamp a short-lived session marker under
            // `.git/kula` so the pre-commit hook knows, even from a shell
            // whose agent environment was scrubbed.
            guard::session_stamp(repo, &agent);
            let mut paths: Vec<(String, bool)> = vec![];
            for t in call.targets {
                let rel = repo_rel(repo, &t.path);
                if rel.starts_with('/') || rel.starts_with("..") || rel.starts_with('~') {
                    continue; // outside this repository: not ours to fence
                }
                // a directory stands for every file in it
                if !rel.is_empty() && repo.root.join(&rel).is_dir() {
                    let inner = repo.run(&["ls-files", "-z", "--", &rel]).unwrap_or_default();
                    paths.extend(inner.split('\0').filter(|p| !p.is_empty()).map(|p| (p.to_string(), t.write)));
                }
                paths.push((rel, t.write));
            }
            for (rel, write) in paths {
                let t = agents::Target { path: rel.clone(), write };
                let reads = read || !t.write;
                let verdict = if reads { g.path(&rel) } else { g.edit(st.as_ref(), &rel) };
                let blocked = if reads { !verdict.level.readable() } else { !verdict.level.editable() };
                if !blocked {
                    continue;
                }
                let what = match verdict.level {
                    guard::Level::Scope => "outside the active task".to_string(),
                    l => format!("{} for agents", l.as_str()),
                };
                deny(format!(
                    "kula guard: {} is {} – {} ({}). {}",
                    rel,
                    what,
                    verdict.reason,
                    verdict.rule,
                    if verdict.level == guard::Level::Scope || verdict.rule.starts_with("workflow") {
                        "Stay inside the task and its workflow, or ask the user to change them (`kula task`)."
                    } else {
                        "Leave it to a person, or suggest a change to the fence with the `suggest` tool."
                    }
                ));
            }
        }
    }
    Ok(())
}

fn workflow_lines(w: &workflow::Workflow) {
    println!("  {} {}  {}", accent(&w.name), dim(if w.builtin { "built in" } else { "kula.toml" }), w.about);
    let row = |k: &str, v: &[String]| {
        if !v.is_empty() {
            println!("    {:<8}{}", dim(k), v.join(", "));
        }
    };
    row("scope", &w.scope);
    row("lock", &w.lock);
    row("hide", &w.hide);
    row("review", &w.review);
    println!("    {:<8}{}", dim("memory"), w.memory_policy());
    row("docs", &w.docs);
    for (i, s) in w.steps.iter().enumerate() {
        println!("    {:<8}{}. {s}", dim(if i == 0 { "steps" } else { "" }), i + 1);
    }
}

fn workflow_cmd(repo: &Repo, c: WorkflowCmd, json: bool) -> Result<()> {
    let cfg = config::Config::load(&repo.root)?;
    let active = guard::task(repo).map(|t| t.workflow).unwrap_or_default();
    match c {
        WorkflowCmd::List => {
            let all = workflow::all(&cfg);
            if json {
                println!("{}", serde_json::json!({ "workflows": all, "active": active }));
                return Ok(());
            }
            header("workflows");
            for w in all {
                let on = if w.name == active { green(" ● active") } else { String::new() };
                println!("  {:<10} {}{}", accent(&w.name), w.about, on);
            }
            println!(
                "
  {}",
                dim("kula task start \"<title>\" --workflow <name>  ·  kula workflow show <name>")
            );
        }
        WorkflowCmd::Show { name } => {
            let Some(w) = workflow::find(&cfg, &name) else { bail!("no workflow called {name}") };
            if json {
                println!("{}", serde_json::to_string(&w)?);
            } else {
                workflow_lines(&w);
            }
        }
        WorkflowCmd::Install { name, agents: ids } => {
            let ids: Vec<&str> =
                if ids.iter().any(|a| a == "all") { vec!["claude", "cursor", "gemini"] } else { ids.iter().map(String::as_str).collect() };
            let files = agents::install_workflow(&repo.root, &cfg, &name, &ids)?;
            for f in &files {
                println!("  {} {}", green("✓"), f);
            }
            println!("  {}", dim(&format!("any other harness: kula run -w {name} -- <command>  ·  kula workflow prompt {name}")));
        }
        WorkflowCmd::Prompt { name } => {
            let Some(w) = workflow::find(&cfg, &name) else { bail!("no workflow called {name}") };
            print!("{}", agents::workflow_prompt(&w));
        }
    }
    Ok(())
}

fn team_cmd(repo: &Repo, c: TeamCmd, json: bool) -> Result<()> {
    let cfg = config::Config::load(&repo.root)?;
    match c {
        TeamCmd::List => {
            let active = guard::team(repo);
            if json {
                println!("{}", serde_json::json!({ "teams": cfg.teams, "active": active }));
                return Ok(());
            }
            if cfg.teams.is_empty() {
                println!("  {}", dim("no teams"));
                hint("kula team save <name> -m claude=autoresearch -m cursor=tests");
                return Ok(());
            }
            header("teams");
            for t in &cfg.teams {
                let on = active.as_ref().is_some_and(|a| a.name == t.name);
                let under = if t.under.is_empty() { String::new() } else { format!("  {}", dim(&format!("under {}", t.under))) };
                println!("  {} {}  {}{under}", if on { green("●") } else { dim("○") }, accent(&t.name), dim(&t.about));
                let lead = t.members.iter().find(|m| m.reports_to.is_empty()).map(|m| m.key().to_string());
                let w = t.members.iter().map(|m| m.key().chars().count()).max().unwrap_or(5).max(5);
                let r = t.members.iter().map(|m| m.workflow.chars().count()).max().unwrap_or(8).max(8);
                for m in &t.members {
                    let tag = if lead.as_deref() == Some(m.key()) && m.role.is_empty() { green("lead") } else { String::new() };
                    let tag = if tag.is_empty() { String::new() } else { format!(" {tag}") };
                    let wf = if m.workflow.is_empty() { dim("none") } else { bold(&m.workflow) };
                    println!(
                        "      {:<w$}  {:<r$}  {}{}",
                        m.key(),
                        wf,
                        if m.role.is_empty() { dim("member") } else { dim(&m.role) },
                        tag,
                        w = w,
                        r = r
                    );
                }
            }
        }
        TeamCmd::Save { name, about, member, lead, prompt, under } => {
            let mut members = vec![];
            for m in member {
                let Some((agent, rest)) = m.split_once('=') else { bail!("members are agent=workflow[:role], not {m}") };
                let (wf, role) = rest.split_once(':').unwrap_or((rest, ""));
                if !wf.is_empty() && workflow::find(&cfg, wf).is_none() {
                    bail!("no workflow called {wf}");
                }
                // re-saving keeps what the UI set: prompts, hand-offs
                let old =
                    cfg.teams.iter().find(|t| t.name == name).and_then(|t| t.members.iter().find(|x| x.key() == agent.trim())).cloned();
                members.push(config::Member {
                    agent: agent.trim().into(),
                    workflow: wf.trim().into(),
                    role: role.trim().into(),
                    ..old.unwrap_or_default()
                });
            }
            // `-m gemini=fix:lead` names the lead as well as --lead does
            let lead = lead.or_else(|| members.iter().find(|m| m.role == "lead").map(|m| m.key().to_string()));
            if let Some(lead) = &lead {
                for m in members.iter_mut() {
                    m.reports_to = if m.key() == lead { String::new() } else { lead.clone() };
                }
            }
            let mut teams = cfg.teams.clone();
            let prompt = prompt.unwrap_or_else(|| cfg.teams.iter().find(|t| t.name == name).map(|t| t.prompt.clone()).unwrap_or_default());
            let under = under.unwrap_or_else(|| cfg.teams.iter().find(|t| t.name == name).map(|t| t.under.clone()).unwrap_or_default());
            let t = config::Team { name: name.clone(), about, prompt, under, members };
            match teams.iter_mut().find(|x| x.name == name) {
                Some(x) => *x = t,
                None => teams.push(t),
            }
            config::set_teams(&repo.root, &teams)?;
            println!("  {} team {} saved in kula.toml", green("✓"), accent(&name));
        }
        TeamCmd::Start { name } => {
            guard::team_start(repo, &name, &format!("user:{}", repo.user()))?;
            println!("  {} team {} at work – each agent in its own workflow", green("✓"), accent(&name));
        }
        TeamCmd::Prompt { name, agent } => {
            let Some(t) = cfg.teams.iter().find(|t| t.name == name) else { bail!("no team called {name}") };
            let id = agents::agent_id(&agent);
            let Some(m) = t.members.iter().find(|m| m.name.eq_ignore_ascii_case(agent.trim()) || agents::agent_id(&m.agent) == id) else {
                bail!("{agent} is not in team {name}")
            };
            print!("{}", agents::team_prompt(&cfg, t, m));
        }
        TeamCmd::Stop => match guard::team_stop(repo)? {
            Some(t) => println!("  {} team {} stood down", green("✓"), t.name),
            None => println!("  {}", dim("no team at work")),
        },
    }
    Ok(())
}

fn research_cmd(repo: &Repo, c: ResearchCmd, json: bool) -> Result<()> {
    let by = agents::agent_from_env().map(|a| format!("agent:{a}")).unwrap_or_else(|| format!("user:{}", repo.user()));
    let show = |s: &research::State| {
        if json {
            println!("{}", serde_json::to_string(s).unwrap_or_default());
            return;
        }
        println!(
            "  {} {}  {}  {} {} → best {} ({:+.1}%)",
            if s.active { green("●") } else { dim("○") },
            accent(&s.workflow),
            dim(&s.branch),
            dim(&format!("{} is better · baseline", if s.goal == "max" { "higher" } else { "lower" })),
            research::fmt(s.baseline),
            bold(&research::fmt(s.best)),
            s.gain() * 100.0
        );
        kv(10, "metric", &s.metric);
        kv(10, "budget", &if let Some(n) = s.left() { format!("{n} experiments left") } else { "no limit".into() });
        if !s.experiments.is_empty() {
            println!("  {}", dim("#   kept   value      hypothesis"));
            for e in &s.experiments {
                let v = e.value.map(research::fmt).unwrap_or_else(|| "–".into());
                println!("  {:<3} {} {:>10}  {}  {}", e.n, if e.kept { green("kept") } else { dim("····") }, v, e.hypothesis, dim(&e.note));
            }
        }
    };
    match c {
        ResearchCmd::Init { metric, goal, scope, budget, timeout, name } => {
            let w = research::init(repo, &name, workflow::Research { metric, goal, budget, timeout, ..Default::default() }, scope)?;
            println!("  {} {} is a research loop in kula.toml", green("✓"), accent(&w.name));
            println!("  {}", dim(&format!("next: kula research start {}  (measures the baseline on a research/ branch)", w.name)));
        }
        ResearchCmd::Start { name, here } => {
            let s = research::start(repo, &name, &by, !here)?;
            show(&s);
        }
        ResearchCmd::Try { hypothesis } => {
            let e = research::experiment(repo, &hypothesis, &by)?;
            if json {
                println!("{}", serde_json::to_string(&e)?);
            } else if e.kept {
                println!(
                    "  {} kept  {} → {}  {}",
                    green("✓"),
                    research::fmt(e.best_before.unwrap_or_default()),
                    bold(&research::fmt(e.value.unwrap_or_default())),
                    dim(&e.commit[..e.commit.len().min(8)])
                );
            } else {
                println!("  {} {}", dim("·"), e.note);
            }
        }
        ResearchCmd::Status => match research::active(repo).or_else(|| research::list(repo).into_iter().next()) {
            Some(s) => show(&s),
            None => println!("  {}", dim("no research yet – kula research init --metric \"<command>\"")),
        },
        ResearchCmd::Stop => {
            let s = research::stop(repo)?;
            show(&s);
        }
    }
    Ok(())
}

fn agents_cmd(repo: &Repo, c: AgentsCmd, json: bool) -> Result<()> {
    match c {
        AgentsCmd::Status => {
            let conns = agents::connections(&repo.root);
            let docs = agents::docs(repo)?;
            if json {
                println!("{}", serde_json::json!({ "agents": conns, "docs": docs, "suggestions": agents::suggestions(repo) }));
                return Ok(());
            }
            header("agents");
            let w = conns.iter().map(|c| c.name.chars().count()).max().unwrap_or(6).max(6);
            for c in conns {
                let mark = |b: bool| if b { green("✓") } else { dim("·") };
                println!("  {:<w$} {} mcp  {} hook   {}", c.name, mark(c.mcp), mark(c.hook), dim(&c.files.join(", ")), w = w);
            }
            println!();
            let dwidth = docs.iter().map(|d| d.path.chars().count()).max().unwrap_or(10).max(10);
            for d in docs {
                let state = if !d.exists {
                    dim("missing")
                } else if d.current {
                    green("brief current")
                } else if d.synced {
                    yellow("brief outdated")
                } else {
                    dim("no brief")
                };
                println!("  {:<dwidth$} {}  {}", d.path, state, dim(&d.readers), dwidth = dwidth);
            }
            let n = agents::suggestions(repo).len();
            if n > 0 {
                println!("\n  {} suggestion(s) from agents – `kula agents suggestions`", accent(&n.to_string()));
            }
        }
        AgentsCmd::Connect { agents: ids } => {
            let ids: Vec<String> =
                if ids.iter().any(|a| a == "all") { agents::AGENTS.iter().map(|a| a.0.to_string()).collect() } else { ids };
            for id in ids {
                let files = agents::connect(&repo.root, &id)?;
                println!("  {} {:<8} {}", green("✓"), id, dim(&files.join(", ")));
            }
            for f in agents::sync(repo, &[])? {
                println!("  {} {:<8} {}", green("✓"), "brief", dim(&f));
            }
        }
        AgentsCmd::Sync { files } => {
            let done = agents::sync(repo, &files)?;
            if done.is_empty() {
                println!("  {}", dim("already current"));
            }
            for f in done {
                println!("  {} {}", green("✓"), f);
            }
        }
        AgentsCmd::Brief => print!("{}", agents::brief(&config::Config::load(&repo.root)?)),
        AgentsCmd::Mcp { name } => match name {
            Some(name) => {
                let w = agent_config::mcp_sync(&repo.root, &name)?;
                for f in w {
                    println!("  {} {}", green("✓"), f);
                }
            }
            None => {
                let m = agent_config::matrix(&repo.root)?;
                if json {
                    println!("{}", serde_json::to_string(&m)?);
                    return Ok(());
                }
                header("mcp");
                let src = if m.source.exists {
                    format!("{} · {}", accent(&m.source.path), m.source.servers.join(", "))
                } else {
                    dim(&format!("{} – none yet", m.source.path))
                };
                println!("  source  {src}");
                for a in &m.agents {
                    let state = if !a.exists {
                        yellow("missing")
                    } else if a.missing.is_empty() && a.differs.is_empty() {
                        green("in sync")
                    } else {
                        yellow(&format!("differs: {}", a.differs.iter().chain(a.missing.iter()).cloned().collect::<Vec<_>>().join(", ")))
                    };
                    println!("  {:<8} {:<28} {}", a.agent, dim(&a.path), state);
                    println!("    servers: {}", if a.servers.is_empty() { dim("none") } else { a.servers.join(", ") });
                }
                header("rules");
                for r in &m.rules {
                    let state = if r.exists { green("✓") } else { dim("·") };
                    println!("  {:<8} {:<32} {}", r.agent, r.path, state);
                }
                println!("\n  {}", dim("sync one: `kula agents mcp <server-name>`"));
            }
        },
        AgentsCmd::Suggestions => {
            let all = agents::suggestions(repo);
            if json {
                println!("{}", serde_json::to_string(&all)?);
                return Ok(());
            }
            if all.is_empty() {
                println!("  {}", dim("no suggestions"));
            }
            for s in all {
                let what = match (&s.guard, &s.workflow) {
                    (Some(g), _) => format!("{} {}", g.level, [g.paths.clone(), g.symbols.clone()].concat().join(", ")),
                    (_, Some(w)) => format!("workflow {} – {}", w.name, w.about),
                    _ => String::new(),
                };
                println!("  {} {}  {}  {}", dim(&format!("#{}", s.id)), bold(&what), dim(&s.by), s.why);
            }
        }
        AgentsCmd::Accept { id } => {
            agents::accept(repo, id)?;
            println!("  {} suggestion #{id} is in kula.toml", green("✓"));
        }
        AgentsCmd::Dismiss { id } => {
            agents::dismiss(repo, id)?;
            println!("  {} dismissed #{id}", green("✓"));
        }
    }
    Ok(())
}

fn task_cmd(repo: &Repo, c: TaskCmd, json: bool) -> Result<()> {
    let show = |t: &guard::Task| {
        if json {
            println!("{}", serde_json::to_string(t).unwrap_or_default());
        } else {
            println!("  {} {}", accent("task"), bold(&t.title));
            if !t.workflow.is_empty() {
                println!("  {} {}", dim("workflow"), t.workflow);
            }
            println!("  {} {}", dim("scope"), if t.scope.is_empty() { "whole repository".into() } else { t.scope.join(", ") });
        }
    };
    match c {
        TaskCmd::Start { title, scope, workflow } => {
            let t = guard::task_start(repo, &title, scope, workflow.as_deref(), &repo.user())?;
            show(&t);
            if !json {
                println!("  {}", dim("agents may change only what is in scope until `kula task done`"));
            }
        }
        TaskCmd::Show => match guard::task(repo) {
            Some(t) => show(&t),
            None if json => println!("null"),
            None => println!("  {}", dim("no active task – agents follow kula.toml's guards only")),
        },
        TaskCmd::Done => match guard::task_done(repo)? {
            Some(t) if !json => println!("  {} {}", green("✓ done"), t.title),
            _ if json => println!("null"),
            _ => println!("  {}", dim("no active task")),
        },
    }
    Ok(())
}

fn memory_cmd(repo: &Repo, c: MemoryCmd, json: bool) -> Result<()> {
    let st = Store::open(repo)?;
    match c {
        MemoryCmd::Add { target, text, by } => {
            let n = memory::remember(repo, &st, &target, &text, &by.unwrap_or_else(|| repo.user()))?;
            if json {
                println!("{}", serde_json::to_string(&n)?);
            } else {
                println!("  {} memory #{} on {}", green("✓"), n.id, bold(&n.target));
            }
        }
        MemoryCmd::Recall { target, query, limit } => {
            let hits = memory::recall(repo, &st, target.as_deref(), query.as_deref(), limit)?;
            if json {
                println!("{}", serde_json::to_string(&hits)?);
                return Ok(());
            }
            if hits.is_empty() {
                println!("  {}", dim("no memories"));
            }
            for h in hits {
                let tag = if h.stale { yellow("stale") } else { green("fresh") };
                println!("  {} {} {}  {}", dim(&format!("#{}", h.id)), tag, bold(&h.target), dim(&format!("{} · {}", h.via, h.author)));
                for l in h.body.lines() {
                    println!("      {l}");
                }
            }
        }
        MemoryCmd::Confirm { id } => {
            let n = memory::confirm(repo, &st, id)?;
            println!("  {} memory #{} re-anchored to {}", green("✓"), n.id, n.target);
        }
        MemoryCmd::Edit { id, text, target } => {
            let n = memory::edit(repo, &st, id, text.as_deref(), target.as_deref())?;
            println!("  {} memory #{} on {}", green("✓"), n.id, bold(&n.target));
        }
        MemoryCmd::Stale { id } => {
            memory::mark_stale(repo, id)?;
            println!("  {} memory #{id} marked stale", yellow("!"));
        }
        MemoryCmd::Rm { id } => {
            meta::note_rm(repo, id)?;
            println!("  {} forgot #{id}", green("✓"));
        }
    }
    Ok(())
}

fn kg_cmd(repo: &Repo, c: KgCmd, json: bool) -> Result<()> {
    let st = Store::open(repo)?;
    match c {
        KgCmd::Export { format, out } => {
            let bytes = kg::export(repo, &st, &format)?;
            match out {
                Some(p) => {
                    std::fs::write(&p, &bytes)?;
                    eprintln!("  {} {} ({} KB)", green("✓"), p.display(), bytes.len() / 1024);
                }
                None => std::io::Write::write_all(&mut std::io::stdout(), &bytes)?,
            }
        }
        KgCmd::Sparql { query, limit } => {
            let q = if query == "-" {
                let mut s = String::new();
                std::io::Read::read_to_string(&mut std::io::stdin(), &mut s)?;
                s
            } else if let Some(f) = query.strip_prefix('@') {
                std::fs::read_to_string(f)?
            } else {
                query
            };
            let r = kg::sparql(repo, &st, &q, limit)?;
            if json {
                println!("{r}");
                return Ok(());
            }
            print_sparql(&r);
        }
        KgCmd::Examples => {
            for (title, q) in kg::EXAMPLES {
                println!("{}\n{}\n", accent(&format!("# {title}")), q);
            }
            println!("{}", dim("run one: kula kg sparql 'SELECT …'   ·   prefixes kula: code: rdf: rdfs: xsd: are predeclared"));
        }
    }
    Ok(())
}

/// A SPARQL result as an aligned table.
fn print_sparql(r: &serde_json::Value) {
    let cell = |v: &serde_json::Value| match v {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    if let Some(b) = r.get("boolean") {
        println!("  {}", if b.as_bool() == Some(true) { green("true") } else { red("false") });
        return;
    }
    if let Some(ts) = r.get("triples").and_then(|t| t.as_array()) {
        for t in ts {
            let t = t.as_array().cloned().unwrap_or_default();
            println!(
                "  {} {} {}",
                t.first().map(cell).unwrap_or_default(),
                dim(&t.get(1).map(cell).unwrap_or_default()),
                t.get(2).map(cell).unwrap_or_default()
            );
        }
        return;
    }
    let vars: Vec<String> =
        r["vars"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
    let rows = r["rows"].as_array().cloned().unwrap_or_default();
    let width: Vec<usize> = vars
        .iter()
        .map(|v| rows.iter().map(|row| row.get(v).map(cell).unwrap_or_default().chars().count().min(60)).max().unwrap_or(0).max(v.len()))
        .collect();
    let line = |vals: Vec<String>| {
        vals.iter()
            .zip(&width)
            .map(|(v, w)| format!("{:w$}", v.chars().take(60).collect::<String>(), w = *w))
            .collect::<Vec<_>>()
            .join("  ")
    };
    println!("  {}", dim(&line(vars.iter().map(|v| format!("?{v}")).collect())));
    for row in &rows {
        println!("  {}", line(vars.iter().map(|v| row.get(v).map(cell).unwrap_or_default()).collect()));
    }
    println!("  {}", dim(&format!("{} row(s){}", rows.len(), if r["truncated"] == true { ", truncated" } else { "" })));
}

mod erased {
    pub trait Json {
        fn to_json(&self) -> String;
    }
    impl<T: serde::Serialize> Json for T {
        fn to_json(&self) -> String {
            serde_json::to_string_pretty(self).unwrap_or_default()
        }
    }
}

fn skill_cmd(root: &std::path::Path, sc: SkillCmd, json: bool) -> Result<()> {
    let wrote = |w: Vec<String>| {
        for f in &w {
            println!("  {} {f}", green("✓"));
        }
        if w.is_empty() {
            println!("  {}", dim("every agent already has the current skills"));
        }
    };
    match sc {
        SkillCmd::List => {
            let (all, strays) = (skills::list(root), skills::strays(root));
            if json {
                println!("{}", serde_json::json!({ "skills": all, "strays": strays }));
                return Ok(());
            }
            if all.is_empty() {
                println!("  {}", dim("no skills yet – `kula skill new <name> -d \"when to use it\"`"));
            }
            for s in &all {
                let t: Vec<String> = s.targets.iter().map(|(a, st)| format!("{a} {st}")).collect();
                println!("  {}  {}\n    {}", accent(&s.name), s.description, dim(&t.join(" · ")));
            }
            for s in &strays {
                println!("  {} {} has {} – `kula skill adopt {} {}`", dim("·"), s.agent, s.name, s.agent, s.name);
            }
        }
        SkillCmd::New { name, description } => {
            skills::save(root, &name, &description, "Describe the steps here.")?;
            println!("  {} .agents/skills/{name}/SKILL.md", green("✓"));
            wrote(skills::sync(root)?);
        }
        SkillCmd::Sync => wrote(skills::sync(root)?),
        SkillCmd::Adopt { agent, name } => wrote(skills::adopt(root, &agent, &name)?),
        SkillCmd::Rm { name } => {
            skills::remove(root, &name)?;
            println!("  {} removed {name} from every agent", green("✓"));
        }
    }
    Ok(())
}
