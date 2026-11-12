//! K2: semantic map — module tree, cluster names, entry points.
//! Builds a fixture repo with two packages and a seeded A→B→A module cycle,
//! indexes it with the real binary, then drives the lib functions.

use kula::git::Repo;
use kula::map::{clusters, entries, names, tree};
use kula::store::Store;
use std::collections::BTreeSet;
use std::path::Path;
use std::process::Command;
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

fn index(dir: &Path) {
    let out = Command::new(KULA).arg("-C").arg(dir).args(["index", "--quiet"]).output().unwrap();
    assert!(
        out.status.success(),
        "index failed:\n{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
}

/// Two packages (core: Rust, webui: TypeScript) plus a top-level Python tool,
/// and a seeded module cycle net/a → net/b → net/a inside core.
fn fixture() -> TempDir {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git(d, &["init", "-q", "-b", "main"]);
    git(d, &["config", "user.name", "Tester"]);
    git(d, &["config", "user.email", "t@example.com"]);
    git(d, &["config", "commit.gpgsign", "false"]);
    write(d, "core/Cargo.toml", "[package]\nname = \"core\"\nversion = \"0.1.0\"\nedition = \"2021\"\n");
    write(d, "core/src/lib.rs", "pub mod net;\npub fn run(input: &str) -> String { net::a::pong(input) }\n");
    write(d, "core/src/net/mod.rs", "pub mod a;\npub mod b;\n");
    write(
        d,
        "core/src/net/a.rs",
        "use crate::net::b::ping;\npub fn pong(s: &str) -> String { format!(\"{s}{}\", ping(s)) }\n",
    );
    write(d, "core/src/net/b.rs", "use crate::net::a::pong;\npub fn ping(s: &str) -> String { s.to_string() }\n");
    write(d, "core/src/main.rs", "fn main() { println!(\"{}\", core::run(\"hi\")); }\n");
    write(d, "webui/package.json", "{\n  \"name\": \"webui\",\n  \"version\": \"0.1.0\"\n}\n");
    write(d, "webui/src/index.ts", "export function renderApp(target: string) { return target; }\n");
    write(
        d,
        "webui/src/api/routes.ts",
        "import { renderApp } from \"../index\";\nexport function handleLogin(req: string) { return renderApp(req); }\n",
    );
    write(d, "scripts/tool.py", "def main():\n    pass\n\n@app.route(\"/health\")\ndef health():\n    return \"ok\"\n\nif __name__ == \"__main__\":\n    main()\n");
    write(d, "README.md", "# fixture\n");
    git(d, &["add", "-A"]);
    git(d, &["commit", "-qm", "initial"]);
    t
}

#[test]
fn map_tree_names_entries() {
    let t = fixture();
    let d = t.path();
    index(d);
    let repo = Repo::discover(d).unwrap();
    let st = Store::open(&repo).unwrap();

    // Tree: both packages, with modules and symbols beneath them.
    let mt = tree::module_tree(d, &st);
    let pkgs: Vec<&str> = mt.packages.iter().map(|p| p.name.as_str()).collect();
    assert!(pkgs.contains(&"core"), "packages: {pkgs:?}");
    assert!(pkgs.contains(&"webui"), "packages: {pkgs:?}");
    let core = mt.packages.iter().find(|p| p.name == "core").unwrap();
    assert!(core.children.iter().any(|m| m.kind == "module" && m.name == "net"), "core children: {:?}", core.children);
    let net = core.children.iter().find(|m| m.name == "net").unwrap();
    assert!(net.symbols.contains(&"pong".to_string()), "net symbols: {:?}", net.symbols);
    for p in &mt.packages {
        for m in &p.children {
            assert!(matches!(m.kind.as_str(), "module" | "symbol"));
            assert!(m.loc > 0, "{}:{} has no loc", p.name, m.name);
        }
    }

    // Entries: CLI main, an HTTP handler by name and one by decorator, API export.
    let es = entries::entry_points(d, &st);
    assert!(
        es.iter().any(|e| e.kind == "cli" && e.symbol == "main" && e.file == "core/src/main.rs"),
        "entries: {es:?}"
    );
    assert!(es.iter().any(|e| e.kind == "http" && e.symbol == "handleLogin"), "entries: {es:?}");
    assert!(es.iter().any(|e| e.kind == "http" && e.symbol == "health"), "entries: {es:?}");
    assert!(es.iter().any(|e| e.kind == "api" && e.symbol == "renderApp"), "entries: {es:?}");

    // Cluster names: one per cluster, unique, stable across three re-indexes.
    let n1 = names::name_clusters(&clusters(&st));
    assert_eq!(n1.len(), clusters(&st).len());
    let uniq: BTreeSet<&String> = n1.iter().collect();
    assert_eq!(uniq.len(), n1.len(), "names not unique: {n1:?}");
    index(d);
    index(d);
    let n3 = names::name_clusters(&clusters(&Store::open(&repo).unwrap()));
    assert_eq!(n1, n3, "names not stable across re-indexes: {n1:?} vs {n3:?}");
}

/// `kula check architecture` exits non-zero on the seeded a→b→a cycle and zero
/// on a clean copy of the same repo.
#[test]
fn check_architecture_cycle() {
    // Seeded cycle: the lib report has the cycle, and the CLI exits non-zero.
    let t = fixture();
    let d = t.path();
    index(d);
    let repo = Repo::discover(d).unwrap();
    let st = Store::open(&repo).unwrap();
    let r = kula::map::arch::check(&st);
    assert!(!r.cycles.is_empty(), "expected a cycle, got {r:?}");
    assert!(r.cycles.iter().any(|c| c.len() > 1 && c.iter().any(|m| m.contains("net"))), "cycles: {:?}", r.cycles);
    let out = Command::new(KULA).arg("-C").arg(d).args(["check", "architecture"]).output().unwrap();
    assert!(!out.status.success(), "cycle fixture must exit non-zero: {}", String::from_utf8_lossy(&out.stdout));

    // Clean copy: same repo without the a→b→a imports exits zero.
    let c = fixture();
    let cd = c.path();
    std::fs::write(
        cd.join("core/src/net/a.rs"),
        "pub fn pong(s: &str) -> String { format!(\"{s}\") }\n",
    )
    .unwrap();
    std::fs::write(cd.join("core/src/net/b.rs"), "pub fn ping(s: &str) -> String { s.to_string() }\n").unwrap();
    git(cd, &["add", "-A"]);
    git(cd, &["commit", "-qm", "break cycle"]);
    index(cd);
    let out = Command::new(KULA).arg("-C").arg(cd).args(["check", "architecture"]).output().unwrap();
    assert!(
        out.status.success(),
        "clean copy must exit zero:\n{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
}

/// `kula map` renders all three formats and honours zoom; mermaid starts with
/// `flowchart` and json carries `"schema": 1` at the top.
#[test]
fn map_formats_and_zooms() {
    let t = fixture();
    let d = t.path();
    index(d);

    let md = Command::new(KULA).arg("-C").arg(d).args(["map", "--zoom", "module", "--format", "md"]).output().unwrap();
    assert!(md.status.success(), "{}", String::from_utf8_lossy(&md.stderr));
    let text = String::from_utf8_lossy(&md.stdout).to_string();
    assert!(text.contains("core"), "md map should list packages:\n{text}");
    assert!(text.contains("webui"), "md map should list webui:\n{text}");
    assert!(text.contains("net"), "md map should list modules:\n{text}");

    // Zoom levels narrow the output.
    let repo = Command::new(KULA).arg("-C").arg(d).args(["map", "--zoom", "repo"]).output().unwrap();
    let repo_text = String::from_utf8_lossy(&repo.stdout).to_string();
    assert!(repo_text.contains("core") && !repo_text.contains("pong"), "repo zoom shows packages only:\n{repo_text}");

    let js = Command::new(KULA).arg("-C").arg(d).args(["map", "--format", "json"]).output().unwrap();
    assert!(js.status.success());
    let js_text = String::from_utf8_lossy(&js.stdout).to_string();
    assert!(js_text.contains("\"schema\""), "json map needs schema at the top:\n{js_text}");

    let mm = Command::new(KULA).arg("-C").arg(d).args(["map", "--format", "mermaid"]).output().unwrap();
    assert!(mm.status.success());
    let mm_text = String::from_utf8_lossy(&mm.stdout).to_string();
    assert!(mm_text.starts_with("flowchart"), "mermaid must start with flowchart:\n{mm_text}");
}

