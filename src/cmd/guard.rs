use crate::*;

/// Object-safe JSON printing for heterogeneous command results.
pub(crate) fn level_tag(l: guard::Level) -> String {
    match l {
        guard::Level::Hidden => red("hidden"),
        guard::Level::Locked => red("locked"),
        guard::Level::Scope => yellow("scope"),
        guard::Level::Review => yellow("review"),
        guard::Level::Open => green("open"),
    }
}

/// A path as the repository sees it: relative, forward slashes, symlinks
/// resolved. A path that does not exist yet is resolved through its nearest
/// existing ancestor, so a new file behind a symlinked directory (or behind
/// `/tmp` → `/private/tmp`) lands on its real repo-relative name.
pub(crate) fn repo_rel(repo: &Repo, p: &str) -> String {
    let pb = std::path::Path::new(p);
    let root = repo.root.canonicalize().unwrap_or_else(|_| repo.root.clone());
    let abs = if pb.is_absolute() { pb.to_path_buf() } else { root.join(pb) };
    let full = canonicalize_ancestors(&abs);
    let rel = full.strip_prefix(&root).map(|r| r.to_path_buf()).unwrap_or(full);
    rel.to_string_lossy().replace('\\', "/").trim_start_matches("./").to_string()
}

/// Canonicalize the nearest existing ancestor of `p` and rejoin the tail.
pub(crate) fn canonicalize_ancestors(p: &std::path::Path) -> std::path::PathBuf {
    let mut anc = p.to_path_buf();
    let mut tail: Vec<std::ffi::OsString> = vec![];
    while !(anc.exists() || anc.symlink_metadata().is_ok()) {
        match anc.file_name() {
            Some(f) => {
                tail.push(f.to_owned());
                if !anc.pop() {
                    break;
                }
            }
            None => break,
        }
    }
    match anc.canonicalize() {
        Ok(c) => tail.iter().rev().fold(c, |a, f| a.join(f)),
        // a dangling symlink still resolves: follow the link and try again
        Err(_) => match anc.read_link() {
            Ok(t) => {
                let target = if t.is_absolute() { t } else { anc.parent().unwrap_or(std::path::Path::new(".")).join(t) };
                tail.iter().rev().fold(canonicalize_ancestors(&target), |a, f| a.join(f))
            }
            Err(_) => p.to_path_buf(),
        },
    }
}

pub(crate) fn guard_cmd(repo: &Repo, c: GuardCmd, json: bool) -> Result<()> {
    let st = Store::open(repo).ok();
    match c {
        GuardCmd::List => {
            let g = guard::Guards::load(repo)?;
            let files = match &st {
                Some(st) => guard::guarded_files(repo, st)?,
                None => vec![],
            };
            if json {
                let rules: Vec<_> = g
                    .rules()
                    .into_iter()
                    .map(|(r, l)| serde_json::json!({ "level": l, "paths": r.paths, "symbols": r.symbols, "reason": r.reason }))
                    .collect();
                println!(
                    "{}",
                    serde_json::json!({ "rules": rules, "task": g.task(), "files": files.iter().map(|(p, v)| serde_json::json!({ "path": p, "verdict": v })).collect::<Vec<_>>() })
                );
                return Ok(());
            }
            header("guards");
            if g.rules().is_empty() {
                println!("  {}", dim("no [[guard]] rules in kula.toml – secrets are still hidden from agents"));
            }
            for (i, (r, l)) in g.rules().iter().enumerate() {
                let what = [r.paths.clone(), r.symbols.clone()].concat().join(", ");
                println!("  {} {}  {}  {}", dim(&format!("#{}", i + 1)), level_tag(*l), bold(&what), dim(&r.reason));
            }
            if let Some(t) = g.task() {
                println!(
                    "\n  {} {}  {}",
                    accent("task"),
                    bold(&t.title),
                    dim(&if t.scope.is_empty() { "whole repository".into() } else { t.scope.join(", ") })
                );
            }
            let fenced: Vec<_> = files.iter().filter(|(_, v)| v.level != guard::Level::Scope).collect();
            if !fenced.is_empty() {
                println!("\n  {} fenced files", fenced.len());
                for (p, v) in fenced.iter().take(40) {
                    println!("    {}  {}", level_tag(v.level), p);
                }
            }
        }
        GuardCmd::Check { paths, staged } => {
            let mut touched: Vec<(String, Vec<String>)> = paths.iter().map(|p| (repo_rel(repo, p), vec![])).collect();
            if staged {
                let staged_syms = st
                    .as_ref()
                    .map(|st| guard::diff_symbols(repo, st, &["diff", "--cached", "-U0", "--no-color", "--no-renames"]))
                    .unwrap_or_default();
                for p in repo.run(&["diff", "--cached", "--name-only"])?.lines().map(String::from) {
                    let syms = staged_syms.iter().find(|(fp, _)| *fp == p).map(|(_, s)| s.clone()).unwrap_or_default();
                    if !touched.iter().any(|(tp, _)| *tp == p) {
                        touched.push((p.clone(), syms));
                    }
                }
            }
            let bad = guard::violations_with(repo, st.as_ref(), &touched, agents::agent_from_env().as_deref())?;
            if json {
                println!(
                    "{}",
                    serde_json::json!({ "ok": bad.is_empty(), "violations": bad.iter().map(|(p, v)| serde_json::json!({ "path": p, "verdict": v })).collect::<Vec<_>>() })
                );
            } else if bad.is_empty() {
                println!("  {} agents may edit {} path(s)", green("✓"), paths.len());
            } else {
                for (p, v) in &bad {
                    println!("  {} {}  {}  {}", red("⊘"), level_tag(v.level), bold(p), dim(&v.reason));
                }
            }
            if !bad.is_empty() {
                std::process::exit(1);
            }
        }
        GuardCmd::Commit => {
            // Only agents are held here; a person's commit is theirs. Identity
            // is a fresh session marker first (an agent was here recently, even
            // if this shell scrubbed its environment), then the environment,
            // then "person".
            let marker = guard::session_agent(repo);
            let Some(agent) = marker.clone().or_else(agents::agent_from_env) else { return Ok(()) };
            let g = guard::Guards::for_agent(repo, Some(&agent))?;
            let staged = repo.run(&["diff", "--cached", "--name-only", "-z"])?;
            let syms: Vec<(String, Vec<String>)> = st
                .as_ref()
                .map(|st| guard::diff_symbols(repo, st, &["diff", "--cached", "-U0", "--no-color", "--no-renames"]))
                .unwrap_or_default();
            let bad: Vec<(String, guard::Verdict)> = staged
                .split('\0')
                .filter(|p| !p.is_empty())
                .map(|p| {
                    let names = syms.iter().find(|(fp, _)| fp == p).map(|(_, s)| s.clone()).unwrap_or_default();
                    (p.to_string(), g.edit_touched(st.as_ref(), p, &names))
                })
                .filter(|(_, v)| !v.level.editable())
                .collect();
            if !bad.is_empty() {
                eprintln!("kula guard: {agent}'s commit holds fenced changes – a person commits these:");
                for (p, v) in &bad {
                    eprintln!("  {} {}  {}", p, v.level.as_str(), v.reason);
                }
                if marker.is_some() {
                    eprintln!("  (an agent session marker under .git/kula is fresh – a person waits for it to expire, or commits with --no-verify)");
                }
                std::process::exit(1);
            }
        }
        GuardCmd::Hook { agent, read } => {
            // One hook for every agent: Claude Code, Cursor, Codex and Gemini CLI all send the
            // tool call as JSON on stdin and treat exit 2 as "blocked, stderr is the reason".
            // File tools, patches and shell commands are all read for what they touch.
            let mut input = String::new();
            std::io::Read::read_to_string(&mut std::io::stdin(), &mut input)?;
            let v: serde_json::Value = serde_json::from_str(&input).unwrap_or_default();
            let deny = |msg: String| -> ! {
                if agent == "cursor" {
                    println!(
                        "{}",
                        serde_json::json!({ "permission": "deny", "continue": true, "user_message": msg, "agent_message": msg })
                    );
                }
                eprintln!("{msg}");
                std::process::exit(2);
            };
            let call = agents::hook_call(&v);
            if let Some(why) = call.tamper {
                deny(format!("kula guard: refused – {why}."));
            }
            let g = guard::Guards::for_agent(repo, Some(&agent))?;
            // A second layer over the shell tokenizer: the bypasses it cannot
            // see (eval, command substitution, heredocs, git rewrites, cd'd
            // relative writes, identity scrubbing). Only when this repo has
            // fences, and only refusals – never permissions.
            let payload_cwd = v["cwd"].as_str().unwrap_or("");
            let cwd_rel = if payload_cwd.is_empty() { String::new() } else { repo_rel(repo, payload_cwd) };
            let cmd = v["tool_input"]["command"].as_str().unwrap_or("");
            {
                let fenced = guard::fenced_paths(repo, &g, st.as_ref());
                let hidden = guard::hidden_paths(repo, &g);
                if !fenced.is_empty() || !hidden.is_empty() {
                    let (more, why) = guard::shell_guard(cmd, &cwd_rel, &fenced, &hidden);
                    if let Some(mut why) = why {
                        // Name the fence's reason for the first fenced path the refusal names.
                        if let Some(f) = fenced.iter().find(|f| why.contains(f.as_str())) {
                            let v = g.edit(st.as_ref(), f);
                            if !v.level.editable() && !v.reason.is_empty() {
                                why = format!("{} – {} ({}).", why.trim_end_matches('.'), v.reason, v.rule);
                            }
                        }
                        deny(why);
                    }
                    for p in more {
                        let verdict = g.edit(st.as_ref(), &p);
                        if !verdict.level.editable() {
                            deny(format!(
                                "kula guard: {} is {} for agents – {} ({}). Leave it to a person, or `suggest` a change to the fence.",
                                p,
                                verdict.level.as_str(),
                                verdict.reason,
                                verdict.rule
                            ));
                        }
                    }
                }
            }
            // An agent ran here: stamp a short-lived session marker under
            // `.git/kula` so the pre-commit hook knows, even from a shell
            // whose agent environment was scrubbed.
            guard::session_stamp(repo, &agent);
            let mut paths: Vec<(String, bool)> = vec![];
            for t in call.targets {
                let rel = repo_rel(repo, &t.path);
                if rel.starts_with('/') || rel.starts_with("..") || rel.starts_with('~') {
                    continue; // outside this repository: not ours to fence
                }
                // a directory stands for every file in it
                if !rel.is_empty() && repo.root.join(&rel).is_dir() {
                    let inner = repo.run(&["ls-files", "-z", "--", &rel]).unwrap_or_default();
                    paths.extend(inner.split('\0').filter(|p| !p.is_empty()).map(|p| (p.to_string(), t.write)));
                }
                paths.push((rel, t.write));
            }
            for (rel, write) in paths {
                let t = agents::Target { path: rel.clone(), write };
                let reads = read || !t.write;
                let verdict = if reads { g.path(&rel) } else { g.edit(st.as_ref(), &rel) };
                let blocked = if reads { !verdict.level.readable() } else { !verdict.level.editable() };
                if !blocked {
                    continue;
                }
                let what = match verdict.level {
                    guard::Level::Scope => "outside the active task".to_string(),
                    l => format!("{} for agents", l.as_str()),
                };
                deny(format!(
                    "kula guard: {} is {} – {} ({}). {}",
                    rel,
                    what,
                    verdict.reason,
                    verdict.rule,
                    if verdict.level == guard::Level::Scope || verdict.rule.starts_with("workflow") {
                        "Stay inside the task and its workflow, or ask the user to change them (`kula task`)."
                    } else {
                        "Leave it to a person, or suggest a change to the fence with the `suggest` tool."
                    }
                ));
            }
        }
    }
    Ok(())
}
