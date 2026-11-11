use crate::*;

pub(crate) fn workflow_lines(w: &workflow::Workflow) {
    println!("  {} {}  {}", accent(&w.name), dim(if w.builtin { "built in" } else { "kula.toml" }), w.about);
    let row = |k: &str, v: &[String]| {
        if !v.is_empty() {
            println!("    {:<8}{}", dim(k), v.join(", "));
        }
    };
    row("scope", &w.scope);
    row("lock", &w.lock);
    row("hide", &w.hide);
    row("review", &w.review);
    println!("    {:<8}{}", dim("memory"), w.memory_policy());
    row("docs", &w.docs);
    for (i, s) in w.steps.iter().enumerate() {
        println!("    {:<8}{}. {s}", dim(if i == 0 { "steps" } else { "" }), i + 1);
    }
}

pub(crate) fn workflow_cmd(repo: &Repo, c: WorkflowCmd, json: bool) -> Result<()> {
    let cfg = config::Config::load(&repo.root)?;
    let active = guard::task(repo).map(|t| t.workflow).unwrap_or_default();
    match c {
        WorkflowCmd::List => {
            let all = workflow::all(&cfg);
            if json {
                println!("{}", serde_json::json!({ "workflows": all, "active": active }));
                return Ok(());
            }
            header("workflows");
            for w in all {
                let on = if w.name == active { green(" ● active") } else { String::new() };
                println!("  {:<10} {}{}", accent(&w.name), w.about, on);
            }
            println!(
                "
  {}",
                dim("kula task start \"<title>\" --workflow <name>  ·  kula workflow show <name>")
            );
        }
        WorkflowCmd::Show { name } => {
            let Some(w) = workflow::find(&cfg, &name) else { bail!("no workflow called {name}") };
            if json {
                println!("{}", serde_json::to_string(&w)?);
            } else {
                workflow_lines(&w);
            }
        }
        WorkflowCmd::Install { name, agents: ids } => {
            let ids: Vec<&str> =
                if ids.iter().any(|a| a == "all") { vec!["claude", "cursor", "gemini"] } else { ids.iter().map(String::as_str).collect() };
            let files = agents::install_workflow(&repo.root, &cfg, &name, &ids)?;
            for f in &files {
                println!("  {} {}", green("✓"), f);
            }
            println!("  {}", dim(&format!("any other harness: kula run -w {name} -- <command>  ·  kula workflow prompt {name}")));
        }
        WorkflowCmd::Prompt { name } => {
            let Some(w) = workflow::find(&cfg, &name) else { bail!("no workflow called {name}") };
            print!("{}", agents::workflow_prompt(&w));
        }
    }
    Ok(())
}
