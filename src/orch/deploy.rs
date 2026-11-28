//! Deploying a team (H.8): one slice per seat, held to the seat's scope and,
//! when the deploy names target flows, to those flows' files. Hand-offs become
//! dependencies, so a reviewer waits for the seat that hands it the work.
//! The plan is saved under `.kula/plans/` and run by a `kula run-plan` child.

use super::plan::{detect_test_cmd, tests_for};
use super::task::{in_scope, slug, Plan, Slice};
use crate::config::{Config, Member, Team};
use crate::git::Repo;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

#[derive(Deserialize, Serialize, Clone, Debug, Default)]
#[serde(default)]
pub struct DeployOpts {
    pub team: String,
    pub goal: String,
    /// Flow ids from the flow map the run is held to.
    pub flows: Vec<String>,
    /// Dollar cap for the run.
    pub budget: Option<f64>,
}

/// The part of a scope glob that is a plain path prefix: `src/api/**` is `src/api`.
pub fn glob_root(g: &str) -> String {
    let g = g.trim().trim_start_matches("./");
    let cut = g.find(['*', '?', '[', '{']).unwrap_or(g.len());
    let head = &g[..cut];
    // `src/api/*.rs` keeps `src/api`; `src/ap*` keeps `src`.
    let head = if cut < g.len() { head.rsplit_once('/').map(|(a, _)| a).unwrap_or("") } else { head };
    head.trim_end_matches('/').to_string()
}

/// A seat's own scope as path prefixes: its own, else its workflow's.
fn seat_scope(cfg: &Config, m: &Member) -> Vec<String> {
    let mut raw = m.scope.clone();
    if raw.is_empty() && !m.workflow.is_empty() {
        raw = crate::workflow::find(cfg, &m.workflow).map(|w| w.scope).unwrap_or_default();
    }
    let mut out: Vec<String> = vec![];
    for r in raw {
        let paths = match r.strip_prefix('@') {
            Some(name) => cfg.scopes.iter().find(|s| s.name == name).map(|s| s.paths.clone()).unwrap_or_default(),
            None => vec![r],
        };
        for p in paths {
            let root = glob_root(&p);
            if !root.is_empty() && !out.contains(&root) {
                out.push(root);
            }
        }
    }
    out
}

/// The plan for a team, from the repo's files and the target flows' files.
pub fn team_plan(cfg: &Config, o: &DeployOpts, all_files: &[String], flow_files: &[String], base_ref: &str) -> Result<Plan> {
    let team: &Team = cfg.teams.iter().find(|t| t.name == o.team).with_context(|| format!("no team named {}", o.team))?;
    if team.members.is_empty() {
        bail!("team {} has no seats", team.name);
    }
    let goal = o.goal.trim();
    if goal.is_empty() {
        bail!("a deploy needs a goal");
    }
    let mut slices: Vec<Slice> = vec![];
    let mut id_of: BTreeMap<String, String> = BTreeMap::new();
    for m in &team.members {
        let mut id = slug(m.key());
        if id.is_empty() {
            id = "seat".into();
        }
        let mut n = 2;
        while slices.iter().any(|s| s.id == id) {
            id = format!("{}-{n}", slug(m.key()));
            n += 1;
        }
        id_of.insert(m.key().to_string(), id.clone());
        let own = seat_scope(cfg, m);
        let scope: Vec<String> = if flow_files.is_empty() {
            if own.is_empty() {
                vec![".".into()]
            } else {
                own.clone()
            }
        } else if own.is_empty() {
            flow_files.to_vec()
        } else {
            let both: Vec<String> = flow_files.iter().filter(|f| in_scope(f, &own)).cloned().collect();
            // A seat the flows do not reach keeps its own scope.
            if both.is_empty() {
                own.clone()
            } else {
                both
            }
        };
        let module = own.first().cloned().unwrap_or_else(|| m.key().to_string());
        let agent = match m.provider(&cfg.agents.default) {
            "any" => "claude".to_string(),
            a => a.to_string(),
        };
        slices.push(Slice {
            id,
            tests: tests_for(all_files, &scope, &module),
            module,
            scope,
            agent,
            base_ref: base_ref.to_string(),
            seat: format!("{}/{}", team.name, m.key()),
            ..Default::default()
        });
    }
    // Hand-offs: the receiving seat waits for the one handing off. An edge that
    // would close a loop is dropped.
    let mut deps: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let reaches = |deps: &BTreeMap<String, BTreeSet<String>>, from: &str, to: &str| {
        let mut stack = vec![from.to_string()];
        let mut seen = BTreeSet::new();
        while let Some(x) = stack.pop() {
            if x == to {
                return true;
            }
            if seen.insert(x.clone()) {
                stack.extend(deps.get(&x).into_iter().flatten().cloned());
            }
        }
        false
    };
    for m in &team.members {
        let from = &id_of[m.key()];
        for to in &m.hands_off {
            let Some(to) = id_of.get(to) else { continue };
            if to == from || reaches(&deps, from, to) {
                continue;
            }
            deps.entry(to.clone()).or_default().insert(from.clone());
        }
    }
    for s in &mut slices {
        s.deps = deps.remove(&s.id).map(|d| d.into_iter().collect()).unwrap_or_default();
    }
    Ok(Plan {
        schema: 1,
        id: slug(&format!("{} {}", team.name, goal)),
        goal: goal.to_string(),
        risk: "medium".into(),
        base_ref: base_ref.to_string(),
        max_parallel: 2,
        max_retries: 1,
        test_cmd: None,
        agents: cfg.agents.commands.clone(),
        team: team.name.clone(),
        budget_usd: o.budget.filter(|b| *b > 0.0),
        slices,
        ..Default::default()
    })
}

/// The plan for a deploy, from the repo's index, saved to `.kula/plans/<id>.json`.
pub fn make(repo: &Repo, o: &DeployOpts) -> Result<(Plan, PathBuf)> {
    let cfg = Config::load(&repo.root)?;
    let st = crate::store::Store::open(repo).ok();
    let all_files: Vec<String> =
        st.as_ref().and_then(|s| s.nodes_where("kind = 'file'", []).ok()).unwrap_or_default().into_iter().map(|n| n.path).collect();
    let mut flow_files: Vec<String> = vec![];
    if !o.flows.is_empty() {
        let st = st.as_ref().context("the repo is not indexed yet, so its flows are unknown")?;
        let fm = crate::graph::flowmap(st, 400)?;
        for id in &o.flows {
            let f = fm.flows.iter().find(|f| &f.id == id).with_context(|| format!("no flow {id}"))?;
            for x in &f.files {
                if !flow_files.contains(x) {
                    flow_files.push(x.clone());
                }
            }
        }
    }
    let base = repo.head().unwrap_or_default();
    let mut plan = team_plan(&cfg, o, &all_files, &flow_files, &base)?;
    // The team's own gate wins; otherwise the manifests say how to test.
    let own = cfg.teams.iter().find(|t| t.name == o.team).map(|t| t.test.trim().to_string()).filter(|t| !t.is_empty());
    plan.test_cmd = own.or_else(|| detect_test_cmd(&repo.root));
    let path = repo.kula_dir().join("plans").join(format!("{}.json", plan.id));
    let live = plan.run_dir(repo).join("state.json");
    if let Ok(prev) = Plan::load(&live) {
        if prev.slices.iter().any(|s| s.state.active()) && running(repo, &plan.id) {
            bail!("{} is already running", plan.id);
        }
    }
    let gi = repo.kula_dir().join(".gitignore");
    if !gi.exists() {
        std::fs::create_dir_all(repo.kula_dir())?;
        std::fs::write(&gi, "*\n")?;
    }
    plan.save(&path)?;
    let _ = super::task::record(repo, &plan, &format!("deploy {}: {}", plan.team, plan.goal));
    Ok((plan, path))
}

/// A `run-plan` child for this plan is alive (its pid file names a live process).
fn running(repo: &Repo, plan: &str) -> bool {
    let pid =
        std::fs::read_to_string(repo.kula_dir().join("runs").join(plan).join("deploy.pid")).ok().and_then(|s| s.trim().parse::<u32>().ok());
    pid.is_some_and(|p| Command::new("kill").args(["-0", &p.to_string()]).stderr(Stdio::null()).status().is_ok_and(|s| s.success()))
}

/// Starts `kula run-plan <path>` in the background; `trigger` is what the ledger records.
pub fn start(repo: &Repo, plan: &Plan, path: &Path, trigger: &str) -> Result<Child> {
    let exe = std::env::current_exe()?;
    let dir = plan.run_dir(repo);
    std::fs::create_dir_all(&dir)?;
    let log = std::fs::File::create(dir.join("deploy.log"))?;
    let child = Command::new(exe)
        .arg("run-plan")
        .arg(path)
        .current_dir(&repo.root)
        .env("KULA_TRIGGER", trigger)
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log)
        .spawn()
        .context("could not start kula run-plan")?;
    let _ = std::fs::write(dir.join("deploy.pid"), child.id().to_string());
    Ok(child)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Team;

    fn member(name: &str, scope: &[&str], hands: &[&str]) -> Member {
        Member {
            name: name.into(),
            agent: "fake".into(),
            scope: scope.iter().map(|s| s.to_string()).collect(),
            hands_off: hands.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        }
    }

    fn cfg(members: Vec<Member>) -> Config {
        let mut c = Config::default();
        c.teams.push(Team { name: "core".into(), members, ..Default::default() });
        c.agents.commands.insert("fake".into(), vec!["fake-agent".into(), "{prompt}".into()]);
        c
    }

    #[test]
    fn glob_roots() {
        assert_eq!(glob_root("src/api/**"), "src/api");
        assert_eq!(glob_root("src/api/*.rs"), "src/api");
        assert_eq!(glob_root("src/ap*"), "src");
        assert_eq!(glob_root("./web/src/"), "web/src");
        assert_eq!(glob_root("**/*.rs"), "");
    }

    #[test]
    fn one_slice_per_seat_with_handoffs_as_deps() {
        let c = cfg(vec![member("lead", &["src/**"], &["tester"]), member("tester", &["tests/**"], &["lead"]), member("doc", &[], &[])]);
        let files: Vec<String> = ["src/a.rs", "tests/a_test.rs", "README.md"].iter().map(|s| s.to_string()).collect();
        let o = DeployOpts { team: "core".into(), goal: "Fix the parser".into(), budget: Some(1.5), ..Default::default() };
        let p = team_plan(&c, &o, &files, &[], "abc").unwrap();
        assert_eq!(p.id, "core-fix-the-parser");
        assert_eq!(p.team, "core");
        assert_eq!(p.budget_usd, Some(1.5));
        assert_eq!(p.agents["fake"][0], "fake-agent");
        let ids: Vec<&str> = p.slices.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["lead", "tester", "doc"]);
        assert_eq!(p.slices[0].scope, ["src"]);
        assert_eq!(p.slices[0].seat, "core/lead");
        // lead hands to tester; tester's hand back would close a loop, so it is dropped.
        assert!(p.slices[0].deps.is_empty());
        assert_eq!(p.slices[1].deps, ["lead"]);
        assert_eq!(p.slices[1].tests, ["tests/a_test.rs"]);
        assert_eq!(p.slices[2].scope, ["."]);
    }

    #[test]
    fn target_flows_narrow_the_scope() {
        let c = cfg(vec![member("api", &["src/api/**"], &[]), member("ui", &["web/**"], &[]), member("free", &[], &[])]);
        let flows: Vec<String> = ["src/api/login.rs", "src/db.rs"].iter().map(|s| s.to_string()).collect();
        let o = DeployOpts { team: "core".into(), goal: "speed up login".into(), ..Default::default() };
        let p = team_plan(&c, &o, &[], &flows, "").unwrap();
        assert_eq!(p.slices[0].scope, ["src/api/login.rs"]);
        assert_eq!(p.slices[1].scope, ["web"]);
        assert_eq!(p.slices[2].scope, flows);
    }

    #[test]
    fn refuses_unknown_team_and_empty_goal() {
        let c = cfg(vec![member("lead", &[], &[])]);
        assert!(team_plan(&c, &DeployOpts { team: "nope".into(), goal: "x".into(), ..Default::default() }, &[], &[], "").is_err());
        assert!(team_plan(&c, &DeployOpts { team: "core".into(), goal: " ".into(), ..Default::default() }, &[], &[], "").is_err());
    }
}
