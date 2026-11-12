//! `kula plan`, `kula gate`, `kula run-plan`, `kula merge-train`: CLI glue over `crate::orch`.

use crate::orch::{gate, plan, run, task, train};
use crate::*;

pub(crate) fn run(repo: &Repo, cmd: Cmd, json: bool) -> Result<()> {
    match cmd {
        Cmd::Plan { goal, agent, out, test_cmd, max_parallel, max_retries, mem_check } => {
            let st = open_or_index(repo)?;
            let p = plan::plan(repo, &st, plan::Opts { goal, agent, test_cmd, max_parallel, max_retries, mem_check })?;
            let path = out.unwrap_or_else(|| task::default_path(repo));
            p.save(&path)?;
            if let Err(e) = task::record(repo, &p, &format!("plan {}", p.id)) {
                eprintln!("{}", dim(&format!("plan not kept in refs/kula/meta: {e:#}")));
            }
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
            let path = task::resolve(repo, plan)?;
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
                for r in &v.notes {
                    println!("  {}", dim(&format!("note: {r}")));
                }
            }
            std::process::exit(v.verdict.code());
        }
        Cmd::RunPlan { plan, status } => {
            let path = task::resolve(repo, plan)?;
            let p = if status {
                let saved = task::Plan::load(&path)?;
                let live = saved.run_dir(repo).join("state.json");
                if live.exists() {
                    task::Plan::load(&live)?
                } else {
                    saved
                }
            } else {
                let p = run::run_plan(repo, &path)?;
                let passed = p.slices.iter().filter(|s| s.state == task::SliceState::Passed).count();
                if let Err(e) = task::record(repo, &p, &format!("run {}: {passed}/{} passed", p.id, p.slices.len())) {
                    eprintln!("{}", dim(&format!("run not kept in refs/kula/meta: {e:#}")));
                }
                p
            };
            if json {
                println!("{}", serde_json::to_string_pretty(&p)?);
            } else {
                if status {
                    let n = |st: task::SliceState| p.slices.iter().filter(|s| s.state == st).count();
                    use task::SliceState::*;
                    println!(
                        "{}  {}",
                        bold(&p.id),
                        dim(&format!(
                            "{} queued · {} running · {} gating · {} passed · {} failed · {} rejected",
                            n(Queued),
                            n(Running),
                            n(Gating),
                            n(Passed),
                            n(Failed),
                            n(Rejected)
                        ))
                    );
                }
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
            if status {
                return Ok(());
            }
            let ok = p.slices.iter().all(|s| s.state == task::SliceState::Passed);
            std::process::exit(if ok { 0 } else { 1 });
        }
        Cmd::MergeTrain { plan } => {
            let path = task::resolve(repo, plan)?;
            let mut p = task::Plan::load(&path)?;
            let t = train::train(repo, &mut p)?;
            p.save(&path)?;
            let msg = format!("train {}: merged {}, conflicts {}, gate {}", p.id, t.merged.len(), t.conflicts.len(), t.verdict);
            if let Err(e) = task::record(repo, &p, &msg) {
                eprintln!("{}", dim(&format!("train not kept in refs/kula/meta: {e:#}")));
            }
            if json {
                println!("{}", serde_json::to_string_pretty(&t)?);
            } else {
                println!("{}  {}", bold(&t.branch), dim(&format!("gate {}", t.verdict)));
                for id in &t.merged {
                    println!("  {} merged", accent(id));
                }
                for (id, files) in &t.conflicts {
                    println!("  {} conflict  {}", accent(id), dim(&format!("{} queued as {id}-merge", files.join(", "))));
                }
                for id in &t.skipped {
                    println!("  {} {}", accent(id), dim("not passed, left out"));
                }
                for r in &t.reasons {
                    println!("      {}", dim(r.lines().next().unwrap_or("")));
                }
                for r in &t.notes {
                    println!("      {}", dim(&format!("note: {}", r.lines().next().unwrap_or(""))));
                }
            }
            std::process::exit(if t.ok() { 0 } else { 1 });
        }
        _ => unreachable!(),
    }
    Ok(())
}
