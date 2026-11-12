//! K2.3: `kula explain` — sections for surface, dependencies, dependents;
//! unknown target exits non-zero with a hint.

use std::path::Path;
use std::process::Command;

const KULA: &str = env!("CARGO_BIN_EXE_kula");

fn write(dir: &Path, rel: &str, body: &str) {
    let p = dir.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// A small repo: core/src/net with a ping/pong module and a main.
fn fixture() -> tempfile::TempDir {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    let git = |args: &[&str]| {
        let ok = Command::new("git").arg("-C").arg(d).args(args).output().unwrap();
        assert!(ok.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&ok.stderr));
    };
    git(&["init", "-q", "-b", "main"]);
    git(&["config", "user.name", "Tester"]);
    git(&["config", "user.email", "t@example.com"]);
    git(&["config", "commit.gpgsign", "false"]);
    write(
        d,
        "core/src/net/mod.rs",
        "pub mod a;\npub mod b;\n",
    );
    write(
        d,
        "core/src/net/a.rs",
        "use crate::net::b::ping;\npub fn pong(s: &str) -> String {\n    let t = ping(s);\n    format!(\"{s}{t}\")\n}\n",
    );
    write(d, "core/src/net/b.rs", "pub fn ping(s: &str) -> String { s.to_string() }\n");
    write(d, "core/src/lib.rs", "pub mod net;\npub fn run(input: &str) -> String { net::a::pong(input) }\n");
    write(d, "core/src/main.rs", "fn main() { println!(\"{}\", core::run(\"hi\")); }\n");
    write(d, "core/Cargo.toml", "[package]\nname = \"core\"\nversion = \"0.1.0\"\nedition = \"2021\"\n");
    git(&["add", "-A"]);
    git(&["commit", "-qm", "initial"]);
    t
}

fn index(dir: &Path) {
    let out = Command::new(KULA).arg("-C").arg(dir).args(["index", "--quiet"]).output().unwrap();
    assert!(
        out.status.success(),
        "index failed:\n{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
}

fn kula(dir: &Path, args: &[&str]) -> std::process::Output {
    Command::new(KULA).arg("-C").arg(dir).args(args).output().unwrap()
}

#[test]
fn explain_module_prints_sections() {
    let t = fixture();
    let d = t.path();
    index(d);
    let out = kula(d, &["explain", "net"]);
    assert!(
        out.status.success(),
        "explain net failed:\n{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    for want in ["Surface", "Depends on", "Used by"] {
        assert!(text.contains(want), "missing section {want} in:\n{text}");
    }
    // The purpose line names the cluster and the module.
    assert!(text.contains("net"), "purpose line should name the target:\n{text}");
    // Surface lists the module's public symbols.
    assert!(text.contains("pong") || text.contains("ping"), "surface should list symbols:\n{text}");
}

#[test]
fn explain_symbol_prints_sections() {
    let t = fixture();
    let d = t.path();
    index(d);
    let out = kula(d, &["explain", "pong"]);
    assert!(
        out.status.success(),
        "explain pong failed:\n{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    for want in ["Surface", "Depends on", "Used by"] {
        assert!(text.contains(want), "missing section {want} in:\n{text}");
    }
    // pong calls ping, and is used by run.
    assert!(text.contains("ping"), "depends on should include ping:\n{text}");
    assert!(text.contains("run"), "used by should include run:\n{text}");
}

#[test]
fn explain_json_has_schema() {
    let t = fixture();
    let d = t.path();
    index(d);
    let out = kula(d, &["--json", "explain", "pong"]);
    assert!(out.status.success());
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    assert!(text.contains("\"schema\""), "json explain should carry schema:\n{text}");
}

#[test]
fn explain_unknown_target_fails_with_hint() {
    let t = fixture();
    let d = t.path();
    index(d);
    let out = kula(d, &["explain", "definitely_not_here"]);
    assert!(!out.status.success(), "unknown target must exit non-zero");
    let err = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    assert!(err.contains("definitely_not_here") && err.contains("kula query"), "should hint at next steps:\n{err}");
}
