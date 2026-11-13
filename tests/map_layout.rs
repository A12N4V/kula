//! Map layout regressions from the P1.2.10 audit: root manifests, duplicate
//! manifests in one dir, unowned dirs, cluster labels and `explain` on files
//! and parent directories. No agents, no network.

use kula::git::Repo;
use kula::map::{clusters, explain, tree};
use kula::store::Store;
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

/// Commit `files` into a fresh repo and index it.
fn repo(files: &[(&str, &str)]) -> TempDir {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git(d, &["init", "-q", "-b", "main"]);
    git(d, &["config", "user.name", "Tester"]);
    git(d, &["config", "user.email", "t@example.com"]);
    git(d, &["config", "commit.gpgsign", "false"]);
    for (p, b) in files {
        write(d, p, b);
    }
    git(d, &["add", "-A"]);
    git(d, &["commit", "-qm", "initial"]);
    let out = Command::new(KULA).arg("-C").arg(d).args(["index", "--quiet"]).env("KULA_NO_AGENT", "1").output().unwrap();
    assert!(out.status.success(), "index failed: {}", String::from_utf8_lossy(&out.stderr));
    t
}

const CARGO: &str = "[package]\nname = \"root\"\nversion = \"0.1.0\"\nedition = \"2021\"\n";

#[test]
fn root_manifest_keeps_modules_and_one_package_per_dir() {
    let t = repo(&[
        ("Cargo.toml", CARGO),
        ("package.json", "{\"name\": \"root-js\"}\n"),
        ("src/lib.rs", "pub mod a;\npub fn top() { a::x::go(); }\n"),
        ("src/a/mod.rs", "pub mod x;\n"),
        ("src/a/x.rs", "pub fn go() {}\n"),
        ("crates/core/src/lib.rs", "pub fn core_fn() {}\n"),
    ]);
    let d = t.path();
    let st = Store::open(&Repo::discover(d).unwrap()).unwrap();
    let mt = tree::module_tree(d, &st);
    let roots: Vec<_> = mt.packages.iter().filter(|p| p.path == ".").collect();
    assert_eq!(roots.len(), 1, "one package for the root dir: {:?}", mt.packages);
    assert_eq!(roots[0].name, "root", "Cargo.toml wins over package.json");
    let all: Vec<String> = mt.packages.iter().flat_map(|p| p.children.iter().map(|m| m.name.clone())).collect();
    assert!(!all.is_empty(), "root manifest must not empty the map");
    // crates/core has no manifest: it still shows under the root package.
    assert!(all.iter().any(|n| n == "crates/core"), "unowned dir dropped: {all:?}");
    assert!(all.iter().any(|n| n == "a"), "src/a reads a: {all:?}");
}

#[test]
fn unowned_dir_gets_synthetic_root() {
    let t = repo(&[
        ("web/package.json", "{\"name\": \"web\"}\n"),
        ("web/index.ts", "export function view() { return 1; }\n"),
        ("crates/core/src/lib.rs", "pub fn core_fn() {}\n"),
    ]);
    let d = t.path();
    let st = Store::open(&Repo::discover(d).unwrap()).unwrap();
    let mt = tree::module_tree(d, &st);
    let shown: Vec<String> = mt.packages.iter().flat_map(|p| p.children.iter().map(|m| m.name.clone())).collect();
    assert!(shown.iter().any(|n| n == "crates/core"), "crates/core dropped: {shown:?}");
}

#[test]
fn labels_follow_the_majority_file_and_explain_resolves_files_and_dirs() {
    let defs: String = (0..8).map(|i| format!("pub fn d{i}() {{ d{}(); }}\n", (i + 1) % 8)).collect();
    let t = repo(&[
        ("Cargo.toml", CARGO),
        ("src/lib.rs", "pub mod flags;\n"),
        ("src/flags/mod.rs", "pub mod defs;\npub mod alpha;\n"),
        ("src/flags/defs.rs", &defs),
        ("src/flags/alpha.rs", "pub fn alpha() { super::defs::d0(); }\n"),
    ]);
    let d = t.path();
    let repo_ = Repo::discover(d).unwrap();
    let st = Store::open(&repo_).unwrap();
    let cs = clusters(&st);
    let c = cs.iter().find(|c| c.members.iter().any(|m| m.name == "d3")).expect("defs cluster");
    assert!(c.label.contains("defs") || c.label.contains("flags"), "label: {}", c.label);
    assert!(!c.label.contains("alpha"), "minority file named the cluster: {}", c.label);

    let f = explain::explain(&repo_, &st, "src/flags/defs.rs", vec![]).unwrap();
    assert!(!f.purpose.is_empty(), "file explain has a purpose");
    assert!(!f.purpose.starts_with("cluster "), "file falls back to an id: {}", f.purpose);
    let dir = explain::explain(&repo_, &st, "src", vec![]).unwrap();
    assert_eq!(dir.kind, "module");
    assert!(!dir.surface.is_empty(), "parent dir explain has a surface");
}

#[test]
fn entries_from_routes_manifests_build_and_tests() {
    let cargo = format!("{CARGO}\n[[bin]]\nname = \"tool\"\npath = \"src/tool.rs\"\n");
    let t = repo(&[
        ("Cargo.toml", &cargo),
        ("build.rs", "fn main() {}\n"),
        ("src/lib.rs", "pub fn x() {}\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn checks_x() {}\n}\n"),
        ("src/tool.rs", "fn main() {}\n"),
        ("py/pyproject.toml", "[project]\nname = \"p\"\n[project.scripts]\np = \"p.cli:run\"\n"),
        ("py/p/__init__.py", ""),
        ("py/p/cli.py", "def run():\n    pass\n\ndef get_user():\n    return 1\n"),
        ("srv/main.go", "package main\n\nimport \"net/http\"\n\nfunc ping(w http.ResponseWriter, r *http.Request) {}\n\nfunc main() {\n\thttp.HandleFunc(\"/ping\", ping)\n}\n"),
    ]);
    let d = t.path();
    let st = Store::open(&Repo::discover(d).unwrap()).unwrap();
    let es = kula::map::entries::entry_points(&st);
    let has = |s: &str, k: &str, f: &str| es.iter().any(|e| e.symbol == s && e.kind == k && e.file == f);
    assert!(has("main", "build", "build.rs"), "build.rs: {es:?}");
    assert!(!has("main", "cli", "build.rs"), "build.rs is not a cli: {es:?}");
    assert!(has("tool", "cli", "src/tool.rs"), "[[bin]]: {es:?}");
    assert!(has("checks_x", "test", "src/lib.rs"), "#[test]: {es:?}");
    assert!(has("run", "cli", "py/p/cli.py"), "[project.scripts]: {es:?}");
    assert!(!es.iter().any(|e| e.symbol == "get_user"), "get_ prefix alone is not http: {es:?}");
    assert!(has("ping", "http", "srv/main.go"), "Go HandleFunc: {es:?}");
}

/// `use crate::util` must not reach another crate's `tests/util.rs`.
#[test]
fn rust_imports_stay_in_their_crate() {
    let t = repo(&[
        ("Cargo.toml", "[workspace]\nmembers = [\"crates/*\"]\n"),
        ("crates/printer/Cargo.toml", "[package]\nname = \"printer\"\nversion = \"0.1.0\"\n"),
        ("crates/printer/src/lib.rs", "mod stats;\nmod util;\n"),
        ("crates/printer/src/stats.rs", "use crate::util::helper;\npub fn s() { helper(); }\n"),
        ("crates/printer/src/util.rs", "pub fn helper() {}\n"),
        ("crates/matcher/Cargo.toml", "[package]\nname = \"matcher\"\nversion = \"0.1.0\"\n"),
        ("crates/matcher/src/lib.rs", "pub fn m() {}\n"),
        ("crates/matcher/tests/util.rs", "pub fn helper() {}\n"),
        ("crates/matcher/tests/tests.rs", "mod util;\n"),
    ]);
    let st = Store::open(&Repo::discover(t.path()).unwrap()).unwrap();
    let nodes = st.nodes_where("kind = 'file'", []).unwrap();
    let path = |id: i64| nodes.iter().find(|n| n.id == id).map(|n| n.path.clone()).unwrap_or_default();
    let imports: Vec<(String, String)> =
        st.all_edges().unwrap().into_iter().filter(|e| e.kind == "IMPORTS").map(|e| (path(e.src), path(e.dst))).collect();
    assert!(imports.contains(&("crates/printer/src/stats.rs".into(), "crates/printer/src/util.rs".into())), "{imports:?}");
    assert!(
        !imports.iter().any(|(a, b)| a.starts_with("crates/printer") && b.starts_with("crates/matcher")),
        "cross-crate import: {imports:?}"
    );
}

/// Guessed CALLS never reach a test file from library code, and a Go method on
/// an unknown receiver does not bind to a same-name method in another package.
#[test]
fn guesses_skip_test_files_and_foreign_go_methods() {
    let t = repo(&[
        ("go.mod", "module ex.com/m\n\ngo 1.21\n"),
        ("srv/h.go", "package srv\n\nfunc Run(ctx Ctx) {\n\tctx.Value(\"k\")\n}\n"),
        ("db/null.go", "package db\n\ntype NullTime struct{}\n\nfunc (n NullTime) Value() int { return 0 }\n"),
        ("lib/text.py", "def lines(s):\n    return s.splitlines()\n"),
        ("tests/test_text.py", "def splitlines():\n    return []\n"),
    ]);
    let st = Store::open(&Repo::discover(t.path()).unwrap()).unwrap();
    let nodes = st.nodes_where("1 = 1", []).unwrap();
    let path = |id: i64| nodes.iter().find(|n| n.id == id).map(|n| n.path.clone()).unwrap_or_default();
    let calls: Vec<(String, String)> =
        st.all_edges().unwrap().into_iter().filter(|e| e.kind == "CALLS").map(|e| (path(e.src), path(e.dst))).collect();
    assert!(!calls.iter().any(|(a, b)| a == "srv/h.go" && b == "db/null.go"), "foreign Go method: {calls:?}");
    assert!(!calls.iter().any(|(a, b)| a == "lib/text.py" && b.starts_with("tests/")), "call into a test file: {calls:?}");
}
