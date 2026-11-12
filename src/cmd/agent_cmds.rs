//! before / verify commands: agent-oriented worktree and risk views.
use crate::*;

pub(crate) fn before(repo: &Repo, symbol: &str, min_confidence: &str, json: bool) -> Result<()> {
    let out = |v: &dyn erased::Json| println!("{}", v.to_json());

    {
        let st = open_or_index(repo)?;
        let r = agent::pre_edit_conf(repo, &st, symbol, min_confidence)?;
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
    Ok(())
}

pub(crate) fn verify(repo: &Repo, min_confidence: &str, json: bool) -> Result<()> {
    let out = |v: &dyn erased::Json| println!("{}", v.to_json());

    {
        let r = agent::verify_edit_conf(repo, agents::agent_from_env().as_deref(), min_confidence)?;
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
    Ok(())
}
