//! kula – git, with a map.

mod agent;
mod agent_config;
mod agents;
mod cache;
mod clean;
mod cli;
mod cmd;
mod config;
mod events;
mod graph;
mod guard;
mod index;
mod isolate;
mod kg;
mod lang_cmd;
mod layers;
mod mcp;
mod memory;
mod meta;
mod orch;
mod project;
mod research;
mod run;
mod server;
mod setup;
mod skills;
mod term;
mod workflow;

use anyhow::{bail, Result};
use clap::Parser;
use cli::*;
use cmd::*;
use kula::git::Repo;
use kula::store::Store;
pub use kula::{git, map, store};
use term::*;

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
