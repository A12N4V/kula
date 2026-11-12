//! Project-level commands split out of dispatch: check (CI gate), sync and share.

use crate::erased::Json;
use crate::*;

/// `kula check architecture`: cycles, god modules, coupling, dead candidates.
/// Exits non-zero (Err) when any module cycle exists.
pub(crate) fn check_architecture(repo: &Repo, md: bool, json: bool) -> Result<()> {
    use kula::map::{arch, tree};
    let st = Store::open(repo)?;
    let mt = tree::module_tree(&repo.root, &st);
    let r = arch::check(&mt, &st);
    if json {
        let mut v = serde_json::to_value(&r)?;
        v["ok"] = serde_json::json!(r.cycles.is_empty());
        println!("{}", v.to_json());
    } else if md {
        print!("{}", arch::markdown(&r));
    } else {
        crate::term::header("check architecture");
        if r.cycles.is_empty() {
            println!("  {} no cycles", crate::term::green("✓"));
        } else {
            for c in &r.cycles {
                println!("  {} cycle: {}", crate::term::red("✗"), c.join(" → "));
            }
        }
        println!("  god modules: {}", if r.god_modules.is_empty() { "none".into() } else { r.god_modules.join(", ") });
        println!("  coupling {:.3}", r.coupling);
        println!("  dead candidates: {}", r.dead_candidates.len());
    }
    if r.cycles.is_empty() {
        Ok(())
    } else {
        Err(anyhow::anyhow!("{} module cycle(s) found", r.cycles.len()))
    }
}

pub(crate) fn check(repo: &Repo, base: Option<String>, max_risk: Option<String>, md: bool, json: bool) -> Result<()> {
    let cfg = config::Config::load(&repo.root)?;
    let base = base.unwrap_or_else(|| project::default_branch(repo, &cfg));
    let max = max_risk.unwrap_or(cfg.check.max_risk);
    let st = Store::open(repo).ok();
    let r = project::check(repo, st.as_ref(), &base, &max)?;
    let dangling = match (&st, crate::guard::Guards::load(repo)) {
        (Some(s), Ok(g)) => g.dangling_symbols(s),
        _ => vec![],
    };
    if json {
        let mut v = serde_json::to_value(&r)?;
        v["dangling_guards"] = serde_json::json!(dangling);
        println!("{}", v.to_json());
    } else if md {
        print!("{}", project::check_markdown(&r));
    } else {
        header(&format!("check {} {} {}", r.base, dim("…"), r.head));
        println!(
            "  risk {} {}  ·  {} files · {} symbols touched · {} dependents",
            risk(&r.risk),
            dim(&format!("(gate {})", r.max_risk)),
            r.files,
            r.touched,
            r.affected
        );
        for (n, p, d) in &r.top {
            println!("    {} {}  {}", dim(&"·".repeat(*d)), bold(n), dim(p));
        }
        if !dangling.is_empty() {
            println!("  {} guard names a symbol that no longer exists (fence is inactive): {}", yellow("!"), dangling.join(", "));
        }
        if !r.undeclared.is_empty() {
            println!("  {} undeclared: {}", yellow("!"), r.undeclared.join(", "));
        }
        for (p, level, reason) in &r.guarded {
            let tag = if level == "review" { yellow(level) } else { red(level) };
            println!("  {} {}  {}  {}", red("⊘"), tag, bold(p), dim(reason));
        }
        let fenced = r.guarded.iter().any(|g| g.1 == "locked" || g.1 == "hidden");
        println!(
            "\n  {}",
            if r.pass {
                green("✓ within the gate")
            } else if fenced {
                red("✗ changes guarded code – a person must approve it")
            } else {
                red("✗ above the gate")
            }
        );
    }
    if !r.pass {
        std::process::exit(2);
    }
    Ok(())
}

pub(crate) fn sync(repo: &Repo, remote: String, overwrite: bool) -> Result<()> {
    print!("{}", meta::sync(repo, &remote, false)?);
    match setup::pull(repo, &remote, overwrite)? {
        None => println!("remote has no shared agent setup"),
        Some(r) => {
            for f in &r.written {
                println!("  {} {f}", green("+"));
            }
            for f in &r.kept {
                println!("  {} {f}  {}", yellow("="), dim("changed here, kept yours (--overwrite takes theirs)"));
            }
            let skills = skills::sync(&repo.root)?;
            let docs = agents::sync(repo, &[])?;
            println!(
                "agent setup: {} files restored, {} kept, {} agent copies regenerated",
                r.written.len(),
                r.kept.len(),
                skills.len() + docs.len()
            );
        }
    }
    Ok(())
}

pub(crate) fn share(repo: &Repo, remote: String) -> Result<()> {
    let shared = setup::snapshot(repo)?;
    print!("{}", meta::sync(repo, &remote, true)?);
    setup::push(repo, &remote)?;
    println!("shared the agent setup ({} files) on {}", shared.len(), setup::REF);
    println!("{}", dim("anyone who clones gets it with `kula sync` (a fork: `kula sync upstream`)"));
    Ok(())
}
