//! K4: `kula plan` and `kula gate` on a fixture repo.

use std::path::Path;
use std::process::{Command, Output};
use tempfile::TempDir;

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

fn kula(dir: &Path, args: &[&str]) -> Output {
    Command::new(KULA).arg("-C").arg(dir).args(args).env("KULA_NO_AGENT", "1").output().unwrap()
}

fn text(o: &Output) -> String {
    format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr))
}

/// net depends on codec; no cycle.
fn fixture() -> TempDir {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git(d, &["init", "-q", "-b", "main"]);
    git(d, &["config", "user.name", "Tester"]);
    git(d, &["config", "user.email", "t@example.com"]);
    git(d, &["config", "commit.gpgsign", "false"]);
    write(d, "core/Cargo.toml", "[package]\nname = \"core\"\nversion = \"0.1.0\"\nedition = \"2021\"\n");
    write(d, "core/src/lib.rs", "pub mod codec;\npub mod net;\npub fn run(input: &str) -> String { net::a::pong(input) }\n");
    write(d, "core/src/net/mod.rs", "pub mod a;\n");
    write(d, "core/src/net/a.rs", "use crate::codec::b::ping;\npub fn pong(s: &str) -> String { format!(\"{s}{}\", ping(s)) }\n");
    write(d, "core/src/codec/mod.rs", "pub mod b;\n");
    write(d, "core/src/codec/b.rs", "pub fn ping(s: &str) -> String { s.to_string() }\n");
    write(d, "README.md", "# fixture\n");
    git(d, &["add", "-A"]);
    git(d, &["commit", "-qm", "initial"]);
    let o = kula(d, &["index", "--quiet"]);
    assert!(o.status.success(), "index: {}", text(&o));
    t
}

fn plan(d: &Path, goal: &str) -> serde_json::Value {
    let o = kula(d, &["plan", goal, "-a", "fake-agent", "--test-cmd", "true"]);
    assert!(o.status.success(), "plan: {}", text(&o));
    serde_json::from_str(&std::fs::read_to_string(d.join(".kula/plan.json")).unwrap()).unwrap()
}

fn slice_id<'a>(p: &'a serde_json::Value, part: &str) -> &'a str {
    p["slices"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_str().unwrap())
        .find(|i| i.contains(part))
        .unwrap_or_else(|| panic!("no {part} slice: {p}"))
}

#[test]
fn plan_slices_by_module_with_deps() {
    let t = fixture();
    let p = plan(t.path(), "ping pong");
    assert_eq!(p["schema"], 1);
    let slices = p["slices"].as_array().unwrap();
    assert_eq!(slices.len(), 2, "{p}");
    let (net, codec) = (slice_id(&p, "net"), slice_id(&p, "codec"));
    // Dependencies first.
    assert_eq!(slices[0]["id"], codec, "{p}");
    let n = slices.iter().find(|s| s["id"] == net).unwrap();
    assert_eq!(n["deps"], serde_json::json!([codec]), "{p}");
    assert!(n["scope"].as_array().unwrap().iter().any(|s| s.as_str().unwrap().ends_with("src/net")), "{p}");
    // Same index, same goal, same plan.
    let again = plan(t.path(), "ping pong");
    assert_eq!(p, again);
}

#[test]
fn gate_rejects_fixes_and_passes() {
    let t = fixture();
    let d = t.path();
    let p = plan(d, "ping pong");
    let codec = slice_id(&p, "codec").to_string();

    // Clean change inside the scope passes.
    write(d, "core/src/codec/extra.txt", "x\n");
    let o = kula(d, &["gate", &codec]);
    assert_eq!(o.status.code(), Some(0), "clean: {}", text(&o));

    // A new module cycle goes back to be fixed.
    write(d, "core/src/codec/b.rs", "use crate::net::a::pong;\npub fn ping(s: &str) -> String { s.to_string() }\n");
    let o = kula(d, &["gate", &codec]);
    assert_eq!(o.status.code(), Some(1), "cycle: {}", text(&o));
    assert!(text(&o).contains("cycle"), "{}", text(&o));

    // A change outside the scope is rejected.
    git(d, &["checkout", "-q", "--", "core/src/codec/b.rs"]);
    write(d, "README.md", "# fixture\nmore\n");
    let o = kula(d, &["gate", &codec, "--json"]);
    assert_eq!(o.status.code(), Some(2), "outside: {}", text(&o));
    assert!(text(&o).contains("README.md"), "{}", text(&o));
}

#[test]
fn plan_records_blast_radius_and_gate_notes_reach_past_it() {
    let t = fixture();
    let d = t.path();
    let mut p = plan(d, "ping pong");
    let codec = slice_id(&p, "codec").to_string();
    let c = p["slices"].as_array().unwrap().iter().find(|s| s["id"] == codec.as_str()).unwrap();
    let blast: Vec<&str> = c["blast"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
    assert!(blast.contains(&"core/src/net/a.rs"), "codec's callers: {blast:?}");

    // A change inside the planned radius: no note.
    write(d, "core/src/codec/b.rs", "pub fn ping(s: &str) -> String { s.to_uppercase() }\n");
    let o = kula(d, &["gate", &codec]);
    assert_eq!(o.status.code(), Some(0), "{}", text(&o));
    assert!(!text(&o).contains("blast radius"), "{}", text(&o));

    // The same change against a plan that expected no one to feel it: a note, still a pass.
    for s in p["slices"].as_array_mut().unwrap() {
        s["blast"] = serde_json::json!([]);
    }
    std::fs::write(d.join(".kula/plan.json"), serde_json::to_string(&p).unwrap()).unwrap();
    let o = kula(d, &["gate", &codec, "--json"]);
    assert_eq!(o.status.code(), Some(0), "{}", text(&o));
    let v: serde_json::Value = serde_json::from_slice(&o.stdout).unwrap();
    let note = v["notes"][0].as_str().unwrap_or_default();
    assert!(note.contains("blast radius") && note.contains("core/src/net/a.rs"), "{v}");
}
