//! `kula plan`, `kula gate`, `kula run-plan`: CLI glue over `crate::orch`.

use crate::orch::{gate, plan, run, task};
use crate::*;

pub(crate) fn run(repo: &Repo, cmd: Cmd, json: bool) -> Result<()> {
    match cmd {
        Cmd::Plan { goal, agent, out, test_cmd, max_parallel, max_retries } => {
            let st = open_or_index(repo)?;
            let p = plan::plan(repo, &st, plan::Opts { goal, agent, test_cmd, max_parallel, max_retries })?;
            let path = out.unwrap_or_else(|| task::default_path(repo));
            p.save(&path)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&p)?);
                return Ok(());
            }
            println!("{} {}  {}", bold(&p.id), dim(&format!("risk {}", p.risk)), dim(&path.display().to_string()));
            for s in &p.slices {
                let deps = if s.deps.is_empty() { String::new() } else { format!("  after {}", s.deps.join(", ")) };
                println!("  {} {}{}", accent(&s.id), s.scope.join(", "), dim(&deps));
                if !s.tests.is_empty() {
                    println!("      {}", dim(&format!("tests {}", s.tests.join(", "))));
                }
            }
            println!("  {}", dim("run it: kula run-plan"));
        }
        Cmd::Gate { slice, plan, dir } => {
            let path = plan.unwrap_or_else(|| task::default_path(repo));
            let p = task::Plan::load(&path)?;
            let Some(s) = p.slice(&slice) else { bail!("no slice called {slice} in {}", path.display()) };
            let dir = dir.unwrap_or_else(|| {
                let wt = p.worktree(repo, &slice);
                if wt.exists() {
                    wt
                } else {
                    repo.root.clone()
                }
            });
            let v = gate::gate(&p, s, &dir)?;
            if json {
                println!("{}", serde_json::to_string(&v)?);
            } else {
                println!("{} {}", bold(&slice), v.verdict.as_str());
                for r in &v.reasons {
                    println!("  {} {r}", dim("·"));
                }
            }
            std::process::exit(v.verdict.code());
        }
        Cmd::RunPlan { plan } => {
            let path = plan.unwrap_or_else(|| task::default_path(repo));
            let p = run::run_plan(repo, &path)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&p)?);
            } else {
                for s in &p.slices {
                    let tag = format!("{:?}", s.state).to_lowercase();
                    println!(
                        "  {} {}  {}",
                        accent(&s.id),
                        tag,
                        dim(&format!("{} attempt{}", s.attempts, if s.attempts == 1 { "" } else { "s" }))
                    );
                    for r in &s.reasons {
                        println!("      {}", dim(r.lines().next().unwrap_or("")));
                    }
                }
            }
            let ok = p.slices.iter().all(|s| s.state == task::SliceState::Passed);
            std::process::exit(if ok { 0 } else { 1 });
        }
        _ => unreachable!(),
    }
    Ok(())
}
