use crate::*;

pub(crate) fn run(cli: Cli) -> Result<()> {
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
    if let Cmd::Lang(lc) = cmd {
        return lang_cmd::run(&cwd, lc, json);
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

    if let Cmd::Before { symbol, min_confidence } = &cmd {
        return cmd::agent_cmds::before(&repo, symbol, min_confidence, json);
    }
    if let Cmd::Verify { min_confidence } = &cmd {
        return cmd::agent_cmds::verify(&repo, min_confidence, json);
    }
    if matches!(cmd, Cmd::Impact { .. } | Cmd::Trace { .. } | Cmd::Flows { .. }) {
        return cmd::graph_cmds::run(&repo, &cmd, json);
    }
    if let Cmd::Map { zoom, format } = &cmd {
        return cmd::map::run_map(&repo, zoom, format, json);
    }
    if let Cmd::Explain { target } = &cmd {
        return cmd::map::run_explain(&repo, target, json);
    }
    if matches!(cmd, Cmd::Plan { .. } | Cmd::Gate { .. } | Cmd::RunPlan { .. } | Cmd::MergeTrain { .. }) {
        return cmd::orch::run(&repo, cmd, json);
    }
    if let Cmd::Brief { format } = &cmd {
        return cmd::map::run_brief(&repo, format, json);
    }
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
            let all = layers::deps::report(&st)?;
            let list: Vec<&layers::deps::Dep> = all
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
        Cmd::Check { base, max_risk, md, target } => match target.as_deref() {
            Some("architecture") => cmd::project_cmds::check_architecture(&repo, md, json)?,
            Some(other) => {
                return Err(anyhow::anyhow!("unknown check target '{other}'; try 'architecture' or no target for the blast radius gate"));
            }
            None => cmd::project_cmds::check(&repo, base, max_risk, md, json)?,
        },
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
            // `kula query route:/PATH`: HTTP endpoints under a path, with handlers.
            if let Some(prefix) = text.join(" ").strip_prefix("route:") {
                let st = Store::open(&repo)?;
                let rows = layers::routes::routes(&st, prefix)?;
                if json {
                    out(&rows);
                    return Ok(());
                }
                if rows.is_empty() {
                    println!("{}", dim("no routes"));
                }
                for r in &rows {
                    let h = match (&r.handler, &r.confidence) {
                        (Some(h), Some(c)) => format!("→ {h} {}", dim(c)),
                        _ => dim("→ no handler found"),
                    };
                    println!("  {} {} {}", bold(&r.route), h, dim(&format!("{}:{}", r.file, r.line)));
                }
                return Ok(());
            }
            // `kula query table:NAME`: who maps, migrates and uses one table.
            if let Some(name) = text.join(" ").strip_prefix("table:") {
                let st = Store::open(&repo)?;
                let users = layers::tables::users(&st, name)?;
                layers::tables::print(&users, name, json);
                return Ok(());
            }
            // `kula query env:NAME`: who reads one env var (file, symbol, line).
            if let Some(name) = text.join(" ").strip_prefix("env:") {
                let st = Store::open(&repo)?;
                let readers = layers::env::readers(&st, name)?;
                if json {
                    out(&readers);
                    return Ok(());
                }
                if readers.is_empty() {
                    println!("{}", dim(format!("no reader of {name}").as_str()));
                }
                for r in &readers {
                    match &r.symbol {
                        Some(s) => println!("  {} {} {} {}", bold(&r.file), s, dim(&format!("line {}", r.line)), dim("reads")),
                        None => println!("  {} {} {}", bold(&r.file), dim(&format!("line {}", r.line)), dim("declares")),
                    }
                }
                return Ok(());
            }
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
        Cmd::Sync { remote, overwrite } => cmd::project_cmds::sync(&repo, remote, overwrite)?,
        Cmd::Share { remote } => cmd::project_cmds::share(&repo, remote)?,
        Cmd::Mcp => mcp::run(repo)?,
        Cmd::Doctor | Cmd::Lang(_) | Cmd::Init { .. } | Cmd::Git { .. } | Cmd::External(_) => unreachable!(),
        _ => unreachable!(),
    }
    Ok(())
}
