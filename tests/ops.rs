//! B2: the swarm op log around a real 3-seat run with the fake agent – the
//! launch op records the view of every seat, each kept slice appends a commit
//! op, and the log stays unique and ordered. See docs/design/swarm-saves.md.

use std::path::{Path, PathBuf};
use std::process::Command;
use tempfile::TempDir;

const KULA: &str = env!("CARGO_BIN_EXE_kula");

fn git(dir: &Path, args: &[&str]) -> String {
    let o = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
    assert!(o.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&o.stderr));
    String::from_utf8_lossy(&o.stdout).into_owned()
}

/// A repo built from the `tests/fixtures/team3` fixture: three seats a/, b/, c/.
fn repo3() -> TempDir {
    let t = tempfile::tempdir().unwrap();
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/team3");
    for entry in ["a", "b", "c", "README.md"] {
        let from = src.join(entry);
        let to = t.path().join(entry);
        if from.is_dir() {
            std::fs::create_dir_all(&to).unwrap();
            for f in std::fs::read_dir(&from).unwrap() {
                let f = f.unwrap();
                std::fs::copy(f.path(), to.join(f.file_name())).unwrap();
            }
        } else {
            std::fs::copy(&from, &to).unwrap();
        }
    }
    git(t.path(), &["init", "-q", "-b", "main"]);
    git(t.path(), &["config", "user.name", "Tester"]);
    git(t.path(), &["config", "user.email", "t@example.com"]);
    git(t.path(), &["config", "commit.gpgsign", "false"]);
    git(t.path(), &["add", "-A"]);
    git(t.path(), &["commit", "-qm", "initial"]);
    t
}

fn write_plan(d: &Path, seats: &[&str], agent: &str, test_cmd: &str) -> PathBuf {
    let base = git(d, &["rev-parse", "HEAD"]).trim().to_string();
    let slices: Vec<serde_json::Value> = seats
        .iter()
        .map(|s| serde_json::json!({"id": *s, "module": *s, "scope": [*s], "agent": agent, "base_ref": base, "seat": format!("team/{s}")}))
        .collect();
    let plan = serde_json::json!({
        "schema": 1, "id": "t3", "goal": "test", "risk": "low", "base_ref": base,
        "max_parallel": 3, "max_retries": 2, "test_cmd": test_cmd,
        "agents": {"fake-agent": [Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-agent.sh").to_string_lossy(), "{prompt}"]},
        "slices": slices,
    });
    let p = d.join(".kula/plan.json");
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(&p, serde_json::to_string_pretty(&plan).unwrap()).unwrap();
    p
}

fn ops_log(d: &Path) -> serde_json::Value {
    // The op log is plain git: read it the same way the routes do.
    let head = git(d, &["rev-parse", "--verify", "--quiet", "refs/kula/ops"]);
    let log = git(d, &["log", "--format=%H%x1f%at", "--topo-order", "refs/kula/ops"]);
    let mut ids = vec![];
    for line in log.lines().filter(|l| !l.trim().is_empty()) {
        let id = line.split('\x1f').next().unwrap().to_string();
        let kind = git(d, &["show", &format!("{id}:op.json")]);
        let v: serde_json::Value = serde_json::from_str(&kind).unwrap();
        ids.push(serde_json::json!({"id": id, "kind": v["kind"], "seat": v["seat"], "view": v["view"]}));
    }
    serde_json::json!({ "head": head.trim(), "ops": ids })
}

#[test]
fn three_seat_run_records_a_chained_view_log() {
    let t = repo3();
    let d = t.path();
    write_plan(d, &["a", "b", "c"], "fake-agent", "true");
    let o = Command::new(KULA).arg("-C").arg(d).args(["run-plan"]).env("KULA_NO_AGENT", "1").output().unwrap();
    let out = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
    assert_eq!(o.status.code(), Some(0), "{out}");

    let log = ops_log(d);
    let ops = log["ops"].as_array().unwrap();
    assert_eq!(ops.last().unwrap()["kind"], "launch", "the first op is the launch: {ops:?}");
    let launch_view = &ops.last().unwrap()["view"];
    for seat in ["team/a", "team/b", "team/c"] {
        let sha = launch_view[seat].as_str().unwrap_or("");
        assert_eq!(sha.len(), 40, "the launch view names every seat's base: {launch_view}");
    }
    // Each passing slice appended a commit op naming its seat.
    let commit_seats: Vec<&str> = ops
        .iter()
        .filter(|o| o["kind"] == "commit")
        .map(|o| o["seat"].as_str().unwrap_or(""))
        .collect();
    for s in ["team/a", "team/b", "team/c"] {
        assert!(commit_seats.contains(&s), "seat {s} never committed: {commit_seats:?}");
    }
    // Unique and ordered: each op's parent is the next one in the log.
    let ids: Vec<&str> = ops.iter().map(|o| o["id"].as_str().unwrap()).collect();
    assert_eq!(ids.len(), std::collections::HashSet::<&str>::from_iter(ids.iter().copied()).len(), "op ids unique");
    for w in ops.windows(2) {
        let parent = git(d, &["show", &format!("{}:op.json", w[0]["id"].as_str().unwrap())]);
        let v: serde_json::Value = serde_json::from_str(&parent).unwrap();
        assert_eq!(v["parent"], w[1]["id"], "each op chains to the previous");
    }
}
