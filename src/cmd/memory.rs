use crate::*;

pub(crate) fn memory_cmd(repo: &Repo, c: MemoryCmd, json: bool) -> Result<()> {
    let st = Store::open(repo)?;
    match c {
        MemoryCmd::Add { target, text, by } => {
            let n = memory::remember(repo, &st, &target, &text, &by.unwrap_or_else(|| repo.user()))?;
            if json {
                println!("{}", serde_json::to_string(&n)?);
            } else {
                println!("  {} memory #{} on {}", green("✓"), n.id, bold(&n.target));
            }
        }
        MemoryCmd::Recall { target, query, limit } => {
            let hits = memory::recall(repo, &st, target.as_deref(), query.as_deref(), limit)?;
            if json {
                println!("{}", serde_json::to_string(&hits)?);
                return Ok(());
            }
            if hits.is_empty() {
                println!("  {}", dim("no memories"));
            }
            for h in hits {
                let tag = if h.stale { yellow("stale") } else { green("fresh") };
                println!("  {} {} {}  {}", dim(&format!("#{}", h.id)), tag, bold(&h.target), dim(&format!("{} · {}", h.via, h.author)));
                for l in h.body.lines() {
                    println!("      {l}");
                }
            }
        }
        MemoryCmd::Confirm { id } => {
            let n = memory::confirm(repo, &st, id)?;
            println!("  {} memory #{} re-anchored to {}", green("✓"), n.id, n.target);
        }
        MemoryCmd::Edit { id, text, target } => {
            let n = memory::edit(repo, &st, id, text.as_deref(), target.as_deref())?;
            println!("  {} memory #{} on {}", green("✓"), n.id, bold(&n.target));
        }
        MemoryCmd::Stale { id } => {
            memory::mark_stale(repo, id)?;
            println!("  {} memory #{id} marked stale", yellow("!"));
        }
        MemoryCmd::Rm { id } => {
            meta::note_rm(repo, id)?;
            println!("  {} forgot #{id}", green("✓"));
        }
    }
    Ok(())
}
