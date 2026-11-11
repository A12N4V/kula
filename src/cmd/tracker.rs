use crate::*;

pub(crate) fn status(repo: &Repo, json: bool) -> Result<()> {
    let files = repo.status()?;
    let head = repo.head();
    let fresh = Store::freshness(repo);
    if json {
        println!("{}", serde_json::json!({ "branch": repo.branch(), "head": head, "index": fresh, "files": files }));
        return Ok(());
    }
    header(&format!("{} {}", repo.name(), accent(&repo.branch())));
    let idx = match fresh {
        "current" => green("● graph current"),
        "stale" => yellow("● graph behind HEAD – run `kula index`"),
        _ => dim("○ no graph yet – run `kula index`"),
    };
    println!("  {idx}");
    if files.is_empty() {
        println!("  {}", dim("working tree clean"));
        return Ok(());
    }
    let staged: Vec<_> = files.iter().filter(|f| f.staged).collect();
    let unstaged: Vec<_> = files.iter().filter(|f| f.unstaged && !f.untracked).collect();
    let untracked: Vec<_> = files.iter().filter(|f| f.untracked).collect();
    println!();
    for (title, list, col) in [("staged", staged, 0), ("changed", unstaged, 1), ("untracked", untracked, 2)] {
        if list.is_empty() {
            continue;
        }
        println!("  {} {}", bold(&list.len().to_string()), bold(title));
        for f in list {
            let code = if col == 0 { &f.index } else { &f.worktree };
            let c = match col {
                0 => green(code),
                1 => yellow(code),
                _ => dim("?"),
            };
            println!("    {c} {}", f.path);
        }
    }
    Ok(())
}

pub(crate) fn issue_cmd(repo: &Repo, c: IssueCmd, json: bool) -> Result<()> {
    match c {
        IssueCmd::New { title, body, label, anchor } => {
            let i = meta::issue_new(repo, &title, &body, label, anchor)?;
            println!("{} opened issue {} {}", green("✓"), accent(&format!("#{}", i.id)), i.title);
        }
        IssueCmd::List { all } => {
            let m = meta::load(repo)?;
            let list: Vec<_> = m.issues.iter().filter(|i| all || i.status == "open").collect();
            if json {
                println!("{}", serde_json::to_string_pretty(&list)?);
                return Ok(());
            }
            if list.is_empty() {
                println!("{}", dim("no issues"));
            }
            for i in list {
                let dot = if i.status == "open" { green("●") } else { dim("○") };
                let labels = if i.labels.is_empty() { String::new() } else { magenta(&format!(" [{}]", i.labels.join(", "))) };
                println!(
                    "  {dot} {} {}{}  {}",
                    accent(&format!("#{}", i.id)),
                    i.title,
                    labels,
                    dim(&format!("{} · {}", i.author, rel_time(i.created)))
                );
            }
        }
        IssueCmd::Show { id } => {
            let m = meta::load(repo)?;
            let Some(i) = m.issues.iter().find(|i| i.id == id) else { bail!("no issue #{id}") };
            if json {
                println!("{}", serde_json::to_string_pretty(i)?);
                return Ok(());
            }
            header(&format!("#{} {}  {}", i.id, i.title, dim(&i.status)));
            println!("  {}\n", dim(&format!("{} · {}", i.author, rel_time(i.created))));
            if !i.body.is_empty() {
                println!("  {}\n", i.body);
            }
            for a in &i.anchors {
                println!("  {} {}", accent("⌖"), a);
            }
            for c in &i.comments {
                println!("  {} {}  {}", blue("│"), c.body, dim(&format!("– {}, {}", c.author, rel_time(c.at))));
            }
        }
        IssueCmd::Close { id } => {
            meta::issue_set_status(repo, id, "closed")?;
            println!("{} closed #{id}", green("✓"));
        }
        IssueCmd::Reopen { id } => {
            meta::issue_set_status(repo, id, "open")?;
            println!("{} reopened #{id}", green("✓"));
        }
        IssueCmd::Comment { id, body } => {
            meta::comment(repo, id, &body)?;
            println!("{} commented on #{id}", green("✓"));
        }
    }
    Ok(())
}

pub(crate) fn pr_cmd(repo: &Repo, c: PrCmd, json: bool) -> Result<()> {
    match c {
        PrCmd::New { title, base, head, body } => {
            let head = head.unwrap_or_else(|| repo.branch());
            let p = meta::proposal_new(repo, &title, &body, &base, &head)?;
            println!("{} proposal {} {} {}", green("✓"), accent(&format!("#{}", p.id)), p.title, dim(&format!("{} → {}", p.head, p.base)));
        }
        PrCmd::List { all } => {
            let m = meta::load(repo)?;
            let list: Vec<_> = m.proposals.iter().filter(|p| all || p.status == "open").collect();
            if json {
                println!("{}", serde_json::to_string_pretty(&list)?);
                return Ok(());
            }
            if list.is_empty() {
                println!("{}", dim("no proposals"));
            }
            for p in list {
                let dot = match p.status.as_str() {
                    "open" => green("●"),
                    "merged" => magenta("◆"),
                    _ => dim("○"),
                };
                println!(
                    "  {dot} {} {}  {}",
                    accent(&format!("#{}", p.id)),
                    p.title,
                    dim(&format!("{} → {} · {}", p.head, p.base, rel_time(p.created)))
                );
            }
        }
        PrCmd::Show { id } => {
            let m = meta::load(repo)?;
            let Some(p) = m.proposals.iter().find(|p| p.id == id) else { bail!("no proposal #{id}") };
            if json {
                println!("{}", serde_json::to_string_pretty(p)?);
                return Ok(());
            }
            header(&format!("#{} {}  {}", p.id, p.title, dim(&p.status)));
            if !p.body.is_empty() {
                println!("  {}", p.body);
            }
            println!();
            if p.status == "open" {
                let st = Store::open(repo).ok();
                print_compare(&graph::compare(repo, st.as_ref(), &p.base, &p.head)?);
            }
            for c in &p.comments {
                println!("  {} {}  {}", blue("│"), c.body, dim(&format!("– {}, {}", c.author, rel_time(c.at))));
            }
        }
        PrCmd::Merge { id } => {
            let p = meta::proposal_merge(repo, id)?;
            println!("{} merged #{id} into {} {}", green("✓"), p.base, dim(p.merged_sha.as_deref().unwrap_or("")));
        }
        PrCmd::Close { id } => {
            meta::proposal_set_status(repo, id, "closed")?;
            println!("{} closed #{id}", green("✓"));
        }
        PrCmd::Comment { id, body } => {
            meta::comment(repo, id, &body)?;
            println!("{} commented on #{id}", green("✓"));
        }
    }
    Ok(())
}

pub(crate) fn note_cmd(repo: &Repo, c: NoteCmd, json: bool) -> Result<()> {
    match c {
        NoteCmd::Add { target, body } => {
            let target = if target == "repo" || target.contains(':') { target } else { format!("symbol:{target}") };
            let n = meta::note_add(repo, &target, &body)?;
            println!("{} note {} on {}", green("✓"), accent(&format!("#{}", n.id)), n.target);
        }
        NoteCmd::List { target } => {
            let m = meta::load(repo)?;
            let list: Vec<_> = m.notes.iter().filter(|n| target.as_ref().map(|t| n.target.contains(t.as_str())).unwrap_or(true)).collect();
            if json {
                println!("{}", serde_json::to_string_pretty(&list)?);
                return Ok(());
            }
            if list.is_empty() {
                println!("{}", dim("no notes"));
            }
            for n in list {
                println!(
                    "  {} {} {}  {}",
                    magenta("✎"),
                    accent(&format!("#{}", n.id)),
                    bold(&n.target),
                    dim(&format!("{} · {}", n.author, rel_time(n.updated)))
                );
                for l in n.body.lines() {
                    println!("      {l}");
                }
            }
        }
        NoteCmd::Edit { id, body } => {
            meta::note_edit(repo, id, &body)?;
            println!("{} updated note #{id}", green("✓"));
        }
        NoteCmd::Rm { id } => {
            meta::note_rm(repo, id)?;
            println!("{} removed note #{id}", green("✓"));
        }
    }
    Ok(())
}

pub(crate) fn doctor(cwd: &std::path::Path) -> Result<()> {
    header("kula doctor");
    let git = std::process::Command::new("git").arg("--version").output();
    match git {
        Ok(o) if o.status.success() => println!("  {} {}", green("✓"), String::from_utf8_lossy(&o.stdout).trim()),
        _ => println!("  {} git not found on PATH", red("✗")),
    }
    match Repo::discover(cwd) {
        Ok(r) => {
            println!("  {} repository {}", green("✓"), r.root.display());
            match Store::open(&r) {
                Ok(s) => println!("  {} graph {}", green("✓"), dim(&s.meta("stats").unwrap_or_default())),
                Err(_) => println!("  {} no graph – run `kula index`", yellow("●")),
            }
        }
        Err(_) => println!("  {} not inside a git repository", yellow("●")),
    }
    println!("  {} kula {}", green("✓"), env!("CARGO_PKG_VERSION"));
    Ok(())
}
