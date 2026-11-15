//! H.3: hook-time verdicts are exact to the symbol, `guard explain` names the
//! deciding rule, and `kula check` reports bad levels, bare names and seats
//! whose scopes overlap.

use serde_json::Value;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

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

fn kula(dir: &Path, args: &[&str], stdin: Option<&str>) -> (i32, String, String) {
    let mut c = Command::new(KULA);
    c.arg("-C").arg(dir).args(args).env("NO_COLOR", "1").env("KULA_NO_AGENT", "1");
    for k in ["CLAUDECODE", "CURSOR_AGENT", "CODEX_SANDBOX", "GEMINI_CLI", "KULA_AGENT"] {
        c.env_remove(k);
    }
    let mut ch = c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    if let Some(s) = stdin {
        ch.stdin.take().unwrap().write_all(s.as_bytes()).unwrap();
    }
    let o = ch.wait_with_output().unwrap();
    (o.status.code().unwrap_or(-1), String::from_utf8_lossy(&o.stdout).into(), String::from_utf8_lossy(&o.stderr).into())
}

const PAY: &str = "pub fn charge(x: u32) -> u32 {\n    x * 2\n}\n\npub fn helper() -> u32 {\n    1\n}\n";

fn repo(toml: &str) -> tempfile::TempDir {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git(d, &["init", "-q", "-b", "main"]);
    git(d, &["config", "user.name", "Tester"]);
    git(d, &["config", "user.email", "t@example.com"]);
    git(d, &["config", "commit.gpgsign", "false"]);
    write(d, "src/pay.rs", PAY);
    write(d, "src/lib.rs", "mod pay;\nmod shop;\n");
    write(d, "src/shop.rs", "pub fn helper() -> u32 {\n    2\n}\n");
    write(d, "docs/a.md", "# a\n");
    write(d, "kula.toml", toml);
    git(d, &["add", "."]);
    git(d, &["commit", "-q", "-m", "init"]);
    let (c, _, e) = kula(d, &["index", "--quiet"], None);
    assert_eq!(c, 0, "index: {e}");
    t
}

fn edit(old: &str, new: &str) -> String {
    serde_json::json!({ "tool_name": "Edit", "tool_input": { "file_path": "src/pay.rs", "old_string": old, "new_string": new } })
        .to_string()
}

#[test]
fn hook_refuses_only_edits_inside_a_locked_symbol() {
    let t = repo("[[guard]]\nsymbols = [\"src/pay.rs:charge\"]\nlevel = \"locked\"\n");
    let d = t.path();
    let (c, _, e) = kula(d, &["guard", "hook"], Some(&edit("    1\n", "    5\n")));
    assert_eq!(c, 0, "editing helper beside a locked symbol is allowed: {e}");
    let (c, out, e) = kula(d, &["guard", "hook"], Some(&edit("x * 2", "x * 3")));
    assert_eq!(c, 2, "editing charge is refused: {out}{e}");
    assert!(format!("{out}{e}").contains("charge"));
    // comment-swallow through a Write of the whole file
    let w = serde_json::json!({ "tool_name": "Write", "tool_input": { "file_path": "src/pay.rs", "content": format!("/*\n{PAY}*/\n") } })
        .to_string();
    assert_eq!(kula(d, &["guard", "hook"], Some(&w)).0, 2);
}

#[test]
fn explain_names_the_deciding_rule() {
    let t = repo("[[guard]]\npaths = [\"src/**\"]\nlevel = \"review\"\n[[guard]]\nsymbols = [\"src/pay.rs:charge\"]\nlevel = \"locked\"\n");
    let d = t.path();
    let (c, out, e) = kula(d, &["--json", "guard", "explain", "src/pay.rs", "--symbol", "charge"], None);
    assert_eq!(c, 0, "{e}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["verdict"]["level"], "locked");
    assert_eq!(v["hits"].as_array().unwrap().len(), 2, "{v}");
    let (_, out, _) = kula(d, &["guard", "explain", "docs/a.md"], None);
    assert!(out.contains("no rule applies"), "{out}");
}

#[test]
fn check_reports_bad_levels_bare_names_and_overlaps() {
    let t = repo(
        r#"[[guard]]
paths = ["docs/**"]
level = "lockd"

[[guard]]
symbols = ["helper"]
level = "locked"

[[team]]
name = "ship"
members = [
  { name = "Atlas", scope = ["src/**"] },
  { name = "Quill", scope = ["src/pay.rs", "docs/**"] },
  { name = "Free" },
]
"#,
    );
    let d = t.path();
    let (c, out, e) = kula(d, &["--json", "check"], None);
    assert_eq!(c, 2, "an unknown level fails check: {e}");
    let v: Value = serde_json::from_str(&out).unwrap();
    let w: Vec<&str> = v["guard_warnings"].as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect();
    assert!(w.iter().any(|x| x.contains("lockd")), "{w:?}");
    assert!(w.iter().any(|x| x.contains("\"helper\"") && x.contains("src/shop.rs:helper")), "{w:?}");
    let o = v["seat_overlaps"].as_array().unwrap();
    assert_eq!(o.len(), 1, "only the two scoped seats overlap: {o:?}");
    assert_eq!(o[0]["a"], "Atlas");
    assert_eq!(o[0]["b"], "Quill");
    assert!(o[0]["paths"].as_array().unwrap().iter().any(|p| p == "src/pay.rs"));
}
