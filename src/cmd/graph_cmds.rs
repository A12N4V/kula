//! Graph query commands: impact, trace and flows.
use crate::*;

pub(crate) fn run(repo: &Repo, cmd: &Cmd, json: bool) -> Result<()> {
    let out = |v: &dyn erased::Json| println!("{}", v.to_json());
    match cmd {
        Cmd::Impact { symbol, down, depth, min_confidence } => {
            let st = Store::open(repo)?;
            let n = graph::resolve_one(&st, symbol)?;
            let imp = graph::impact_min(&st, n.id, !*down, *depth, min_confidence)?;
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
            for d in 1..=*depth {
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
            let st = Store::open(repo)?;
            let a = graph::resolve_one(&st, from)?;
            let b = graph::resolve_one(&st, to)?;
            let t = graph::trace_conf(&st, a.id, b.id, min_confidence)?;
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
                println!("  {} resolved {} · inferred {} · guessed {}", dim("tiers"), t.tiers[0], t.tiers[1], t.tiers[2]);
            }
        }
        Cmd::Flows { limit, ordered: true } => {
            let m = graph::flowmap(&Store::open(repo)?, *limit)?;
            if json {
                out(&m);
                return Ok(());
            }
            header("flow map");
            for d in &m.domains {
                println!("  {} {}", bold(&d.label), dim(&format!("{} flows", d.flows)));
                for fl in m.flows.iter().filter(|f| f.domain == d.id) {
                    let what = fl.route.clone().unwrap_or_else(|| fl.entry.name.clone());
                    println!("    {} {}  {}", accent("▶"), bold(&what), dim(fl.kind));
                    for s in fl.steps.iter().skip(1) {
                        let pad = "  ".repeat(s.depth);
                        let flag = s.branch.map(|b| format!(" [{b}]")).unwrap_or_default();
                        println!("    {pad}{}{}  {}", s.name, dim(&flag), dim(&format!("{}:{}", s.path, s.line)));
                    }
                }
            }
        }
        Cmd::Flows { limit, .. } => {
            let st = Store::open(repo)?;
            let f = graph::flows(&st, *limit)?;
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
        _ => {}
    }
    Ok(())
}
