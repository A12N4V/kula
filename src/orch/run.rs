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
        // Machine readable output, so the run ledger can read tokens and cost.
        "claude" => &["claude", "-p", "{prompt}", "--output-format", "json"],
        "codex" => &["codex", "exec", "--json", "{prompt}"],
        "gemini" => &["gemini", "-p", "{prompt}", "-o", "json"],
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

/// Launches one attempt with the usage pipeline in the loop: the agent's
/// stdout stream flows through parse → dedupe → price → accumulate → budget
/// stop (80% warns through an event, 100% SIGINTs the seat), and the legacy
/// terminal parse still runs on the combined output.
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
    run: (&str, &str, &str),
    table: &crate::config::PriceTable,
    budget: f64,
    kula_dir: &Path,
    events: &dyn Fn(crate::events::Event),
) -> (i32, String, crate::launch::Captured) {
    let _ = std::fs::create_dir_all(log_dir);
    let pf = log_dir.join(format!("prompt-{n}.md"));
    let _ = std::fs::write(&pf, prompt);
    let args: Vec<String> = cmd.iter().map(|a| a.replace("{prompt}", prompt)).collect();
    let mut command = Command::new(exe);
    command
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
        .env("KULA_LEARNED", log_dir.join("learned.txt"))
        .env("KULA_EXE", exe)
        .env("KULA_PLAN", run.0)
        .env("KULA_RUN", run.1)
        // a fresh worktree has no `.kula/team.json`, so the seat fences ride in the environment
        .env("KULA_TEAM", run.2);
    let cap = crate::launch::capture_stream(&mut command, run.2, run.1, slice, agent, table, budget, kula_dir, |st, spent, b| {
        // The budget join point: 80% emits one warning event through the team's
        // event log; the 100% stop lands as an event after the attempt ends.
        let pct = if st == crate::usage::BudgetState::Warn { "warn" } else { "spent" };
        events(crate::events::Event {
            kind: "usage".into(),
            team: run.2.into(),
            agent: agent.into(),
            plan: run.0.into(),
            run: run.1.into(),
            slice: slice.into(),
            verdict: pct.into(),
            msg: format!("budget {pct}: ${spent:.2} of ${b:.2}"),
            ..Default::default()
        });
    });
    match cap {
        Ok(c) => (c.code, c.output.clone(), c),
        Err(e) => {
            let args0 = args.first().map(String::as_str).unwrap_or("?");
            (127, format!("could not start {args0}: {e}"), crate::launch::Captured {
                usage: Default::default(),
                records: vec![],
                acc: crate::usage::Accumulator::new(run.2, run.1, budget),
                stopped: false,
                code: 127,
                price_errors: vec![],
                output: String::new(),
            })
        }
    }
}

/// Files and lines a slice changed against `base`, untracked files too, without
/// kula's own files or the agent wiring.
fn diff_stats(wt: &Path, base: &str) -> (Vec<String>, u64, u64) {
    let Ok(w) = Repo::discover(wt) else { return (vec![], 0, 0) };
    let wired = super::wire::wired(wt);
    // Intent to add, so new files count; the wiring stays out of the index.
    let skip: Vec<String> = wired.iter().map(|f| format!(":(exclude){f}")).collect();
    let mut args = vec!["add", "-A", "-N", "--", ".", ":(exclude).kula"];
    args.extend(skip.iter().map(String::as_str));
    let _ = w.run(&args);
    let text = w.run(&["diff", "--numstat", base]).unwrap_or_default();
    let kept: Vec<&str> = text.lines().filter(|l| !wired.iter().any(|f| l.ends_with(&format!("\t{f}")))).collect();
    crate::launch::numstat(&kept.join("\n"))
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
    let cfg = crate::config::Config::load(&repo.root).unwrap_or_default();
    // Seat lint runs before anything is created: no run dir, no worktree, no
    // agent, no launch op. A failure names the seat and the field.
    let lint_errors = crate::launch::lint(&repo.root, &cfg);
    if !lint_errors.is_empty() {
        let first = &lint_errors[0];
        bail!("seat lint failed for {} – field {}: {} ({} error(s) total)", first.seat, first.field, first.problem, lint_errors.len());
    }
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
    let started = crate::events::now_ms();
    let run_id = format!("{}-{}", plan.id, started / 1000);
    // Seat lint runs before anything is started: no worktree, no agent, no
    // launch op. A failure names the seat and the field.
    let lint_errors = crate::launch::lint(&repo.root, &cfg);
    if !lint_errors.is_empty() {
        let first = &lint_errors[0];
        bail!("seat lint failed for {} – field {}: {} ({} error(s) total)", first.seat, first.field, first.problem, lint_errors.len());
    }
    let base_sha = repo
        .run(&["rev-parse", if plan.base_ref.is_empty() { "HEAD" } else { &plan.base_ref }])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let sh = Shared { plan: Mutex::new(plan.clone()), cv: Condvar::new(), state_path: run_dir.join("state.json") };
    // The swarm op log opens with the launch op: every seat at its base.
    record_launch(repo, &plan, &run_id);
    sh.update(|p| p.run = run_id.clone());
    // What each seat cost and changed, for the run ledger.
    let measured: Mutex<std::collections::BTreeMap<String, crate::launch::SeatRun>> = Mutex::new(Default::default());

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
                .take(if p.max_parallel == 0 { 2 } else { p.max_parallel }.saturating_sub(active))
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
            if let Some(cap) = p.budget_usd.filter(|c| *c > 0.0) {
                let spent: f64 = measured.lock().unwrap().values().map(|m| m.usage.cost_usd).sum();
                if spent >= cap {
                    // The cap is spent: nothing new starts, running seats finish.
                    let msg = format!("budget of ${cap:.2} spent (${spent:.2})");
                    for s in p.slices.iter_mut().filter(|s| s.state == SliceState::Queued) {
                        s.state = SliceState::Failed;
                        s.reasons = vec![msg.clone()];
                    }
                    let _ = p.save(&sh.state_path);
                    if active == 0 {
                        return Ok(());
                    }
                    drop(sh.cv.wait(p).unwrap());
                    continue;
                }
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
                let wt_base =
                    Repo::discover(&wt).and_then(|w| w.run(&["rev-parse", "HEAD"])).map(|s| s.trim().to_string()).unwrap_or_default();
                let (sh, exe, run_dir, snap, measured, cfg, run_id) = (&sh, &exe, &run_dir, snapshot.clone(), &measured, &cfg, &run_id);
                scope.spawn(move || {
                    let slice = snap.slice(&id).unwrap().clone();
                    let log_dir = run_dir.join(&id);
                    let table = crate::config::PriceTable::from(cfg);
                    // The seat's dollar budget: the plan's run cap (a seat that
                    // alone would spend the run's cap is stopped at it).
                    let seat_budget = snap.budget_usd.unwrap_or(0.0);
                    let kula_dir = repo.kula_dir();
                    let mut cmd = agent_cmd(&snap, &slice.agent);
                    // The seat's own MCP servers, skills and memory.
                    let pre = match crate::launch::seat_of(cfg, &slice.seat) {
                        Some(m) => {
                            let (args, pre) = crate::launch::seat_setup(&repo.root, &slice.agent, m, &log_dir);
                            cmd.extend(args);
                            pre
                        }
                        None => String::new(),
                    };
                    let scope_s = slice.scope.join(":");
                    let t0 = std::time::Instant::now();
                    let r = retry::drive(
                        &snap,
                        &slice,
                        &wt,
                        &log_dir,
                        |n, prompt| {
                            let prompt = if pre.is_empty() { prompt.to_string() } else { format!("{pre}\n{prompt}") };
                            let events = |e: crate::events::Event| crate::events::append(&kula_dir, e);
                            let (code, out, cap) = launch(
                                exe,
                                &wt,
                                &log_dir,
                                &id,
                                &scope_s,
                                &slice.agent,
                                &cmd,
                                &sh.state_path,
                                n,
                                &prompt,
                                (&snap.id, run_id, &snap.team),
                                &table,
                                seat_budget,
                                &kula_dir,
                                &events,
                            );
                            let mut usage = crate::launch::parse(&out);
                            // The pipeline's stream total wins when the legacy
                            // terminal parse found nothing: the event carries
                            // what was actually priced, deduped and budgeted.
                            if cap.usage.turns > 0 && usage.as_ref().map(|u| u.turns == 0 && u.cost_usd == 0.0).unwrap_or(true) {
                                usage = Some(cap.usage.clone());
                            }
                            if cap.stopped {
                                events(crate::events::Event {
                                    kind: "usage".into(),
                                    team: snap.team.clone(),
                                    agent: slice.agent.clone(),
                                    plan: snap.id.clone(),
                                    run: run_id.clone(),
                                    slice: id.clone(),
                                    verdict: "stopped".into(),
                                    msg: format!(
                                        "budget stop: ${:.2} of ${seat_budget:.2} spent{}",
                                        cap.acc.spent,
                                        if cap.price_errors.is_empty() { String::new() } else { format!("; {}", cap.price_errors.join("; ")) }
                                    ),
                                    usage: usage.clone(),
                                    ..Default::default()
                                });
                            }
                            if let Some(u) = &usage {
                                measured.lock().unwrap().entry(id.clone()).or_default().usage.add(u);
                            }
                            crate::events::append(
                                &repo.kula_dir(),
                                crate::events::Event {
                                    kind: "attempt".into(),
                                    team: snap.team.clone(),
                                    agent: slice.agent.clone(),
                                    plan: snap.id.clone(),
                                    run: run_id.clone(),
                                    slice: id.clone(),
                                    msg: format!("attempt {n} exited {code}"),
                                    usage,
                                    ..Default::default()
                                },
                            );
                            // Autosave the seat's worktree between attempts: a snapshot
                            // under refs/kula/saves without touching its branch.
                            let _ = crate::ops::autosave(repo, &wt, &slice.seat, run_id, &format!("slice {id} after attempt {n}"));
                            (code, out)
                        },
                        |state, n, _| {
                            sh.update(|p| {
                                let s = p.slice_mut(&id).unwrap();
                                s.state = state;
                                s.attempts = n;
                            })
                        },
                    );
                    // What it learned and the fences it suggested outlive its worktree.
                    let (learned, sugg) = super::learn::harvest(repo, &wt, &log_dir, &id);
                    {
                        let (mut paths, added, removed) = diff_stats(&wt, &wt_base);
                        let mut m = measured.lock().unwrap();
                        let e = m.entry(id.clone()).or_default();
                        (e.files, e.added, e.removed) = (paths.len(), added, removed);
                        paths.truncate(crate::launch::MAX_PATHS);
                        e.paths = paths;
                        e.duration_ms = t0.elapsed().as_millis() as u64;
                    }
                    let kept = match &r {
                        Ok(o) if o.state == SliceState::Passed => keep(repo, &wt, &snap, &id).err(),
                        _ => None,
                    };
                    if kept.is_none() && matches!(&r, Ok(o) if o.state == SliceState::Passed) {
                        let sha = repo.run(&["rev-parse", &snap.branch(&id)]).unwrap_or_default();
                        measured.lock().unwrap().entry(id.clone()).or_default().commit = sha.trim().to_string();
                        let sha = sha.trim().to_string();
                        if !sha.is_empty() {
                            commit_op(repo, &snap, run_id, &id, &sha);
                        }
                    }
                    sh.update(|p| {
                        let s = p.slice_mut(&id).unwrap();
                        s.learned = learned;
                        match (r, kept) {
                            (Ok(o), None) => {
                                s.state = o.state;
                                s.attempts = o.attempts;
                                s.escalate = o.escalate;
                                s.reasons = o.reasons;
                                if sugg > 0 {
                                    s.reasons.push(format!("{sugg} fence suggestion(s) wait for review: kula agents suggestions"));
                                }
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
    let head = repo.run(&["rev-parse", "HEAD"]).map(|s| s.trim().to_string()).unwrap_or_default();
    let refused = crate::launch::refusals(&repo.kula_dir(), &run_id);
    let trigger = std::env::var("KULA_TRIGGER").ok().filter(|t| !t.is_empty()).unwrap_or_else(|| "manual".into());
    let mut ledger =
        crate::launch::build(&plan, &run_id, &trigger, started, crate::events::now_ms(), &head, measured.into_inner().unwrap(), &refused);
    ledger.base = base_sha;
    match crate::launch::save(repo, &ledger) {
        Ok(_) => crate::events::append(
            &repo.kula_dir(),
            crate::events::Event {
                kind: "run_end".into(),
                team: plan.team.clone(),
                plan: plan.id.clone(),
                run: run_id,
                verdict: ledger.state.clone(),
                usage: Some(ledger.usage.clone()),
                msg: format!("score {}", ledger.score),
                ..Default::default()
            },
        ),
        Err(e) => eprintln!("kula: could not record run {run_id}: {e:#}"),
    }
    Ok(plan)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_commands() {
        let plan = Plan::default();
        assert_eq!(agent_cmd(&plan, "claude"), vec!["claude", "-p", "{prompt}", "--output-format", "json"]);
        assert_eq!(agent_cmd(&plan, "fake-agent"), vec!["fake-agent", "{prompt}"]);
        assert!(is_real_agent(&agent_cmd(&plan, "codex")));
        assert!(!is_real_agent(&agent_cmd(&plan, "fake-agent")));
    }
}

// –– Swarm views (B2): the op log meets the seat worktrees ––

/// Reset every seat's worktree to the commit its view entry names. Seat keys
/// are slice ids or team seats (`team/key`); branches are never touched. A
/// slice that is running or gating keeps its worktree: an in-flight agent must
/// not have the floor pulled from under it.
pub fn apply_view(repo: &Repo, plan: &Plan, view: &std::collections::BTreeMap<String, String>) -> Result<usize> {
    let mut reset = 0;
    for (seat, commit) in view {
        let Some(s) = plan.slices.iter().find(|s| s.id == *seat || (!s.seat.is_empty() && s.seat == *seat)) else {
            continue;
        };
        if s.state.active() {
            bail!("seat {seat} is {:?} – refuse to reset under an in-flight agent", s.state);
        }
        let wt = plan.worktree(repo, &s.id);
        if !wt.exists() {
            continue;
        }
        crate::git::reset_worktree_to(&wt, commit).with_context(|| format!("could not reset seat {seat} to {commit}"))?;
        reset += 1;
    }
    Ok(reset)
}

/// The view entry key for a slice: its team seat when it has one, else its id.
fn seat_key(s: &super::task::Slice) -> String {
    if s.seat.is_empty() {
        s.id.clone()
    } else {
        s.seat.clone()
    }
}

/// Append a launch op: the view of every seat at its base commit.
fn launch_op(repo: &Repo, plan: &Plan, run_id: &str) {
    let mut view = std::collections::BTreeMap::new();
    for s in &plan.slices {
        let base = s.base_ref.trim();
        let key = if base.is_empty() { "HEAD" } else { base };
        let sha = repo.run(&["rev-parse", "--verify", key]).map(|x| x.trim().to_string()).unwrap_or_default();
        if !sha.is_empty() {
            view.insert(seat_key(s), sha);
        }
    }
    if let Err(e) = crate::ops::append_op(repo, crate::ops::OpKind::Launch, run_id, view, &format!("run {} launched", plan.id)) {
        eprintln!("kula: could not record the launch op: {e:#}");
    }
}

/// Append a commit op after a slice's branch advanced. The view is seeded
/// from the newest op that carries a full seat view (launch, commit or undo) –
/// never from the immediately previous op, which may be a single-seat save
/// that knows nothing about the other seats.
fn commit_op(repo: &Repo, plan: &Plan, run_id: &str, slice: &str, sha: &str) {
    let mut view = crate::ops::last_full_view(repo).map(|o| o.view).unwrap_or_default();
    let s = plan.slice(slice);
    let key = s.map(seat_key).unwrap_or_else(|| slice.to_string());
    view.insert(key.clone(), sha.to_string());
    if let Err(e) =
        crate::ops::append_op_seat(repo, crate::ops::OpKind::Commit, run_id, &key, view, &format!("slice {slice} committed {sha}"))
    {
        eprintln!("kula: could not record the commit op: {e:#}");
    }
}

/// Record the run's launch op before the slices start.
pub fn record_launch(repo: &Repo, plan: &Plan, run_id: &str) {
    launch_op(repo, plan, run_id);
}

#[cfg(test)]
mod view_tests {
    use super::*;
    use crate::orch::task::{Plan, Slice, SliceState};
    use tempfile::TempDir;

    fn repo3() -> (TempDir, Repo, Plan) {
        let t = tempfile::tempdir().unwrap();
        let d = t.path();
        let git = |args: &[&str]| {
            let o = std::process::Command::new("git").arg("-C").arg(d).args(args).output().unwrap();
            assert!(o.status.success(), "git {args:?}");
            String::from_utf8_lossy(&o.stdout).into_owned()
        };
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.name", "T"]);
        git(&["config", "user.email", "t@t"]);
        for s in ["a", "b", "c"] {
            std::fs::create_dir_all(d.join(s)).unwrap();
            std::fs::write(d.join(s).join("x.txt"), format!("{s}\n")).unwrap();
        }
        git(&["add", "-A"]);
        git(&["commit", "-qm", "init"]);
        let base = git(&["rev-parse", "HEAD"]).trim().to_string();
        let slices: Vec<Slice> = ["a", "b", "c"]
            .iter()
            .map(|s| Slice {
                id: s.to_string(),
                module: s.to_string(),
                scope: vec![s.to_string()],
                agent: "fake".into(),
                base_ref: base.clone(),
                ..Default::default()
            })
            .collect();
        let plan = Plan { id: "t3".into(), goal: "test".into(), base_ref: base, slices, ..Default::default() };
        let repo = Repo { root: d.to_path_buf() };
        (t, repo, plan)
    }

    /// Each seat gets a worktree on its branch with one diverging commit.
    fn seat_worktrees(repo: &Repo, plan: &Plan, drift: &str) {
        for s in &plan.slices {
            let branch = plan.branch(&s.id);
            repo.run(&["branch", &branch, &plan.base_ref]).unwrap();
            let wt = plan.worktree(repo, &s.id);
            std::fs::create_dir_all(wt.parent().unwrap()).unwrap();
            repo.run(&["worktree", "add", "-q", &wt.to_string_lossy(), &branch]).unwrap();
            std::fs::write(wt.join(s.id.clone() + ".txt"), drift).unwrap();
            let w = Repo::discover(&wt).unwrap();
            w.run(&["add", "-A"]).unwrap();
            w.run(&["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "drift"]).unwrap();
        }
    }

    fn drift_sha(repo: &Repo, plan: &Plan, slice: &str) -> String {
        repo.run(&["rev-parse", &plan.branch(slice)]).unwrap().trim().to_string()
    }

    #[test]
    fn apply_view_resets_worktrees_but_never_branches() {
        let (_t, r, plan) = repo3();
        seat_worktrees(&r, &plan, "drift\n");
        let before: Vec<String> = plan.slices.iter().map(|s| drift_sha(&r, &plan, &s.id)).collect();
        let base: std::collections::BTreeMap<String, String> = plan.slices.iter().map(|s| (s.id.clone(), plan.base_ref.clone())).collect();
        // An active seat must be refused: an in-flight agent keeps its floor.
        let mut p2 = plan.clone();
        p2.slice_mut("b").unwrap().state = SliceState::Running;
        assert!(apply_view(&r, &p2, &base).is_err(), "refuse to reset under a running agent");
        assert_eq!(apply_view(&r, &plan, &base).unwrap(), 3, "all three seats reset");
        for s in &plan.slices {
            let wt = plan.worktree(&r, &s.id);
            assert!(!wt.join(s.id.clone() + ".txt").exists(), "seat {} drift file gone after the reset", s.id);
            assert_eq!(
                std::fs::read_to_string(wt.join(s.id.clone() + "/x.txt")).unwrap(),
                format!("{}\n", s.id),
                "seat {} base file restored",
                s.id
            );
            let i = s.id.as_str();
            assert_eq!(
                drift_sha(&r, &plan, i),
                before[plan.slices.iter().position(|x| x.id == *i).unwrap()],
                "branch still at its drift commit"
            );
        }
        // Undo through the log: record the view, undo, and it is restored.
        let mut view = std::collections::BTreeMap::new();
        for s in &plan.slices {
            view.insert(s.id.clone(), plan.base_ref.clone());
        }
        let launch = crate::ops::append_op(&r, crate::ops::OpKind::Launch, "run-1", view, "launch").unwrap();
        let undo = crate::ops::undo_to(&r, &launch.id, "run-1").unwrap();
        assert_eq!(undo.kind().unwrap(), crate::ops::OpKind::Undo);
        assert_eq!(apply_view(&r, &plan, &undo.view).unwrap(), 3);
    }
}
