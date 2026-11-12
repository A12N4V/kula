//! `kula run-plan`: every slice in its own worktree, under fences, gated, at most
//! `max_parallel` at once. State goes to `.kula/runs/<plan>/state.json` on every
//! change so a person (or a test) can watch.

use super::retry;
use super::task::{Plan, SliceState};
use crate::git::Repo;
use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Condvar, Mutex};

/// Agent CLIs a test run must never start.
const REAL_AGENTS: &[&str] = &["claude", "codex", "gemini", "cursor-agent", "aider", "opencode", "goose"];

/// The command for an agent id; `{prompt}` becomes the prompt.
pub fn agent_cmd(plan: &Plan, agent: &str) -> Vec<String> {
    if let Some(c) = plan.agents.get(agent) {
        return c.clone();
    }
    let v: &[&str] = match agent {
        "claude" => &["claude", "-p", "{prompt}"],
        "codex" => &["codex", "exec", "{prompt}"],
        "gemini" => &["gemini", "-p", "{prompt}"],
        _ => return vec![agent.to_string(), "{prompt}".into()],
    };
    v.iter().map(|s| s.to_string()).collect()
}

fn is_real_agent(cmd: &[String]) -> bool {
    cmd.first().and_then(|c| Path::new(c).file_name()).and_then(|n| n.to_str()).is_some_and(|n| REAL_AGENTS.contains(&n))
}

struct Shared {
    plan: Mutex<Plan>,
    cv: Condvar,
    state_path: PathBuf,
}

impl Shared {
    fn update(&self, f: impl FnOnce(&mut Plan)) {
        let mut p = self.plan.lock().unwrap();
        f(&mut p);
        let _ = p.save(&self.state_path);
        self.cv.notify_all();
    }
}

fn prepare_worktree(repo: &Repo, plan: &Plan, slice: &str) -> Result<PathBuf> {
    let wt = plan.worktree(repo, slice);
    if wt.exists() {
        let _ = repo.run(&["worktree", "remove", "--force", &wt.to_string_lossy()]);
        let _ = std::fs::remove_dir_all(&wt);
    }
    let _ = repo.run(&["worktree", "prune"]);
    std::fs::create_dir_all(wt.parent().unwrap())?;
    // A slice redone after a merge conflict starts from the integration branch.
    let own = plan.slice(slice).map(|s| s.base_ref.as_str()).filter(|b| !b.is_empty());
    let base = own.unwrap_or(if plan.base_ref.is_empty() { "HEAD" } else { &plan.base_ref });
    repo.run(&["worktree", "add", "-q", "-B", &plan.branch(slice), &wt.to_string_lossy(), base])
        .with_context(|| format!("could not make a worktree for slice {slice}"))?;
    Ok(wt)
}

/// Commits a passing slice on its branch and removes its worktree.
fn keep(repo: &Repo, wt: &Path, plan: &Plan, slice: &str) -> Result<()> {
    let w = Repo::discover(wt)?;
    super::wire::unwire(&w)?;
    w.run(&["add", "-A", "--", ".", ":(exclude).kula"])?;
    if !w.run(&["diff", "--cached", "--name-only"])?.trim().is_empty() {
        let msg = format!("kula: {} ({})", plan.goal, slice);
        let named = w.run(&["config", "user.email"]).map(|s| !s.trim().is_empty()).unwrap_or(false);
        if named {
            w.run(&["commit", "-q", "--no-verify", "-m", &msg])?;
        } else {
            w.run(&["-c", "user.name=kula", "-c", "user.email=kula@localhost", "commit", "-q", "--no-verify", "-m", &msg])?;
        }
    }
    repo.run(&["worktree", "remove", "--force", &wt.to_string_lossy()])?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn launch(
    exe: &Path,
    wt: &Path,
    log_dir: &Path,
    slice: &str,
    scope: &str,
    agent: &str,
    cmd: &[String],
    state: &Path,
    n: u32,
    prompt: &str,
) -> (i32, String) {
    let _ = std::fs::create_dir_all(log_dir);
    let pf = log_dir.join(format!("prompt-{n}.md"));
    let _ = std::fs::write(&pf, prompt);
    let args: Vec<String> = cmd.iter().map(|a| a.replace("{prompt}", prompt)).collect();
    let out = Command::new(exe)
        .arg("-C")
        .arg(wt)
        .args(["run", "--agent", agent, "--"])
        .args(&args)
        .current_dir(wt)
        .env("KULA_SLICE", slice)
        .env("KULA_ATTEMPT", n.to_string())
        .env("KULA_SCOPE", scope)
        .env("KULA_RUN_STATE", state)
        .env("KULA_PROMPT_FILE", &pf)
        .output();
    match out {
        Ok(o) => (o.status.code().unwrap_or(1), format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr))),
        Err(e) => (127, format!("could not start {}: {e}", args.first().map(String::as_str).unwrap_or("?"))),
    }
}

/// The memory check for this plan: its own, else `KULA_MEM_CHECK`.
fn mem_check_cmd(plan: &Plan) -> Option<String> {
    plan.mem_check.clone().or_else(|| std::env::var("KULA_MEM_CHECK").ok()).filter(|c| !c.trim().is_empty())
}

/// Runs the memory check; `Err` holds why a slice may not start.
fn mem_ok(cmd: &str, root: &Path) -> std::result::Result<(), String> {
    match Command::new("sh").arg("-c").arg(cmd).current_dir(root).output() {
        Ok(o) if o.status.success() => Ok(()),
        Ok(o) => {
            let text = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
            let line = text.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string();
            Err(if line.is_empty() { format!("`{cmd}` said no") } else { line })
        }
        Err(e) => Err(format!("could not run `{cmd}`: {e}")),
    }
}

pub fn run_plan(repo: &Repo, plan_path: &Path) -> Result<Plan> {
    let plan = Plan::load(plan_path)?;
    if std::env::var_os("KULA_NO_AGENT").is_some() {
        for s in &plan.slices {
            if is_real_agent(&agent_cmd(&plan, &s.agent)) {
                bail!("KULA_NO_AGENT is set – not starting {} for slice {}", s.agent, s.id);
            }
        }
    }
    std::fs::create_dir_all(repo.kula_dir())?;
    let gi = repo.kula_dir().join(".gitignore");
    if !gi.exists() {
        std::fs::write(&gi, "*\n")?;
    }
    let exe = std::env::current_exe()?;
    let run_dir = plan.run_dir(repo);
    std::fs::create_dir_all(&run_dir)?;
    let sh = Shared { plan: Mutex::new(plan), cv: Condvar::new(), state_path: run_dir.join("state.json") };
    sh.update(|_| {});

    std::thread::scope(|scope| -> Result<()> {
        loop {
            let mut p = sh.plan.lock().unwrap();
            // A slice whose dependency did not pass cannot run.
            let ended: Vec<(String, SliceState)> = p.slices.iter().map(|s| (s.id.clone(), s.state)).collect();
            let st = |id: &str| ended.iter().find(|(i, _)| i == id).map(|(_, s)| *s);
            let mut changed = false;
            for s in p.slices.iter_mut().filter(|s| s.state == SliceState::Queued) {
                if let Some(d) = s.deps.iter().find(|d| st(d).is_some_and(|x| x.done() && x != SliceState::Passed)) {
                    s.state = SliceState::Failed;
                    s.reasons = vec![format!("dependency {d} did not pass")];
                    changed = true;
                }
            }
            if changed {
                let _ = p.save(&sh.state_path);
            }
            let active = p.slices.iter().filter(|s| s.state.active()).count();
            let ready: Vec<String> = p
                .slices
                .iter()
                .filter(|s| s.state == SliceState::Queued && s.deps.iter().all(|d| st(d) == Some(SliceState::Passed)))
                .map(|s| s.id.clone())
                .take(p.max_parallel.saturating_sub(active))
                .collect();
            if ready.is_empty() {
                if active == 0 {
                    // Nothing running and nothing can start: whatever is left is stuck.
                    for s in p.slices.iter_mut().filter(|s| s.state == SliceState::Queued) {
                        s.state = SliceState::Failed;
                        s.reasons = vec!["its dependencies never passed".into()];
                    }
                    let _ = p.save(&sh.state_path);
                    return Ok(());
                }
                drop(sh.cv.wait(p).unwrap());
                continue;
            }
            if let Some(cmd) = mem_check_cmd(&p) {
                if let Err(why) = mem_ok(&cmd, &repo.root) {
                    let msg = format!("not enough memory to start: {why}");
                    if active > 0 {
                        // A running slice may free some; try again when one ends.
                        for id in &ready {
                            p.slice_mut(id).unwrap().reasons = vec![msg.clone()];
                        }
                        let _ = p.save(&sh.state_path);
                        drop(sh.cv.wait(p).unwrap());
                        continue;
                    }
                    for s in p.slices.iter_mut().filter(|s| s.state == SliceState::Queued) {
                        s.state = SliceState::Failed;
                        s.escalate = true;
                        s.reasons = vec![msg.clone()];
                    }
                    let _ = p.save(&sh.state_path);
                    return Ok(());
                }
            }
            for id in &ready {
                let s = p.slice_mut(id).unwrap();
                s.state = SliceState::Running;
                s.reasons.clear();
            }
            let _ = p.save(&sh.state_path);
            let snapshot = p.clone();
            drop(p);
            for id in ready {
                let agent = snapshot.slice(&id).map(|s| s.agent.clone()).unwrap_or_default();
                let wt = match prepare_worktree(repo, &snapshot, &id).and_then(|wt| super::wire::wire(&wt, &agent).map(|_| wt)) {
                    Ok(w) => w,
                    Err(e) => {
                        sh.update(|p| {
                            let s = p.slice_mut(&id).unwrap();
                            s.state = SliceState::Failed;
                            s.escalate = true;
                            s.reasons = vec![format!("{e:#}")];
                        });
                        continue;
                    }
                };
                let (sh, exe, run_dir, snap) = (&sh, &exe, &run_dir, snapshot.clone());
                scope.spawn(move || {
                    let slice = snap.slice(&id).unwrap().clone();
                    let log_dir = run_dir.join(&id);
                    let cmd = agent_cmd(&snap, &slice.agent);
                    let scope_s = slice.scope.join(":");
                    let r = retry::drive(
                        &snap,
                        &slice,
                        &wt,
                        &log_dir,
                        |n, prompt| launch(exe, &wt, &log_dir, &id, &scope_s, &slice.agent, &cmd, &sh.state_path, n, prompt),
                        |state, n, _| {
                            sh.update(|p| {
                                let s = p.slice_mut(&id).unwrap();
                                s.state = state;
                                s.attempts = n;
                            })
                        },
                    );
                    let kept = match &r {
                        Ok(o) if o.state == SliceState::Passed => keep(repo, &wt, &snap, &id).err(),
                        _ => None,
                    };
                    sh.update(|p| {
                        let s = p.slice_mut(&id).unwrap();
                        match (r, kept) {
                            (Ok(o), None) => {
                                s.state = o.state;
                                s.attempts = o.attempts;
                                s.escalate = o.escalate;
                                s.reasons = o.reasons;
                            }
                            (Ok(_), Some(e)) | (Err(e), _) => {
                                s.state = SliceState::Failed;
                                s.escalate = true;
                                s.reasons = vec![format!("{e:#}")];
                            }
                        }
                    });
                });
            }
        }
    })?;

    let plan = sh.plan.into_inner().unwrap();
    plan.save(plan_path)?;
    Ok(plan)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_commands() {
        let plan = Plan::default();
        assert_eq!(agent_cmd(&plan, "claude"), vec!["claude", "-p", "{prompt}"]);
        assert_eq!(agent_cmd(&plan, "fake-agent"), vec!["fake-agent", "{prompt}"]);
        assert!(is_real_agent(&agent_cmd(&plan, "codex")));
        assert!(!is_real_agent(&agent_cmd(&plan, "fake-agent")));
    }
}
