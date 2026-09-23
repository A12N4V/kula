//! kula — git, with a map.

mod git;
mod graph;
mod index;
mod mcp;
mod meta;
mod server;
mod store;
mod term;

use anyhow::{bail, Result};
use clap::{Parser, Subcommand};
use git::Repo;
use store::Store;
use term::*;

#[derive(Parser)]
#[command(
    name = "kula",
    version,
    about = "git, with a map — a local-first git client with a knowledge-graph view",
    long_about = "Kula is a superset of git. Any git command works (`kula commit`, `kula rebase -i`…),\nplus a knowledge graph of your code, local issues & proposals, notes, and a web UI.",
    after_help = "Any command not listed here is passed straight to git.\nExamples:\n  kula index            build the knowledge graph\n  kula view             open the graph + git UI at localhost\n  kula impact parseArgs what breaks if I change parseArgs?\n  kula compare main feat/x   graph-aware branch diff\n  kula commit -am \"fix\"  plain git passthrough"
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
    /// Build or rebuild the knowledge graph (.kula/graph.db).
    Index,
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
    Query { text: Vec<String>, #[arg(short, long, default_value_t = 15)] limit: usize },
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
    Flows { #[arg(short, long, default_value_t = 10)] limit: usize },
    /// Functional clusters (communities) in the codebase.
    Clusters,
    /// Graph-aware branch comparison.
    Compare { base: String, head: Option<String> },
    /// Local issues stored in git.
    #[command(subcommand)]
    Issue(IssueCmd),
    /// Proposals — local pull requests between branches.
    #[command(subcommand, name = "pr", alias = "proposal")]
    Pr(PrCmd),
    /// Notes & annotations on the repo, files, symbols or commits.
    #[command(subcommand)]
    Note(NoteCmd),
    /// Push/pull issues, proposals and notes with a remote.
    Sync { #[arg(default_value = "origin")] remote: String },
    /// Serve the graph to AI agents over MCP (stdio).
    Mcp,
    /// Check the environment.
    Doctor,
    /// Explicit git passthrough: `kula git <args>`.
    Git { #[arg(trailing_var_arg = true, allow_hyphen_values = true)] args: Vec<String> },
    #[command(external_subcommand)]
    External(Vec<String>),
}

#[derive(Subcommand)]
enum IssueCmd {
    /// Open an issue.
    New { title: String, #[arg(short, long, default_value = "")] body: String, #[arg(short, long)] label: Vec<String>, /// Anchor to a symbol or file.
        #[arg(short, long)] anchor: Vec<String> },
    /// List issues.
    List { #[arg(long)] all: bool },
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
    New { title: String, #[arg(long, default_value = "main")] base: String, #[arg(long)] head: Option<String>, #[arg(short, long, default_value = "")] body: String },
    List { #[arg(long)] all: bool },
    /// Show a proposal with its graph impact.
    Show { id: u64 },
    /// Merge (no-ff) into the base branch.
    Merge { id: u64 },
    Close { id: u64 },
    Comment { id: u64, body: String },
}

#[derive(Subcommand)]
enum NoteCmd {
    /// Add a note. Target: repo | file:<path> | symbol:<name> | commit:<sha>.
    Add { target: String, body: String },
    List { #[arg(long)] target: Option<String> },
    Edit { id: u64, body: String },
    Rm { id: u64 },
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
    println!(
        "  {} {}  {}",
        community(n.community, kind_glyph(&n.kind)),
        bold(&n.name),
        dim(&format!("{}:{}", n.path, n.start_line))
    );
}

fn run(cli: Cli) -> Result<()> {
    let cwd = cli.dir.clone().unwrap_or(std::env::current_dir()?);
    let json = cli.json;
    let Some(cmd) = cli.cmd else {
        println!("{}", accent(BANNER));
        println!("  {} build the graph      {} open the UI      {} all commands\n", bold("kula index"), bold("kula view"), bold("kula --help"));
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
    let repo = Repo::discover(&cwd)?;
    let out = |v: &dyn erased::Json| println!("{}", v.to_json());

    match cmd {
        Cmd::Index => {
            eprint!("{} indexing {} …", accent("◯"), bold(&repo.name()));
            let s = index::run(&repo, false)?;
            if json {
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
        Cmd::View { port, no_open } => {
            if !Store::path(&repo).exists() {
                eprint!("{} first run — indexing …", accent("◯"));
                index::run(&repo, false)?;
            }
            server::serve(repo, port, !no_open)?;
        }
        Cmd::Status => status(&repo, json)?,
        Cmd::Lg { limit } => {
            let n = format!("-n{limit}");
            passthrough(&repo.root, &["log".into(), "--graph".into(), "--all".into(), n, "--format=%C(auto)%h%d %s %C(dim)· %an, %ar%C(reset)".into(), "--color=auto".into()])?;
        }
        Cmd::Query { text, limit } => {
            let st = Store::open(&repo)?;
            let hits = st.search(&text.join(" "), limit)?;
            if json {
                return Ok(out(&hits));
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
                return Ok(out(&c));
            }
            header(&format!("{} {} {}", kind_glyph(&c.node.kind), c.node.name, dim(&format!("{}:{}-{}", c.node.path, c.node.start_line, c.node.end_line))));
            if let Some(cm) = &c.community {
                println!("  {} {}", dim("cluster"), community(c.node.community, cm));
            }
            for (label, list) in [("callers", &c.callers), ("callees", &c.callees), ("contains", &c.children), ("imports", &c.imports), ("imported by", &c.imported_by)] {
                if list.is_empty() {
                    continue;
                }
                println!("\n  {} {}", bold(label), dim(&format!("({})", list.len())));
                for x in list.iter().take(25) {
                    print_node(x);
                }
            }
            let notes: Vec<_> = meta::load(&repo)?.notes.into_iter().filter(|x| x.target.ends_with(&c.node.name) || x.target.ends_with(&c.node.path)).collect();
            if !notes.is_empty() {
                println!("\n  {}", bold("notes"));
                for x in notes {
                    println!("  {} {} {}", magenta("✎"), x.body, dim(&format!("— {}", x.author)));
                }
            }
        }
        Cmd::Impact { symbol, down, depth } => {
            let st = Store::open(&repo)?;
            let n = graph::resolve_one(&st, &symbol)?;
            let imp = graph::impact(&st, n.id, !down, depth)?;
            if json {
                return Ok(out(&imp));
            }
            header(&format!("impact of {} {}", bold(&imp.root.name), dim(&format!("({})", imp.direction))));
            println!("  risk {}   {} symbols · {} files · {} clusters\n", risk(&imp.risk), imp.hits.len(), imp.files, imp.communities.len());
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
                return Ok(out(&path));
            }
            if path.is_empty() {
                println!("{} no call path from {} to {}", dim("○"), a.name, b.name);
            }
            for (i, n) in path.iter().enumerate() {
                println!("  {}{} {}  {}", "  ".repeat(i), if i == 0 { accent("●") } else { dim("└→") }, bold(&n.name), dim(&format!("{}:{}", n.path, n.start_line)));
            }
        }
        Cmd::Flows { limit } => {
            let st = Store::open(&repo)?;
            let f = graph::flows(&st, limit)?;
            if json {
                return Ok(out(&f));
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
                return Ok(out(&c));
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
                return Ok(out(&c));
            }
            print_compare(&c);
        }
        Cmd::Issue(ic) => issue_cmd(&repo, ic, json)?,
        Cmd::Pr(pc) => pr_cmd(&repo, pc, json)?,
        Cmd::Note(nc) => note_cmd(&repo, nc, json)?,
        Cmd::Sync { remote } => print!("{}", meta::sync(&repo, &remote)?),
        Cmd::Mcp => mcp::run(repo)?,
        Cmd::Doctor | Cmd::Git { .. } | Cmd::External(_) => unreachable!(),
    }
    Ok(())
}

fn print_compare(c: &graph::Compare) {
    header(&format!("{} {} {}", c.base, dim("…"), c.head));
    println!("  {} ahead · {} behind · {} files · {} symbols touched · risk {}\n", green(&c.ahead.to_string()), red(&c.behind.to_string()), c.files.len(), c.touched, risk(&c.risk));
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

fn status(repo: &Repo, json: bool) -> Result<()> {
    let files = repo.status()?;
    let st = Store::open(repo).ok();
    let indexed = st.as_ref().and_then(|s| s.meta("indexed_head"));
    let head = repo.head();
    let fresh = match (&indexed, &head) {
        (None, _) => "missing",
        (Some(i), Some(h)) if i == h => "current",
        _ => "stale",
    };
    if json {
        println!("{}", serde_json::json!({ "branch": repo.branch(), "head": head, "index": fresh, "files": files }));
        return Ok(());
    }
    header(&format!("{}  {}", repo.name(), accent(&format!(" {}", repo.branch()))));
    let idx = match fresh {
        "current" => green("● graph current"),
        "stale" => yellow("● graph behind HEAD — run `kula index`"),
        _ => dim("○ no graph yet — run `kula index`"),
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
            let c = match col { 0 => green(code), 1 => yellow(code), _ => dim("?") };
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
                println!("  {dot} {} {}{}  {}", accent(&format!("#{}", i.id)), i.title, labels, dim(&format!("{} · {}", i.author, rel_time(i.created))));
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
                println!("  {} {}  {}", blue("│"), c.body, dim(&format!("— {}, {}", c.author, rel_time(c.at))));
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
                let dot = match p.status.as_str() { "open" => green("●"), "merged" => magenta("◆"), _ => dim("○") };
                println!("  {dot} {} {}  {}", accent(&format!("#{}", p.id)), p.title, dim(&format!("{} → {} · {}", p.head, p.base, rel_time(p.created))));
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
                println!("  {} {}  {}", blue("│"), c.body, dim(&format!("— {}, {}", c.author, rel_time(c.at))));
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
                println!("  {} {} {}  {}", magenta("✎"), accent(&format!("#{}", n.id)), bold(&n.target), dim(&format!("{} · {}", n.author, rel_time(n.updated))));
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
                Err(_) => println!("  {} no graph — run `kula index`", yellow("●")),
            }
        }
        Err(_) => println!("  {} not inside a git repository", yellow("●")),
    }
    println!("  {} kula {}", green("✓"), env!("CARGO_PKG_VERSION"));
    Ok(())
}

/// Object-safe JSON printing for heterogeneous command results.
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
