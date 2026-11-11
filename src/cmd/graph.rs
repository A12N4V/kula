use crate::*;

pub(crate) fn graph_cmd(repo: &Repo, gc: GraphCmd, json: bool) -> Result<()> {
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

pub(crate) fn print_node(n: &store::Node) {
    println!("  {} {}  {}", community(n.community, kind_glyph(&n.kind)), bold(&n.name), dim(&format!("{}:{}", n.path, n.start_line)));
}

/// The store, building the graph first if this repo has none yet.
pub(crate) fn open_or_index(repo: &Repo) -> Result<Store> {
    if !Store::path(repo).exists() {
        eprint!("{} first run – indexing …", accent("◯"));
        index::run(repo, false)?;
    }
    Store::open(repo)
}

pub(crate) fn print_compare(c: &graph::Compare) {
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

pub(crate) fn print_graph_diff(d: &graph::GraphDiff) {
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
