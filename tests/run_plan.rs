//! K4: `kula run-plan` with a fake agent: retry cap, parallel cap, and that a
//! test run never starts a real agent CLI.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use tempfile::TempDir;

const KULA: &str = env!("CARGO_BIN_EXE_kula");

fn fake() -> String {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-agent.sh").to_string_lossy().into_owned()
}

fn git(dir: &Path, args: &[&str]) -> String {
    let o = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
    assert!(o.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&o.stderr));
    String::from_utf8_lossy(&o.stdout).into_owned()
}

/// Three independent dirs a/, b/, c/.
fn repo() -> TempDir {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git(d, &["init", "-q", "-b", "main"]);
    git(d, &["config", "user.name", "Tester"]);
    git(d, &["config", "user.email", "t@example.com"]);
    git(d, &["config", "commit.gpgsign", "false"]);
    for m in ["a", "b", "c"] {
        std::fs::create_dir_all(d.join(m)).unwrap();
        std::fs::write(d.join(m).join("x.txt"), "x\n").unwrap();
    }
    std::fs::write(d.join("README.md"), "# r\n").unwrap();
    git(d, &["add", "-A"]);
    git(d, &["commit", "-qm", "initial"]);
    t
}

fn write_plan(d: &Path, ids: &[&str], agent: &str, test_cmd: &str, par: usize) -> PathBuf {
    let base = git(d, &["rev-parse", "HEAD"]).trim().to_string();
    let slices: Vec<Value> = ids.iter().map(|i| json!({"id": i, "module": i, "scope": [i], "agent": agent, "base_ref": base})).collect();
    let plan = json!({
        "schema": 1, "id": "t", "goal": "test", "risk": "low", "base_ref": base,
        "max_parallel": par, "max_retries": 2, "test_cmd": test_cmd,
        "agents": {"fake-agent": [fake(), "{prompt}"]},
        "slices": slices,
    });
    let p = d.join(".kula/plan.json");
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(&p, serde_json::to_string_pretty(&plan).unwrap()).unwrap();
    p
}

fn run(d: &Path, envs: &[(&str, &str)]) -> (Output, Value) {
    let mut c = Command::new(KULA);
    c.arg("-C").arg(d).args(["run-plan"]).env("KULA_NO_AGENT", "1");
    for (k, v) in envs {
        c.env(k, v);
    }
    let o = c.output().unwrap();
    let plan = std::fs::read_to_string(d.join(".kula/plan.json")).map(|s| serde_json::from_str(&s).unwrap()).unwrap_or(Value::Null);
    (o, plan)
}

fn text(o: &Output) -> String {
    format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr))
}

#[test]
fn passing_slice_is_committed_on_its_branch() {
    let t = repo();
    let d = t.path();
    write_plan(d, &["a"], "fake-agent", "true", 1);
    let (o, p) = run(d, &[]);
    assert_eq!(o.status.code(), Some(0), "{}", text(&o));
    assert_eq!(p["slices"][0]["state"], "passed", "{p}");
    let files = git(d, &["show", "--name-only", "--format=", "kula/t/a"]);
    assert!(files.contains("a/fake_1.txt"), "{files}");
    assert!(!d.join(".kula/worktrees/t/a").exists(), "worktree should be removed");
    assert!(d.join(".kula/runs/t/a/attempt-1.md").exists());
}

#[test]
fn retries_stop_at_the_cap_and_escalate() {
    let t = repo();
    let d = t.path();
    write_plan(d, &["a"], "fake-agent", "false", 1);
    let (o, p) = run(d, &[]);
    assert_eq!(o.status.code(), Some(1), "{}", text(&o));
    let s = &p["slices"][0];
    assert_eq!(s["state"], "failed", "{p}");
    assert_eq!(s["attempts"], 3, "{p}");
    assert_eq!(s["escalate"], true, "{p}");
    let retry = std::fs::read_to_string(d.join(".kula/runs/t/a/prompt-2.md")).unwrap();
    assert!(retry.contains("Attempt 2") && retry.contains("tests failed"), "{retry}");
}

#[test]
fn out_of_scope_is_rejected_without_retry() {
    let t = repo();
    let d = t.path();
    write_plan(d, &["a"], "fake-agent", "true", 1);
    let (o, p) = run(d, &[("FAKE_MODE", "outside")]);
    assert_eq!(o.status.code(), Some(1), "{}", text(&o));
    assert_eq!(p["slices"][0]["state"], "rejected", "{p}");
    assert_eq!(p["slices"][0]["attempts"], 1, "{p}");
}

#[test]
fn at_most_max_parallel_run_at_once() {
    let t = repo();
    let d = t.path();
    let seen = d.join(".seen");
    write_plan(d, &["a", "b", "c"], "fake-agent", "true", 2);
    let (o, p) = run(d, &[("FAKE_SLEEP", "1"), ("FAKE_SEEN", &seen.to_string_lossy())]);
    assert_eq!(o.status.code(), Some(0), "{}", text(&o));
    assert!(p["slices"].as_array().unwrap().iter().all(|s| s["state"] == "passed"), "{p}");
    let mut saw_queued = false;
    for e in std::fs::read_dir(&seen).unwrap() {
        let v: Value = serde_json::from_str(&std::fs::read_to_string(e.unwrap().path()).unwrap()).unwrap();
        let states: Vec<&str> = v["slices"].as_array().unwrap().iter().map(|s| s["state"].as_str().unwrap()).collect();
        let active = states.iter().filter(|s| matches!(**s, "running" | "gating")).count();
        assert!(active <= 2, "{states:?}");
        saw_queued |= states.contains(&"queued");
    }
    assert!(saw_queued, "the third slice should wait");
}

#[test]
fn no_real_agent_under_kula_no_agent() {
    let t = repo();
    let d = t.path();
    let bin = d.join(".trap");
    std::fs::create_dir_all(&bin).unwrap();
    let marker = d.join(".trap/ran");
    std::fs::write(bin.join("claude"), format!("#!/bin/sh\ntouch '{}'\n", marker.display())).unwrap();
    Command::new("chmod").arg("+x").arg(bin.join("claude")).status().unwrap();
    write_plan(d, &["a"], "claude", "true", 1);
    let path = format!("{}:{}", bin.display(), std::env::var("PATH").unwrap_or_default());
    let (o, _) = run(d, &[("PATH", &path)]);
    assert!(!o.status.success(), "{}", text(&o));
    assert!(text(&o).contains("KULA_NO_AGENT"), "{}", text(&o));
    assert!(!marker.exists(), "a real agent CLI was started");
}

#[test]
fn memory_check_holds_slices_back() {
    let t = repo();
    let d = t.path();
    write_plan(d, &["a", "b", "c"], "fake-agent", "true", 1);
    // Enough memory for the first slice only.
    let (o, p) = run(d, &[("KULA_MEM_CHECK", "[ ! -e .mem ] && touch .mem || { echo 'free 3%' >&2; exit 1; }")]);
    assert_eq!(o.status.code(), Some(1), "{}", text(&o));
    let s = p["slices"].as_array().unwrap();
    assert_eq!(s[0]["state"], "passed", "{p}");
    for x in &s[1..] {
        assert_eq!(x["state"], "failed", "{p}");
        assert_eq!(x["escalate"], true, "{p}");
        assert_eq!(x["attempts"], 0, "{p}");
        assert!(x["reasons"][0].as_str().unwrap().contains("not enough memory to start: free 3%"), "{p}");
    }
    assert!(!d.join(".kula/worktrees/t/b").exists());
}

#[test]
fn status_shows_slices_and_starts_nothing() {
    let t = repo();
    let d = t.path();
    write_plan(d, &["a", "b"], "fake-agent", "true", 1);
    let st = |extra: &[&str]| {
        let o = Command::new(KULA).arg("-C").arg(d).args(["run-plan", "--status"]).args(extra).env("KULA_NO_AGENT", "1").output().unwrap();
        assert!(o.status.success(), "{}", text(&o));
        text(&o)
    };
    assert!(st(&[]).contains("2 queued · 0 running"), "{}", st(&[]));
    assert!(!d.join(".kula/worktrees").exists(), "status must not start slices");
    let (o, _) = run(d, &[]);
    assert_eq!(o.status.code(), Some(0), "{}", text(&o));
    assert!(st(&[]).contains("0 queued · 0 running · 0 gating · 2 passed"), "{}", st(&[]));
    let v: Value = serde_json::from_str(&st(&["--json"])).unwrap();
    assert_eq!(v["slices"][1]["state"], "passed");
}

#[test]
fn run_is_kept_in_meta_and_restores_a_missing_plan() {
    let t = repo();
    let d = t.path();
    write_plan(d, &["a"], "fake-agent", "true", 1);
    let (o, _) = run(d, &[("FAKE_MODE", "clean")]);
    assert!(o.status.success(), "{}", text(&o));
    let log = git(d, &["log", "--format=%s", "refs/kula/meta"]);
    assert!(log.contains("kula: run t: 1/1 passed"), "{log}");
    let kept: Value = serde_json::from_str(&git(d, &["show", "refs/kula/meta:kula.json"])).unwrap();
    assert_eq!(kept["plans"][0]["slices"][0]["state"], "passed");

    // A cleaned .kula: status comes back from the meta ref.
    std::fs::remove_dir_all(d.join(".kula")).unwrap();
    let o = Command::new(KULA).arg("-C").arg(d).args(["run-plan", "--status"]).output().unwrap();
    assert!(text(&o).contains("1 passed"), "{}", text(&o));
    assert!(d.join(".kula/plan.json").exists());
}

#[test]
fn slices_are_wired_to_their_agent_and_the_wiring_is_not_committed() {
    let t = repo();
    let d = t.path();
    let p = write_plan(d, &["a"], "claude", "true", 1);
    // "claude" here runs the fake agent; the slice still gets Claude Code's wiring.
    let mut v: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
    v["agents"] = json!({"claude": [fake(), "{prompt}"]});
    std::fs::write(&p, v.to_string()).unwrap();
    let probe = d.join("probe");
    let (o, plan) = run(d, &[("FAKE_PROBE", probe.to_str().unwrap())]);
    assert_eq!(plan["slices"][0]["state"], "passed", "{}", text(&o));
    let hooks = std::fs::read_to_string(probe.join("hooks-a.json")).expect("no hooks in the worktree");
    assert!(hooks.contains("kula guard hook"), "{hooks}");
    let files = git(d, &["show", "--name-only", "--format=", "kula/t/a"]);
    assert!(files.contains("a/fake_1.txt") && !files.contains(".claude") && !files.contains(".mcp.json"), "{files}");
}

#[test]
fn a_slice_cannot_land_changes_in_another_slices_files() {
    let t = repo();
    let d = t.path();
    write_plan(d, &["a", "b"], "fake-agent", "true", 2);
    let (o, plan) = run(d, &[("FAKE_INTRUDER", "b"), ("FAKE_INTO", "a"), ("FAKE_SLEEP", "1")]);
    let st = |i: usize| plan["slices"][i]["state"].as_str().unwrap_or_default().to_string();
    assert_eq!(st(0), "passed", "{}", text(&o));
    assert_eq!(st(1), "rejected", "{plan}");
    assert!(plan["slices"][1]["reasons"].to_string().contains("a/intruder.txt"), "{plan}");
    // Nothing of b's reached a's branch or the base.
    let a_files = git(d, &["show", "--name-only", "--format=", "kula/t/a"]);
    assert!(!a_files.contains("intruder"), "{a_files}");
    assert!(!d.join("a/intruder.txt").exists());
}

fn train(d: &Path) -> (Output, Value) {
    let o = Command::new(KULA).arg("-C").arg(d).args(["--json", "merge-train"]).env("KULA_NO_AGENT", "1").output().unwrap();
    let v = serde_json::from_slice(&o.stdout).unwrap_or(Value::Null);
    (o, v)
}

#[test]
fn merge_train_integrates_passing_slices_and_leaves_main_alone() {
    let t = repo();
    let d = t.path();
    write_plan(d, &["a", "b"], "fake-agent", "true", 2);
    let (o, _) = run(d, &[]);
    assert_eq!(o.status.code(), Some(0), "{}", text(&o));
    let main = git(d, &["rev-parse", "main"]);
    let (o, v) = train(d);
    assert_eq!(o.status.code(), Some(0), "{}", text(&o));
    assert_eq!(v["verdict"], "pass", "{v}");
    assert_eq!(v["merged"], json!(["a", "b"]));
    let files = git(d, &["ls-tree", "-r", "--name-only", "kula/t/integration"]);
    assert!(files.contains("a/fake_1.txt") && files.contains("b/fake_1.txt"), "{files}");
    assert_eq!(git(d, &["rev-parse", "main"]), main, "main must not move");
    assert!(!d.join(".kula/worktrees/t/_integration").exists());
}

#[test]
fn merge_conflict_becomes_a_new_slice_on_the_integration_branch() {
    let t = repo();
    let d = t.path();
    let path = write_plan(d, &["a", "b"], "fake-agent", "true", 2);
    // Both slices own a/, so both write a/fake_1.txt with different text.
    let mut p: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    p["slices"][1]["scope"] = json!(["a"]);
    std::fs::write(&path, serde_json::to_string(&p).unwrap()).unwrap();
    let (o, _) = run(d, &[]);
    assert_eq!(o.status.code(), Some(0), "{}", text(&o));
    let (o, v) = train(d);
    assert_eq!(o.status.code(), Some(1), "{}", text(&o));
    assert_eq!(v["merged"], json!(["a"]), "{v}");
    assert_eq!(v["conflicts"][0][0], "b");
    assert_eq!(v["conflicts"][0][1], json!(["a/fake_1.txt"]));
    let p: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let redo = p["slices"].as_array().unwrap().iter().find(|s| s["id"] == "b-merge").expect("b-merge slice");
    assert_eq!(redo["state"], "queued");
    assert_eq!(redo["base_ref"], "kula/t/integration");
}

#[test]
fn merge_train_gates_the_integrated_tree() {
    let t = repo();
    let d = t.path();
    // Each slice alone passes; together they fail the tests.
    write_plan(d, &["a", "b"], "fake-agent", "test ! -f a/fake_1.txt -o ! -f b/fake_1.txt", 2);
    let (o, _) = run(d, &[]);
    assert_eq!(o.status.code(), Some(0), "{}", text(&o));
    let (o, v) = train(d);
    assert_eq!(o.status.code(), Some(1), "{}", text(&o));
    assert_eq!(v["merged"], json!(["a", "b"]), "{v}");
    assert_ne!(v["verdict"], "pass", "{v}");
}

#[test]
fn a_redone_conflict_slice_runs_on_the_integration_branch_and_merges() {
    let t = repo();
    let d = t.path();
    let path = write_plan(d, &["a", "b"], "fake-agent", "true", 2);
    let mut p: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    p["slices"][1]["scope"] = json!(["a"]);
    std::fs::write(&path, serde_json::to_string(&p).unwrap()).unwrap();
    run(d, &[]);
    let (o, _) = train(d);
    assert_eq!(o.status.code(), Some(1), "{}", text(&o));
    let (o, p) = run(d, &[]);
    assert_eq!(o.status.code(), Some(0), "{}", text(&o));
    assert_eq!(p["slices"][2]["id"], "b-merge");
    assert_eq!(p["slices"][2]["state"], "passed", "{p}");
    let (o, v) = train(d);
    assert_eq!(o.status.code(), Some(0), "{}", text(&o));
    assert_eq!(v["merged"], json!(["a", "b-merge"]), "{v}");
    assert_eq!(v["skipped"], json!(["b"]));
    let f = git(d, &["show", "kula/t/integration:a/fake_1.txt"]);
    assert!(f.contains("b-merge"), "{f}");
}
