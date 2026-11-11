use crate::*;

pub(crate) fn research_cmd(repo: &Repo, c: ResearchCmd, json: bool) -> Result<()> {
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
