//! K2.4: `kula brief` — one page, under 1500 tokens, and the AGENTS.md sync
//! hook includes it. Same fixture style as tests/map.rs.

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

fn kula(dir: &Path, args: &[&str]) -> (String, String, i32) {
    let out = Command::new(KULA).arg("-C").arg(dir).args(args).output().unwrap();
    (String::from_utf8_lossy(&out.stdout).into_owned(), String::from_utf8_lossy(&out.stderr).into_owned(), out.status.code().unwrap_or(-1))
}

fn index(dir: &Path) {
    let (o, e, c) = kula(dir, &["index", "--quiet"]);
    assert_eq!(c, 0, "index failed:\n{o}{e}");
}

fn fixture() -> tempfile::TempDir {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git(d, &["init", "-q", "-b", "main"]);
    git(d, &["config", "user.name", "Tester"]);
    git(d, &["config", "user.email", "t@example.com"]);
    git(d, &["config", "commit.gpgsign", "false"]);
    write(d, "core/Cargo.toml", "[package]\nname = \"core\"\nversion = \"0.1.0\"\nedition = \"2021\"\n");
    write(d, "core/src/lib.rs", "pub mod net;\npub fn run(input: &str) -> String { net::a::pong(input) }\n");
    write(d, "core/src/net/mod.rs", "pub mod a;\npub mod b;\n");
    write(d, "core/src/net/a.rs", "use crate::net::b::ping;\npub fn pong(s: &str) -> String { format!(\"{s}{}\", ping(s)) }\n");
    write(d, "core/src/net/b.rs", "use crate::net::a::pong;\npub fn ping(s: &str) -> String { s.to_string() }\n");
    write(d, "core/src/main.rs", "fn main() { println!(\"{}\", core::run(\"hi\")); }\n");
    write(d, "webui/package.json", "{\n  \"name\": \"webui\",\n  \"version\": \"0.1.0\"\n}\n");
    write(d, "webui/src/index.ts", "export function renderApp(target: string) { return target; }\n");
    write(
        d,
        "webui/src/api/routes.ts",
        "import { renderApp } from \"../index\";\nexport function handleLogin(req: string) { return renderApp(req); }\n",
    );
    write(d, "README.md", "# fixture\n");
    git(d, &["add", "-A"]);
    git(d, &["commit", "-qm", "initial"]);
    t
}

#[test]
fn brief_is_one_page_and_mentions_the_map() {
    let t = fixture();
    let d = t.path();
    index(d);

    // Markdown: under 1500 tokens (4 chars each), names both packages, is
    // deterministic, and points deeper tools at the reader.
    let (o1, e, c) = kula(d, &["brief"]);
    assert_eq!(c, 0, "{o1}{e}");
    assert!(o1.len() <= kula::map::brief::MAX_TOKENS * kula::map::brief::CHARS_PER_TOKEN, "{} chars", o1.len());
    assert!(o1.contains("core") && o1.contains("webui"), "{o1}");
    assert!(o1.contains("Entry points:") && o1.contains("main"), "{o1}");
    assert!(o1.contains("kula map"), "{o1}");
    let (o2, _, _) = kula(d, &["brief"]);
    assert_eq!(o1, o2, "brief is deterministic");

    // JSON: schema 1 at the top.
    let (o, e, c) = kula(d, &["brief", "--format", "json"]);
    assert_eq!(c, 0, "{o}{e}");
    let v: serde_json::Value = serde_json::from_str(&o).unwrap();
    assert_eq!(v["schema"], 1);
    assert!(v["packages"].as_array().unwrap().len() >= 2, "{v}");
}

#[test]
fn agents_sync_includes_the_brief() {
    let t = fixture();
    let d = t.path();
    index(d);
    write(d, "AGENTS.md", "# House rules\n\nUse tabs.\n");
    let (o, e, c) = kula(d, &["agents", "sync"]);
    assert_eq!(c, 0, "{o}{e}");
    let md = std::fs::read_to_string(d.join("AGENTS.md")).unwrap();
    assert!(md.starts_with("# House rules"), "keeps what was there: {md}");
    assert!(md.contains("kula:begin") && md.contains("kula:end"), "{md}");
    assert!(md.contains("## Brief:") && md.contains("Entry points:"), "semantic brief inside the block: {md}");
}
