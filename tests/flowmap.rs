//! H.1: the execution flow map. A small Rust repo whose `main` calls helpers
//! in a set order, some inside an `if` and a loop; the map must list them in
//! call order with the right branch flags, and group the flow into a domain.

use serde_json::Value;
use std::path::Path;
use std::process::Command;

const KULA: &str = env!("CARGO_BIN_EXE_kula");

fn write(dir: &Path, rel: &str, body: &str) {
    let p = dir.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn git(dir: &Path, args: &[&str]) {
    let ok = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
    assert!(ok.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&ok.stderr));
}

#[test]
fn main_flow_is_ordered_with_branches() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git(d, &["init", "-q", "-b", "main"]);
    git(d, &["config", "user.name", "Tester"]);
    git(d, &["config", "user.email", "t@example.com"]);
    git(d, &["config", "commit.gpgsign", "false"]);
    write(
        d,
        "src/main.rs",
        "mod work;\nuse work::*;\n\nfn main() {\n    let cfg = zeta_load();\n    if cfg > 1 {\n        alpha_save(cfg);\n    }\n    for i in 0..cfg {\n        mid_step(i);\n    }\n    beta_finish();\n}\n",
    );
    write(
        d,
        "src/work.rs",
        "pub fn zeta_load() -> u8 {\n    parse_it()\n}\n\npub fn parse_it() -> u8 {\n    3\n}\n\npub fn alpha_save(x: u8) {\n    let _ = x;\n}\n\npub fn mid_step(i: u8) {\n    let _ = i;\n}\n\npub fn beta_finish() {}\n",
    );
    git(d, &["add", "."]);
    git(d, &["commit", "-q", "-m", "init"]);
    let out = Command::new(KULA).arg("-C").arg(d).args(["index", "--quiet"]).output().unwrap();
    assert!(out.status.success(), "index: {}", String::from_utf8_lossy(&out.stderr));

    let out = Command::new(KULA).arg("-C").arg(d).args(["--json", "flows", "--ordered", "--limit", "20"]).output().unwrap();
    assert!(out.status.success(), "flows: {}", String::from_utf8_lossy(&out.stderr));
    let map: Value = serde_json::from_slice(&out.stdout).unwrap();
    let f = map["flows"].as_array().unwrap().iter().find(|f| f["kind"] == "main").expect("a main flow");
    let steps = f["steps"].as_array().unwrap();
    let names: Vec<&str> = steps.iter().map(|s| s["name"].as_str().unwrap()).collect();
    // Call order, not alphabetical: zeta_load (and its callee) first, beta_finish last.
    assert_eq!(names, ["main", "zeta_load", "parse_it", "alpha_save", "mid_step", "beta_finish"], "{names:?}");
    let by = |n: &str| steps.iter().find(|s| s["name"] == n).unwrap();
    assert!(by("zeta_load").get("branch").is_none());
    assert_eq!(by("alpha_save")["branch"], "if");
    assert_eq!(by("mid_step")["branch"], "loop");
    assert_eq!(by("parse_it")["depth"], 2);
    assert_eq!(by("zeta_load")["site"], 5);
    assert!(f["files"].as_array().unwrap().iter().any(|p| p == "src/work.rs"));
    assert!(map["domains"].as_array().unwrap().iter().any(|dm| dm["id"] == f["domain"] && dm["flows"].as_u64().unwrap() >= 1));
}
