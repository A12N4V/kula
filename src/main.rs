//! kula – git, with a map.

mod agent;
mod config;
mod git;
mod graph;
mod guard;
mod index;
mod kg;
mod mcp;
mod memory;
mod meta;
mod project;
mod server;
mod store;
mod term;

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
  guard        fences agents may not cross: list, check, and the pre-edit hook
  task         the task an agent is on, and the code it may change
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
    Index {
        /// Only rebuild when HEAD moved since the last index (what the hooks run).
        #[arg(long)]
        if_stale: bool,
        /// Print nothing.
        #[arg(short, long)]
        quiet: bool,
    },
    /// External packages: who imports them, and whether manifests declare them.
    Deps {
        /// Only packages imported but not declared in any manifest.
        #[arg(long)]
        undeclared: bool,
        /// Only packages declared but never imported by indexed code.
        #[arg(long)]
        unused: bool,
    },
    /// Agent context: the code a task needs, ranked by graph distance and fitted to a token budget.
    Pack {
        /// Symbols, files or a question.
        #[arg(required = true)]
        targets: Vec<String>,
        #[arg(short, long, default_value_t = 6000)]
        budget: usize,
    },
    /// Before editing a symbol: callers, tests that reach it, co-changing files, risk, advice.
    Before { symbol: String },
    /// After editing: the worktree against HEAD through the graph; exits 2 on dangling callers.
    Verify,
    /// CI gate: the graph blast radius of HEAD against a base; fails above max_risk.
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
    Hooks {
        #[arg(default_value = "status")]
        action: String,
    },
    /// Open the web UI (graph, changes, history, branches, issues, notes).
    View {
        #[arg(short, long, default_value_t = 7420)]
        port: u16,
        /// Don't open a browser.
        #[arg(long)]
        no_open: bool,
    },
    /// Repository overview: branch, changes, index freshness.
    Status,
    /// Pretty commit graph.
    Lg {
        #[arg(short = 'n', default_value_t = 20)]
        limit: usize,
    },
    /// Search symbols and files.
    Query {
        text: Vec<String>,
        #[arg(short, long, default_value_t = 15)]
        limit: usize,
    },
    /// 360° view of a symbol: callers, callees, container, source.
    Context { symbol: String },
    /// Blast radius of changing a symbol.
    Impact {
        symbol: String,
        /// Follow dependencies (what it uses) instead of dependents.
        #[arg(long)]
        down: bool,
        #[arg(short, long, default_value_t = 3)]
        depth: usize,
    },
    /// Shortest call path between two symbols.
    Trace { from: String, to: String },
    /// Execution flows discovered from entry points.
    Flows {
        #[arg(short, long, default_value_t = 10)]
        limit: usize,
    },
    /// Functional clusters (communities) in the codebase.
    Clusters,
    /// Graph-aware branch comparison.
    Compare { base: String, head: Option<String> },
    /// Contrast the knowledge graphs of two revisions (use WORKTREE for uncommitted code).
    #[command(name = "graph-diff", alias = "gdiff")]
    GraphDiff {
        base: String,
        head: Option<String>,
        /// Also list unchanged symbols' counts per file.
        #[arg(long)]
        all: bool,
    },
    /// Local issues stored in git.
    #[command(subcommand)]
    Issue(IssueCmd),
    /// Proposals – local pull requests between branches.
    #[command(subcommand, name = "pr", alias = "proposal")]
    Pr(PrCmd),
    /// Notes & annotations on the repo, files, symbols or commits.
    #[command(subcommand)]
    Note(NoteCmd),
    /// Fences for AI agents (kula.toml [[guard]]): list them, check paths, or run as an agent's pre-edit hook.
    #[command(subcommand)]
    Guard(GuardCmd),
    /// The task an agent is on, and the part of the code it may change.
    #[command(subcommand)]
    Task(TaskCmd),
    /// Agent memories pinned to symbols and files; marked stale when that code changes.
    #[command(subcommand, alias = "mem")]
    Memory(MemoryCmd),
    /// The knowledge graph as RDF: export Turtle / JSON-LD / N-Triples, or query it in SPARQL.
    #[command(subcommand)]
    Kg(KgCmd),
    /// Push/pull issues, proposals and notes with a remote.
    Sync {
        #[arg(default_value = "origin")]
        remote: String,
    },
    /// Serve the graph to AI agents over MCP (stdio).
    Mcp,
    /// Check the environment.
    Doctor,
    /// Explicit git passthrough: `kula git <args>`.
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
    List {
        #[arg(long)]
        all: bool,
    },
    /// Show one issue.
    Show { id: u64 },
    /// Close an issue.
    Close { id: u64 },
    /// Reopen an issue.
    Reopen { id: u64 },
    /// Comment on an issue.
    Comment { id: u64, body: String },
}

#[derive(Subcommand)]
enum PrCmd {
    /// Propose merging HEAD (or --head) into --base.
    New {
        title: String,
        #[arg(long, default_value = "main")]
        base: String,
        #[arg(long)]
        head: Option<String>,
        #[arg(short, long, default_value = "")]
        body: String,
    },
    List {
        #[arg(long)]
        all: bool,
    },
    /// Show a proposal with its graph impact.
    Show {
        id: u64,
    },
    /// Merge (no-ff) into the base branch.
    Merge {
        id: u64,
    },
    Close {
        id: u64,
    },
    Comment {
        id: u64,
        body: String,
    },
}

#[derive(Subcommand)]
enum GuardCmd {
    /// Every guard rule, the active task, and the files they fence.
    List,
    /// Exit 1 if an agent may not edit these paths (or the staged files).
    Check {
        paths: Vec<String>,
        /// Check the files staged for commit.
        #[arg(long)]
        staged: bool,
    },
    /// Agent pre-tool hook: reads the tool call as JSON on stdin, exits 2 to block a fenced edit or read.
    Hook,
}

#[derive(Subcommand)]
enum TaskCmd {
    /// Start a task; --scope limits what agents may change (globs or symbol names).
    Start {
        title: String,
        #[arg(short, long, num_args = 1..)]
        scope: Vec<String>,
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
        eprintln!("{} {e:#}", red("✗"));
        std::process::exit(1);
    }
}

fn passthrough(dir: &std::path::Path, args: &[String]) -> Result<()> {
    let status = std::process::Command::new("git").arg("-C").arg(dir).args(args).status()?;
    std::process::exit(status.code().unwrap_or(1));
}

fn print_node(n: &store::Node) {
    println!("  {} {}  {}", community(n.community, kind_glyph(&n.kind)), bold(&n.name), dim(&format!("{}:{}", n.path, n.start_line)));
}

fn run(cli: Cli) -> Result<()> {
    let cwd = cli.dir.clone().unwrap_or(std::env::current_dir()?);
    let json = cli.json;
    let Some(cmd) = cli.cmd else {
        println!("{}", accent(BANNER));
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
            let r = agent::verify_edit(&repo)?;
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
        Cmd::Status => status(&repo, json)?,
        Cmd::Lg { limit } => {
            let n = format!("-n{limit}");
            passthrough(
                &repo.root,
                &[
                    "log".into(),
                    "--graph".into(),
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
        Cmd::Memory(mc) => memory_cmd(&repo, mc, json)?,
        Cmd::Kg(kc) => kg_cmd(&repo, kc, json)?,
        Cmd::Sync { remote } => print!("{}", meta::sync(&repo, &remote)?),
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
    header(&format!("{}  {}", repo.name(), accent(&format!(" {}", repo.branch()))));
    let idx = match fresh {
        "current" => green("● graph current"),
        "stale" => yellow("● graph behind HEAD – run `kula index`"),
        _ => dim("○ no graph yet – run `kula index`"),
    };
    println!("  {idx}\n");
    if files.is_empty() {
        println!("  {}", dim("working tree clean"));
    }
    let staged: Vec<_> = files.iter().filter(|f| f.staged).collect();
    let unstaged: Vec<_> = files.iter().filter(|f| f.unstaged && !f.untracked).collect();
    let untracked: Vec<_> = files.iter().filter(|f| f.untracked).collect();
    for (title, list, col) in [("staged", staged, 0), ("changed", unstaged, 1), ("untracked", untracked, 2)] {
        if list.is_empty() {
            continue;
        }
        println!("  {}", bold(title));
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

/// A path as the repository sees it: relative, forward slashes.
fn repo_rel(repo: &Repo, p: &str) -> String {
    let pb = std::path::Path::new(p);
    let rel = if pb.is_absolute() {
        let root = repo.root.canonicalize().unwrap_or(repo.root.clone());
        let full = pb.canonicalize().unwrap_or(pb.to_path_buf());
        full.strip_prefix(&root).map(|r| r.to_path_buf()).unwrap_or(full)
    } else {
        pb.to_path_buf()
    };
    rel.to_string_lossy().replace('\\', "/").trim_start_matches("./").to_string()
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
            let mut paths: Vec<String> = paths.iter().map(|p| repo_rel(repo, p)).collect();
            if staged {
                paths.extend(repo.run(&["diff", "--cached", "--name-only"])?.lines().map(String::from));
            }
            let bad = guard::violations(repo, st.as_ref(), &paths)?;
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
        GuardCmd::Hook => {
            // Claude Code's PreToolUse protocol (and any agent that sends a tool call as JSON):
            // exit 0 lets it run; exit 2 blocks it and the message on stderr goes back to the agent.
            let mut input = String::new();
            std::io::Read::read_to_string(&mut std::io::stdin(), &mut input)?;
            let v: serde_json::Value = serde_json::from_str(&input).unwrap_or_default();
            let tool = v["tool_name"].as_str().unwrap_or("");
            let ti = &v["tool_input"];
            let path = ["file_path", "notebook_path", "path"].iter().find_map(|k| ti[*k].as_str().or_else(|| v[*k].as_str()));
            let Some(path) = path else { return Ok(()) };
            let rel = repo_rel(repo, path);
            if rel.starts_with('/') || rel.starts_with("..") {
                return Ok(()); // outside this repository: not ours to fence
            }
            let g = guard::Guards::load(repo)?;
            let reads = matches!(tool, "Read" | "Grep" | "Glob" | "NotebookRead" | "LS" | "View" | "read_file");
            let verdict = if reads { g.path(&rel) } else { g.edit(st.as_ref(), &rel) };
            let blocked = if reads { !verdict.level.readable() } else { !verdict.level.editable() };
            if blocked {
                let what = match verdict.level {
                    guard::Level::Scope => "outside the active task".to_string(),
                    l => format!("{} for agents", l.as_str()),
                };
                eprintln!(
                    "kula guard: {} is {} – {} ({}). {}",
                    rel,
                    what,
                    verdict.reason,
                    verdict.rule,
                    if verdict.level == guard::Level::Scope {
                        "Stay inside the task's scope, or ask the user to widen it with `kula task start --scope`."
                    } else {
                        "Leave it to a person, or ask the user to change kula.toml."
                    }
                );
                std::process::exit(2);
            }
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
            println!("  {} {}", dim("scope"), if t.scope.is_empty() { "whole repository".into() } else { t.scope.join(", ") });
        }
    };
    match c {
        TaskCmd::Start { title, scope } => {
            let t = guard::task_start(repo, &title, scope)?;
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
