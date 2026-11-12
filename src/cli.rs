use crate::*;
use clap::{Parser, Subcommand};

/// `kula --help`: the commands grouped by what you're doing, not alphabetically.
pub(crate) const HELP: &str = "\
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
  map          semantic map: packages, modules, symbols, cycles and coupling
  explain      one page about a module, file or symbol

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
pub(crate) struct Cli {
    /// Run as if started in this directory.
    #[arg(short = 'C', global = true, value_name = "PATH")]
    pub(crate) dir: Option<std::path::PathBuf>,
    /// Emit JSON instead of human output (graph commands).
    #[arg(long, global = true)]
    pub(crate) json: bool,
    #[command(subcommand)]
    pub(crate) cmd: Option<Cmd>,
}

#[derive(Subcommand)]
pub(crate) enum Cmd {
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
    Before {
        symbol: String,
        /// Ignore call edges weaker than this tier: guessed, inferred or resolved.
        #[arg(long, default_value = "guessed", value_parser = ["guessed", "inferred", "resolved"])]
        min_confidence: String,
    },
    /// After editing: the worktree against HEAD through the graph; exits 2 on dangling callers.
    #[command(after_help = "Examples:\n  kula verify")]
    Verify {
        /// Report and act only on call edges at or above this tier: guessed, inferred or resolved.
        #[arg(long, default_value = "guessed", value_parser = ["guessed", "inferred", "resolved"])]
        min_confidence: String,
    },
    /// CI gate: the graph blast radius of HEAD against a base; fails above max_risk.
    #[command(
        after_help = "Examples:\n  kula check --base origin/main --md   ·  kula check --max-risk low\n  kula check architecture              ·  cycle, god module and coupling report"
    )]
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
        /// `architecture` runs the architecture checks instead of the blast radius gate.
        #[arg(value_name = "TARGET")]
        target: Option<String>,
    },
    /// Git hooks that keep the graph current: install | uninstall | status.
    #[command(after_help = "Examples:\n  kula hooks install   ·  kula hooks status")]
    Hooks {
        #[arg(default_value = "status")]
        action: String,
    },
    /// Semantic map: packages, modules and symbols with loc, fan-in/out and churn.
    #[command(
        after_help = "Examples:\n  kula map                        ·  kula map --zoom repo --format json\n  kula map --format mermaid       ·  kula map --zoom symbol"
    )]
    Map {
        /// How deep: repo | package | module | symbol.
        #[arg(long, default_value = "module", value_parser = ["repo", "package", "module", "symbol"])]
        zoom: String,
        /// md | json | mermaid.
        #[arg(long, default_value = "md", value_parser = ["md", "json", "mermaid"])]
        format: String,
    },
    /// One page about a module, file or symbol: purpose, surface, dependents, hot spots.
    #[command(after_help = "Examples:\n  kula explain src/map   ·  kula explain pong")]
    Explain {
        /// A module (directory), a file path or a symbol name.
        #[arg(required = true)]
        target: String,
    },
    /// One page for an agent new to this repo: packages, entries, hot spots, warnings.
    #[command(after_help = "Examples:\n  kula brief   ·  kula brief --format json")]
    Brief {
        /// md | json.
        #[arg(long, default_value = "md", value_parser = ["md", "json"])]
        format: String,
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
        /// Ignore call edges weaker than this tier: guessed, inferred or resolved.
        #[arg(long, default_value = "guessed", value_parser = ["guessed", "inferred", "resolved"])]
        min_confidence: String,
    },
    /// Shortest call path between two symbols.
    #[command(after_help = "Examples:\n  kula trace handleLogin salt")]
    Trace {
        from: String,
        to: String,
        /// Ignore call edges weaker than this tier: guessed, inferred or resolved.
        #[arg(long, default_value = "guessed", value_parser = ["guessed", "inferred", "resolved"])]
        min_confidence: String,
    },
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
    /// Language packs: `kula lang list`, `kula lang add <ids…>`, `kula lang remove <id>`.
    #[command(subcommand)]
    Lang(lang_cmd::LangCmd),
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
pub(crate) enum IssueCmd {
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
pub(crate) enum PrCmd {
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
pub(crate) enum GuardCmd {
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
pub(crate) enum WorkflowCmd {
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
pub(crate) enum TeamCmd {
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
pub(crate) enum SkillCmd {
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
pub(crate) enum ResearchCmd {
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
pub(crate) enum AgentsCmd {
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
pub(crate) enum GraphCmd {
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
pub(crate) enum TaskCmd {
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
pub(crate) enum MemoryCmd {
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
pub(crate) enum KgCmd {
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
pub(crate) enum NoteCmd {
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
