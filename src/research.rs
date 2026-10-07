//! Autoresearch: an agent improves a number, and kula keeps score.
//!
//! A workflow with a `[workflow.research]` table names a metric – a shell
//! command whose last printed number is the result – and which way is better.
//! `kula research start` measures a baseline (on a branch of its own, by
//! default). Then the loop: the agent changes code in the workflow's scope and
//! calls `experiment`; kula checks the change against the fences, runs the
//! metric itself, commits the change when the number improves and reverts it
//! when it doesn't. Agents never report their own results, so a run can't be
//! talked into a better score, and every kept step is a commit you can read.
//!
//! State lives in `.kula/research/<workflow>.json`, local to the checkout.

use crate::config::Config;
use crate::git::Repo;
use crate::guard::{self, Guards};
use crate::workflow::{self, Research, Workflow};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Experiment {
    pub n: u32,
    pub hypothesis: String,
    /// The metric after the change; none when it was rejected or the run failed.
    pub value: Option<f64>,
    pub best_before: Option<f64>,
    pub kept: bool,
    /// The commit that keeps it.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub commit: String,
    pub files: Vec<String>,
    pub by: String,
    pub at: i64,
    /// Why it was rejected, or how the run failed.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub note: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct State {
    pub workflow: String,
    pub metric: String,
    pub goal: String,
    pub budget: u32,
    pub branch: String,
    /// The commit the run started from.
    pub base: String,
    pub baseline: f64,
    pub best: f64,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub best_commit: String,
    pub started: i64,
    pub by: String,
    pub active: bool,
    pub experiments: Vec<Experiment>,
}

impl State {
    /// How much better the best is than the baseline, as a fraction.
    pub fn gain(&self) -> f64 {
        if self.baseline == 0.0 {
            return 0.0;
        }
        let d = (self.best - self.baseline) / self.baseline.abs();
        let g = if self.goal == "max" { d } else { -d };
        if g == 0.0 {
            0.0
        } else {
            g
        }
    }
    pub fn left(&self) -> Option<u32> {
        (self.budget > 0).then(|| self.budget.saturating_sub(self.experiments.len() as u32))
    }
}

fn dir(repo: &Repo) -> std::path::PathBuf {
    repo.kula_dir().join("research")
}

fn save(repo: &Repo, s: &State) -> Result<()> {
    std::fs::create_dir_all(dir(repo))?;
    std::fs::write(dir(repo).join(format!("{}.json", s.workflow)), serde_json::to_string_pretty(s)?)?;
    Ok(())
}

/// Every run in this checkout, newest first.
pub fn list(repo: &Repo) -> Vec<State> {
    let mut out: Vec<State> = std::fs::read_dir(dir(repo))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| serde_json::from_str(&std::fs::read_to_string(e.path()).ok()?).ok())
        .collect();
    out.sort_by_key(|s| -s.started);
    out
}

pub fn active(repo: &Repo) -> Option<State> {
    list(repo).into_iter().find(|s| s.active)
}

fn research_of(cfg: &Config, name: &str) -> Result<(Workflow, Research)> {
    let Some(w) = workflow::find(cfg, name) else { bail!("no workflow called {name} – `kula workflow list`") };
    match w.research.clone() {
        Some(r) if !r.metric.trim().is_empty() => Ok((w, r)),
        _ => bail!("the {name} workflow has no metric – `kula research init --metric \"<command>\"` sets one up"),
    }
}

/// The last number in `text`.
pub fn last_number(text: &str) -> Option<f64> {
    let mut best = None;
    let mut cur = String::new();
    let flush = |cur: &mut String, best: &mut Option<f64>| {
        let t = cur.trim_end_matches(['.', 'e', 'E', '+', '-']).trim_start_matches('+');
        if t.chars().any(|c| c.is_ascii_digit()) {
            if let Ok(v) = t.parse::<f64>() {
                *best = Some(v);
            }
        }
        cur.clear();
    };
    for c in text.chars() {
        let starts = c.is_ascii_digit() || (c == '-' && cur.is_empty()) || (c == '.' && cur.chars().all(|x| x == '-'));
        if c.is_ascii_digit() || (!cur.is_empty() && ".eE+-".contains(c)) || starts {
            cur.push(c);
        } else {
            flush(&mut cur, &mut best);
        }
    }
    flush(&mut cur, &mut best);
    best
}

/// Run the metric at the repository root: its last number, and the tail of what it printed.
pub fn measure(repo: &Repo, r: &Research) -> Result<(f64, String)> {
    let mut child = Command::new("sh")
        .arg("-c")
        .arg(&r.metric)
        .current_dir(&repo.root)
        .env("KULA_RESEARCH", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("running the metric")?;
    let mut out = child.stdout.take().unwrap();
    let mut err = child.stderr.take().unwrap();
    let to = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = out.read_to_string(&mut s);
        s
    });
    let te = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = err.read_to_string(&mut s);
        s
    });
    let t0 = Instant::now();
    let limit = Duration::from_secs(r.timeout_secs());
    let status = loop {
        if let Some(s) = child.try_wait()? {
            break s;
        }
        if t0.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            bail!("the metric ran past its {}s timeout", r.timeout_secs());
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let (stdout, stderr) = (to.join().unwrap_or_default(), te.join().unwrap_or_default());
    let tail = |s: &str| s.lines().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
    if !status.success() {
        bail!("the metric failed ({status}):\n{}", tail(if stderr.trim().is_empty() { &stdout } else { &stderr }));
    }
    match last_number(&stdout).or_else(|| last_number(&stderr)) {
        Some(v) => Ok((v, tail(&stdout))),
        None => bail!("the metric printed no number:\n{}", tail(&stdout)),
    }
}

/// Changed files in the working tree; kula's own config (kula.toml, agent wiring) is never part of an experiment.
fn changed(repo: &Repo) -> Result<Vec<crate::git::FileStatus>> {
    Ok(repo.status()?.into_iter().filter(|f| !guard::is_own(&f.path)).collect())
}

/// Put the working tree back to HEAD for these files.
fn revert(repo: &Repo, files: &[crate::git::FileStatus]) -> Result<()> {
    let mut tracked = vec![];
    for f in files {
        if f.untracked {
            let _ = std::fs::remove_file(repo.root.join(&f.path));
        } else {
            tracked.push(f.path.clone());
            if let Some(o) = &f.orig {
                tracked.push(o.clone());
            }
        }
    }
    if !tracked.is_empty() {
        let mut args = vec!["restore".to_string(), "--source=HEAD".into(), "--staged".into(), "--worktree".into(), "--".into()];
        args.extend(tracked);
        repo.run(&args)?;
    }
    Ok(())
}

/// Start a run of `name`: check the tree is clean, branch, measure the baseline.
pub fn start(repo: &Repo, name: &str, by: &str, branch: bool) -> Result<State> {
    let cfg = Config::load(&repo.root)?;
    let (w, r) = research_of(&cfg, name)?;
    if let Some(a) = active(repo) {
        bail!("the {} run is still going – `kula research stop` first", a.workflow);
    }
    if !changed(repo)?.is_empty() {
        bail!("commit or stash your changes first: experiments are kept and reverted with git");
    }
    let base = repo.head().unwrap_or_default();
    let mut br = repo.branch();
    if branch {
        let stamp = chrono_stamp();
        br = format!("research/{name}-{stamp}");
        repo.run(&["switch", "-q", "-c", &br])?;
    }
    let (v, _) = measure(repo, &r)?;
    if guard::task(repo).is_none() {
        guard::task_start(repo, &format!("autoresearch: {}", w.about), vec![], Some(name), by)?;
    }
    let s = State {
        workflow: name.into(),
        metric: r.metric.clone(),
        goal: if r.minimise() { "min".into() } else { "max".into() },
        budget: r.budget,
        branch: br,
        base,
        baseline: v,
        best: v,
        best_commit: String::new(),
        started: crate::meta::now(),
        by: by.into(),
        active: true,
        experiments: vec![],
    };
    save(repo, &s)?;
    Ok(s)
}

/// YYYYMMDD-HHMM in UTC, without a date crate.
fn chrono_stamp() -> String {
    let t = crate::meta::now();
    let (days, secs) = (t.div_euclid(86_400), t.rem_euclid(86_400));
    // civil-from-days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}{m:02}{d:02}-{:02}{:02}", secs / 3600, secs % 3600 / 60)
}

/// One step of the loop: the working tree's change is the experiment.
pub fn experiment(repo: &Repo, hypothesis: &str, by: &str) -> Result<Experiment> {
    let Some(mut s) = active(repo) else { bail!("no research is running – `kula research start <workflow>`") };
    if hypothesis.trim().is_empty() {
        bail!("say what you are testing: a one-line hypothesis");
    }
    if s.left() == Some(0) {
        bail!("the budget of {} experiments is spent – `kula research stop`", s.budget);
    }
    let cfg = Config::load(&repo.root)?;
    let (_, r) = research_of(&cfg, &s.workflow)?;
    let files = changed(repo)?;
    if files.is_empty() {
        bail!("nothing changed – make one change in scope, then run the experiment");
    }
    let mut e = Experiment {
        n: s.experiments.len() as u32 + 1,
        hypothesis: hypothesis.trim().into(),
        best_before: Some(s.best),
        files: files.iter().map(|f| f.path.clone()).collect(),
        by: by.into(),
        at: crate::meta::now(),
        ..Default::default()
    };
    let g = Guards::for_agent(repo, by.strip_prefix("agent:"))?;
    let fenced: Vec<String> = files.iter().filter(|f| !g.path(&f.path).level.editable()).map(|f| f.path.clone()).collect();
    if !fenced.is_empty() {
        revert(repo, &files)?;
        e.note = format!("rejected and reverted: touched fenced {}", fenced.join(", "));
    } else {
        match measure(repo, &r) {
            Err(err) => {
                revert(repo, &files)?;
                e.note = format!("reverted: {err}");
            }
            Ok((v, _)) => {
                e.value = Some(v);
                let better = if r.minimise() { v < s.best } else { v > s.best };
                if better {
                    let mut add = vec!["add".to_string(), "-A".into(), "--".into()];
                    add.extend(e.files.iter().cloned());
                    repo.run(&add)?;
                    let msg = format!(
                        "research #{}: {}\n\n{} {} → {} ({}), by {}",
                        e.n,
                        e.hypothesis,
                        s.workflow,
                        fmt(s.best),
                        fmt(v),
                        if r.minimise() { "lower is better" } else { "higher is better" },
                        by
                    );
                    repo.run(&["commit", "-q", "-m", &msg])?;
                    e.commit = repo.head().unwrap_or_default();
                    e.kept = true;
                    s.best = v;
                    s.best_commit = e.commit.clone();
                } else {
                    revert(repo, &files)?;
                    e.note = format!("reverted: {} is not better than {}", fmt(v), fmt(s.best));
                }
            }
        }
    }
    s.experiments.push(e.clone());
    save(repo, &s)?;
    Ok(e)
}

/// Rename a workflow everywhere it is named: kula.toml, the team seats that
/// use it, and its research run. A built-in stays; the new name is its copy.
pub fn rename_workflow(repo: &Repo, from: &str, to: &str) -> Result<()> {
    if !workflow::valid_name(to) {
        bail!("workflow names are letters, digits, - and _: {to:?}");
    }
    let cfg = Config::load(&repo.root)?;
    if from == to {
        return Ok(());
    }
    if workflow::find(&cfg, to).is_some() {
        bail!("there is already a workflow called {to}");
    }
    let Some(w) = workflow::find(&cfg, from) else { bail!("no workflow called {from}") };
    let mut wfs = cfg.workflows.clone();
    if w.builtin {
        wfs.push(Workflow { name: to.into(), builtin: false, ..w });
    } else {
        wfs.iter_mut().filter(|x| x.name == from).for_each(|x| x.name = to.into());
        let mut teams = cfg.teams.clone();
        let mut moved = false;
        for m in teams.iter_mut().flat_map(|t| t.members.iter_mut()).filter(|m| m.workflow == from) {
            m.workflow = to.into();
            moved = true;
        }
        crate::config::set_workflows(&repo.root, &wfs)?;
        if moved {
            crate::config::set_teams(&repo.root, &teams)?;
        }
        let old = dir(repo).join(format!("{from}.json"));
        if let Ok(text) = std::fs::read_to_string(&old) {
            let mut s: State = serde_json::from_str(&text)?;
            s.workflow = to.into();
            save(repo, &s)?;
            std::fs::remove_file(old)?;
        }
        return Ok(());
    }
    crate::config::set_workflows(&repo.root, &wfs)?;
    Ok(())
}

pub fn fmt(v: f64) -> String {
    if v.fract() == 0.0 && v.abs() < 1e12 {
        format!("{v:.0}")
    } else {
        let s = format!("{v:.4}");
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

/// End the run; the branch and its commits stay.
pub fn stop(repo: &Repo) -> Result<State> {
    let Some(mut s) = active(repo) else { bail!("no research is running") };
    s.active = false;
    save(repo, &s)?;
    if guard::task(repo).is_some_and(|t| t.workflow == s.workflow) {
        guard::task_done(repo)?;
    }
    Ok(s)
}

/// Turn a workflow into a research loop in kula.toml (creating it when new).
pub fn init(repo: &Repo, name: &str, r: Research, scope: Vec<String>) -> Result<Workflow> {
    if r.metric.trim().is_empty() {
        bail!("a research loop needs a metric: a command that prints a number");
    }
    if !matches!(r.goal.as_str(), "min" | "max") {
        bail!("goal is min or max, not {:?}", r.goal);
    }
    let cfg = Config::load(&repo.root)?;
    let mut own = cfg.workflows.clone();
    let base = workflow::find(&cfg, name).unwrap_or_else(|| Workflow {
        name: name.into(),
        about: "Run experiments in a loop: change, measure, keep what's better".into(),
        ..Default::default()
    });
    let mut w = Workflow { research: Some(r), builtin: false, ..base };
    if !scope.is_empty() {
        w.scope = scope;
    }
    if w.steps.is_empty() {
        w.steps = workflow::find(&Config::default(), "autoresearch").map(|a| a.steps).unwrap_or_default();
    }
    match own.iter_mut().find(|x| x.name == w.name) {
        Some(x) => *x = w.clone(),
        None => own.push(w.clone()),
    }
    crate::config::set_workflows(&repo.root, &own)?;
    Ok(w)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_last_number() {
        assert_eq!(last_number("loss 0.25\nval_loss: 0.183"), Some(0.183));
        assert_eq!(last_number("time: [12.5 ms 12.9 ms 13.1 ms]"), Some(13.1));
        assert_eq!(last_number("score -3.5e-2."), Some(-0.035));
        assert_eq!(last_number("ok."), None);
        assert_eq!(fmt(12.0), "12");
        assert_eq!(fmt(0.18300), "0.183");
    }
}
