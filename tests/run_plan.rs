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
