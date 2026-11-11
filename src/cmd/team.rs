use crate::*;

pub(crate) fn team_cmd(repo: &Repo, c: TeamCmd, json: bool) -> Result<()> {
    let cfg = config::Config::load(&repo.root)?;
    match c {
        TeamCmd::List => {
            let active = guard::team(repo);
            if json {
                println!("{}", serde_json::json!({ "teams": cfg.teams, "active": active }));
                return Ok(());
            }
            if cfg.teams.is_empty() {
                println!("  {}", dim("no teams"));
                hint("kula team save <name> -m claude=autoresearch -m cursor=tests");
                return Ok(());
            }
            header("teams");
            for t in &cfg.teams {
                let on = active.as_ref().is_some_and(|a| a.name == t.name);
                let under = if t.under.is_empty() { String::new() } else { format!("  {}", dim(&format!("under {}", t.under))) };
                println!("  {} {}  {}{under}", if on { green("●") } else { dim("○") }, accent(&t.name), dim(&t.about));
                let lead = t.members.iter().find(|m| m.reports_to.is_empty()).map(|m| m.key().to_string());
                let w = t.members.iter().map(|m| m.key().chars().count()).max().unwrap_or(5).max(5);
                let r = t.members.iter().map(|m| m.workflow.chars().count()).max().unwrap_or(8).max(8);
                for m in &t.members {
                    let tag = if lead.as_deref() == Some(m.key()) && m.role.is_empty() { green("lead") } else { String::new() };
                    let tag = if tag.is_empty() { String::new() } else { format!(" {tag}") };
                    let wf = if m.workflow.is_empty() { dim("none") } else { bold(&m.workflow) };
                    println!(
                        "      {:<w$}  {:<r$}  {}{}",
                        m.key(),
                        wf,
                        if m.role.is_empty() { dim("member") } else { dim(&m.role) },
                        tag,
                        w = w,
                        r = r
                    );
                }
            }
        }
        TeamCmd::Save { name, about, member, lead, prompt, under } => {
            let mut members = vec![];
            for m in member {
                let Some((agent, rest)) = m.split_once('=') else { bail!("members are agent=workflow[:role], not {m}") };
                let (wf, role) = rest.split_once(':').unwrap_or((rest, ""));
                if !wf.is_empty() && workflow::find(&cfg, wf).is_none() {
                    bail!("no workflow called {wf}");
                }
                // re-saving keeps what the UI set: prompts, hand-offs
                let old =
                    cfg.teams.iter().find(|t| t.name == name).and_then(|t| t.members.iter().find(|x| x.key() == agent.trim())).cloned();
                members.push(config::Member {
                    agent: agent.trim().into(),
                    workflow: wf.trim().into(),
                    role: role.trim().into(),
                    ..old.unwrap_or_default()
                });
            }
            // `-m gemini=fix:lead` names the lead as well as --lead does
            let lead = lead.or_else(|| members.iter().find(|m| m.role == "lead").map(|m| m.key().to_string()));
            if let Some(lead) = &lead {
                for m in members.iter_mut() {
                    m.reports_to = if m.key() == lead { String::new() } else { lead.clone() };
                }
            }
            let mut teams = cfg.teams.clone();
            let prompt = prompt.unwrap_or_else(|| cfg.teams.iter().find(|t| t.name == name).map(|t| t.prompt.clone()).unwrap_or_default());
            let under = under.unwrap_or_else(|| cfg.teams.iter().find(|t| t.name == name).map(|t| t.under.clone()).unwrap_or_default());
            let t = config::Team { name: name.clone(), about, prompt, under, members };
            match teams.iter_mut().find(|x| x.name == name) {
                Some(x) => *x = t,
                None => teams.push(t),
            }
            config::set_teams(&repo.root, &teams)?;
            println!("  {} team {} saved in kula.toml", green("✓"), accent(&name));
        }
        TeamCmd::Start { name } => {
            guard::team_start(repo, &name, &format!("user:{}", repo.user()))?;
            println!("  {} team {} at work – each agent in its own workflow", green("✓"), accent(&name));
        }
        TeamCmd::Prompt { name, agent } => {
            let Some(t) = cfg.teams.iter().find(|t| t.name == name) else { bail!("no team called {name}") };
            let id = agents::agent_id(&agent);
            let Some(m) = t.members.iter().find(|m| m.name.eq_ignore_ascii_case(agent.trim()) || agents::agent_id(&m.agent) == id) else {
                bail!("{agent} is not in team {name}")
            };
            print!("{}", agents::team_prompt(&cfg, t, m));
        }
        TeamCmd::Stop => match guard::team_stop(repo)? {
            Some(t) => println!("  {} team {} stood down", green("✓"), t.name),
            None => println!("  {}", dim("no team at work")),
        },
    }
    Ok(())
}
