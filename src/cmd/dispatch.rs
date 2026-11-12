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
            let dangling = match (&st, crate::guard::Guards::load(&repo)) {
                (Some(s), Ok(g)) => g.dangling_symbols(s),
                _ => vec![],
            };
            if json {
                let mut v = serde_json::to_value(&r)?;
                v["dangling_guards"] = serde_json::json!(dangling);
                out(&v);
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
                if !dangling.is_empty() {
                    println!("  {} guard names a symbol that no longer exists (fence is inactive): {}", yellow("!"), dangling.join(", "));
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
        Cmd::Impact { symbol, down, depth, min_confidence } => {
            let st = Store::open(&repo)?;
            let n = graph::resolve_one(&st, &symbol)?;
            let imp = graph::impact_min(&st, n.id, !down, depth, &min_confidence)?;
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
            println!("  edges: {} resolved · {} inferred · {} guessed\n", imp.tiers[0], imp.tiers[1], imp.tiers[2]);
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
        Cmd::Trace { from, to, min_confidence } => {
            let st = Store::open(&repo)?;
            let a = graph::resolve_one(&st, &from)?;
            let b = graph::resolve_one(&st, &to)?;
            let t = graph::trace_conf(&st, a.id, b.id, &min_confidence)?;
            let path = &t.path;
            if json {
                out(&t);
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
            if !path.is_empty() {
                println!(
                    "  {} resolved {} · inferred {} · guessed {}",
                    dim("tiers"),
                    t.tiers[0],
                    t.tiers[1],
                    t.tiers[2]
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
        Cmd::Doctor | Cmd::Lang(_) | Cmd::Init { .. } | Cmd::Git { .. } | Cmd::External(_) => unreachable!(),
    }
    Ok(())
}
