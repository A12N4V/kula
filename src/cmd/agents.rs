use crate::*;

pub(crate) fn agents_cmd(repo: &Repo, c: AgentsCmd, json: bool) -> Result<()> {
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
