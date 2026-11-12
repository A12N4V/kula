//! `kula plan "<goal>"`: split a goal into module slices from the graph alone.
//! Deterministic: the same index and goal give the same plan.

use super::task::{in_scope, slug, Plan, Slice, SliceState};
use crate::agent::is_test_path;
use crate::git::Repo;
use crate::guard::Guards;
use crate::map::{arch, tree};
use crate::store::Store;
use anyhow::{bail, Result};
use std::collections::{BTreeMap, BTreeSet};

pub struct Opts {
    pub goal: String,
    pub agent: String,
    pub test_cmd: Option<String>,
    pub max_parallel: usize,
    pub max_retries: u32,
}

const STOP: &[&str] = &["the", "and", "for", "with", "into", "from", "that", "this", "add", "fix", "make", "use", "all"];

/// Goal words worth searching: three letters or more, not filler.
fn words(goal: &str) -> Vec<String> {
    let mut seen = BTreeSet::new();
    goal.split(|c: char| !c.is_alphanumeric() && c != '_')
        .map(|w| w.to_lowercase())
        .filter(|w| w.len() >= 3 && !STOP.contains(&w.as_str()))
        .filter(|w| seen.insert(w.clone()))
        .collect()
}

/// The test command for this repo, from its manifests.
pub fn detect_test_cmd(root: &std::path::Path) -> Option<String> {
    let has = |f: &str| root.join(f).exists();
    if has("Cargo.toml") {
        Some("cargo test -q".into())
    } else if has("package.json") {
        Some("npm test --silent".into())
    } else if has("pyproject.toml") || has("setup.py") || has("pytest.ini") {
        Some("python3 -m pytest -q {tests}".into())
    } else if has("go.mod") {
        Some("go test ./...".into())
    } else {
        None
    }
}

pub fn plan(repo: &Repo, st: &Store, o: Opts) -> Result<Plan> {
    let terms = words(&o.goal);
    if terms.is_empty() {
        bail!("say what to change, e.g. `kula plan \"retry failed uploads\"`");
    }
    let mt = tree::module_tree(&repo.root, st);
    let mods = arch::module_dirs(&mt);

    // 1. Files the goal touches, by searching each word on its own.
    let mut files: BTreeSet<String> = BTreeSet::new();
    for t in &terms {
        for n in st.search(t, 50).unwrap_or_default() {
            if n.kind != "package" && !n.path.is_empty() && !is_test_path(&n.path) {
                files.insert(n.path.clone());
            }
        }
    }
    if files.is_empty() {
        bail!("nothing in the graph matches \"{}\" – try the names of the code to change", o.goal);
    }

    // 2. Group by module: module dir -> files.
    let mut groups: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for f in &files {
        groups.entry(arch::resolve(&mods, &arch::dir_of(f))).or_default().insert(f.clone());
    }
    let mut taken: BTreeSet<String> = BTreeSet::new();
    let mut by_dir: BTreeMap<String, Slice> = BTreeMap::new();
    let base = repo.head().unwrap_or_default();
    for (dir, fs) in &groups {
        let (module, scope) = match mods.get(dir) {
            Some(name) => (name.clone(), vec![dir.clone()]),
            None => (if dir == "." { "root".into() } else { dir.clone() }, fs.iter().cloned().collect()),
        };
        let mut id = slug(&module);
        if !taken.insert(id.clone()) {
            id = slug(dir);
            taken.insert(id.clone());
        }
        by_dir.insert(
            dir.clone(),
            Slice { id, module, scope, agent: o.agent.clone(), base_ref: base.clone(), state: SliceState::Queued, ..Default::default() },
        );
    }

    // 3. Dependencies from the module graph; mutual ones (cycles) dropped.
    let g = arch::module_cycle_graph(st, &mods);
    let edge = |a: &str, b: &str| g.get(a).is_some_and(|s| s.contains(b));
    let dirs: Vec<String> = by_dir.keys().cloned().collect();
    for a in &dirs {
        let mut deps: Vec<String> = dirs.iter().filter(|b| *b != a && edge(a, b) && !edge(b, a)).map(|b| by_dir[b].id.clone()).collect();
        deps.sort();
        by_dir.get_mut(a).unwrap().deps = deps;
    }

    // 4. Tests by path convention: inside the scope, or named after the module.
    let all_files: Vec<String> = st.nodes_where("kind = 'file'", []).unwrap_or_default().into_iter().map(|n| n.path).collect();
    for s in by_dir.values_mut() {
        let name = s.module.rsplit('/').next().unwrap_or(&s.module).to_lowercase();
        let mut tests: Vec<String> = all_files
            .iter()
            .filter(|f| is_test_path(f))
            .filter(|f| {
                let stem = f.rsplit('/').next().unwrap_or(f).to_lowercase();
                in_scope(f, &s.scope) || (name.len() >= 3 && stem.contains(&name))
            })
            .cloned()
            .collect();
        tests.sort();
        s.tests = tests;
    }

    let slices = topo(by_dir.into_values().collect());

    // 5. Risk.
    let guards = Guards::for_agent(repo, Some(&o.agent))?;
    let fenced = all_files.iter().any(|f| slices.iter().any(|s| in_scope(f, &s.scope)) && !guards.path(f).level.editable());
    let risk = if fenced || slices.len() > 4 {
        "high"
    } else if slices.len() > 1 {
        "medium"
    } else {
        "low"
    };

    let mut baseline: Vec<Vec<String>> = arch::check(&mt, st)
        .cycles
        .into_iter()
        .map(|mut c| {
            c.sort();
            c.dedup();
            c
        })
        .collect();
    baseline.sort();
    baseline.dedup();

    Ok(Plan {
        schema: 1,
        id: slug(&o.goal),
        goal: o.goal,
        risk: risk.into(),
        base_ref: base,
        max_parallel: o.max_parallel.max(1),
        max_retries: o.max_retries,
        test_cmd: o.test_cmd.or_else(|| detect_test_cmd(&repo.root)),
        baseline_cycles: baseline,
        agents: BTreeMap::new(),
        slices,
    })
}

/// Dependencies first, ties broken by id.
fn topo(mut slices: Vec<Slice>) -> Vec<Slice> {
    slices.sort_by(|a, b| a.id.cmp(&b.id));
    let mut out: Vec<Slice> = Vec::new();
    let mut done: BTreeSet<String> = BTreeSet::new();
    while !slices.is_empty() {
        let i = slices.iter().position(|s| s.deps.iter().all(|d| done.contains(d))).unwrap_or(0);
        let s = slices.remove(i);
        done.insert(s.id.clone());
        out.push(s);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_skip_filler() {
        assert_eq!(words("Add retry to the HTTP client, retry"), vec!["retry", "http", "client"]);
    }

    #[test]
    fn topo_puts_deps_first() {
        let s = |id: &str, deps: &[&str]| Slice { id: id.into(), deps: deps.iter().map(|d| d.to_string()).collect(), ..Default::default() };
        let out = topo(vec![s("a", &["c"]), s("b", &[]), s("c", &["b"])]);
        let ids: Vec<&str> = out.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, vec!["b", "c", "a"]);
    }
}
