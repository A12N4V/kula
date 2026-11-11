use crate::*;

pub(crate) fn skill_cmd(root: &std::path::Path, sc: SkillCmd, json: bool) -> Result<()> {
    let wrote = |w: Vec<String>| {
        for f in &w {
            println!("  {} {f}", green("✓"));
        }
        if w.is_empty() {
            println!("  {}", dim("every agent already has the current skills"));
        }
    };
    match sc {
        SkillCmd::List => {
            let (all, strays) = (skills::list(root), skills::strays(root));
            if json {
                println!("{}", serde_json::json!({ "skills": all, "strays": strays }));
                return Ok(());
            }
            if all.is_empty() {
                println!("  {}", dim("no skills yet – `kula skill new <name> -d \"when to use it\"`"));
            }
            for s in &all {
                let t: Vec<String> = s.targets.iter().map(|(a, st)| format!("{a} {st}")).collect();
                println!("  {}  {}\n    {}", accent(&s.name), s.description, dim(&t.join(" · ")));
            }
            for s in &strays {
                println!("  {} {} has {} – `kula skill adopt {} {}`", dim("·"), s.agent, s.name, s.agent, s.name);
            }
        }
        SkillCmd::New { name, description } => {
            skills::save(root, &name, &description, "Describe the steps here.")?;
            println!("  {} .agents/skills/{name}/SKILL.md", green("✓"));
            wrote(skills::sync(root)?);
        }
        SkillCmd::Sync => wrote(skills::sync(root)?),
        SkillCmd::Adopt { agent, name } => wrote(skills::adopt(root, &agent, &name)?),
        SkillCmd::Rm { name } => {
            skills::remove(root, &name)?;
            println!("  {} removed {name} from every agent", green("✓"));
        }
    }
    Ok(())
}
