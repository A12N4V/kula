//! B1: parse-cache parity, entry-finder flows and MCP equality, on the
//! mini-monorepo fixture. Same fixture style as tests/brief.rs.

use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::Value;

const KULA: &str = env!("CARGO_BIN_EXE_kula");
const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/mini-monorepo");

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

/// The mini-monorepo: a Rust crate with CLI subcommands and an unused helper,
/// a TS server with a route, and a test file. Built at runtime into a fresh
/// git repo, copied from tests/fixtures/mini-monorepo.
fn fixture() -> tempfile::TempDir {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    // Bash and SQL exercise langs whose queries were the ones warm parsing
    // silently skipped (critic blocking #1), so they ride along in every test.
    for (rel, src) in [
        ("scripts/test.sh", concat!(env!("CARGO_MANIFEST_DIR"), "/scripts/test.sh")),
        ("bash.sh", concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/langs/bash.sh")),
        ("sql.sql", concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/langs/sql.sql")),
    ] {
        let body = std::fs::read_to_string(src).unwrap();
        write(d, rel, &body);
    }
    for rel in [
        "app/Cargo.toml",
        "app/src/main.rs",
        "app/src/lib.rs",
        "app/src/cli.rs",
        "app/tests/it.rs",
        "web/package.json",
        "web/src/server.ts",
        "web/src/health.ts",
        "web/src/status.ts",
    ] {
        let body = std::fs::read_to_string(Path::new(FIXTURE).join(rel)).unwrap();
        write(d, rel, &body);
    }
    git(d, &["init", "-q", "-b", "main"]);
    git(d, &["config", "user.name", "Tester"]);
    git(d, &["config", "user.email", "t@example.com"]);
    git(d, &["config", "commit.gpgsign", "false"]);
    git(d, &["add", "-A"]);
    git(d, &["commit", "-qm", "initial"]);
    t
}

/// Canonical dump of the graph: one line per node and edge, sorted. Cold and
/// warm rebuilds must produce identical text.
fn graph_dump(dir: &Path) -> String {
    let repo = kula::git::Repo::discover(dir).expect("repo");
    let st = kula::store::Store::open(&repo).expect("store");
    let mut lines = Vec::new();
    for n in st.nodes_where("1=1", ()).unwrap() {
        lines.push(format!(
            "N|{}|{}|{}|{}|{}|{:?}|{}",
            n.kind, n.name, n.path, n.lang, n.start_line, n.parent, n.community
        ));
    }
    for e in st.all_edges().unwrap() {
        lines.push(format!(
            "E|{}|{}|{}|{:.4}|{}|{}",
            e.src, e.dst, e.kind, e.weight, e.confidence, e.source
        ));
    }
    lines.sort();
    lines.join("\n")
}

#[test]
fn cache_parity_cold_and_warm_graphs_are_identical() {
    let t = fixture();
    let d = t.path();
    index(d); // cold: populates the parse cache
    let cold = graph_dump(d);
    assert!(!cold.is_empty(), "cold graph is empty");

    let cache = d.join(".kula/pcache.db");
    assert!(cache.exists(), "parse cache was not created");
    index(d); // warm: every parse should be a cache hit
    let warm = graph_dump(d);
    assert_eq!(cold, warm, "warm graph differs from cold graph");
}

#[test]
fn warm_run_reports_cache_hits() {
    let t = fixture();
    let d = t.path();
    index(d);
    let (o, _e, c) = kula(d, &["index"]);
    assert_eq!(c, 0);
    assert!(o.contains("cached"), "warm reindex output reports cache hits: {o}");
}

/// MCP is line-delimited JSON-RPC on stdio; ask it for kula_flows the way an
/// editor would and compare with `kula flows --json`.
fn mcp_call_flows(dir: &Path) -> Value {
    let init = serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": { "clientInfo": { "name": "b1-test" }, "protocolVersion": "2025-06-18" }
    });
    let call = serde_json::json!({
        "jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": { "name": "kula_flows", "arguments": { "limit": 30 } }
    });
    let mut child = Command::new(KULA)
        .arg("-C")
        .arg(dir)
        .arg("mcp")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn kula mcp");
    use std::io::Write;
    let stdin = child.stdin.as_mut().unwrap();
    writeln!(stdin, "{init}").unwrap();
    writeln!(stdin, "{call}").unwrap();
    drop(child.stdin.take());
    let out = child.wait_with_output().unwrap();
    assert!(out.status.success(), "kula mcp exited {}", out.status);
    let text = String::from_utf8_lossy(&out.stdout);
    let replies: Vec<Value> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).unwrap_or_else(|e| panic!("bad mcp line {l:?}: {e}")))
        .collect();
    let reply = replies.iter().find(|r| r.get("id") == Some(&serde_json::json!(2))).expect("no reply for tools/call");
    let inner: Value = serde_json::from_str(reply.pointer("/result/content/0/text").and_then(|v| v.as_str()).expect("text content"))
        .expect("kula_flows payload");
    inner
}

#[test]
fn mcp_kula_flows_equals_cli_flows_json() {
    let t = fixture();
    let d = t.path();
    index(d);
    let (o, e, c) = kula(d, &["flows", "--ordered", "--json"]);
    assert_eq!(c, 0, "flows failed: {e}");
    let cli: Value = serde_json::from_str(o.trim()).expect("flows --json output");
    let mcp = mcp_call_flows(d);
    assert_eq!(cli, mcp, "kula_flows differs from `kula flows --json`");
    assert!(!mcp.pointer("/flows").and_then(|v| v.as_array()).map_or(true, |a| a.is_empty()), "flows are empty");
}

#[test]
fn flows_cover_routes_cli_subcommands_and_are_ordered() {
    let t = fixture();
    let d = t.path();
    index(d);
    let (o, e, c) = kula(d, &["flows", "--ordered", "--json", "--limit", "100"]);
    assert_eq!(c, 0, "flows failed: {e}");
    let flows: Value = serde_json::from_str(o.trim()).unwrap();
    let text = serde_json::to_string(&flows).unwrap();

    // Route entry from the TS server.
    assert!(text.contains("/health"), "route entry /health missing: {text}");
    // CLI subcommand entries from `enum Commands` – snake_case variants.
    assert!(text.contains("serve"), "cli subcommand serve missing: {text}");
    assert!(text.contains("index_now"), "cli subcommand index_now missing: {text}");
    // main entry.
    assert!(text.contains("main"), "main entry missing: {text}");

    // Steps inside each flow are ordered by call-site line within each parent
    // (traversal is by depth, so the global sequence interleaves parents).
    for flow in flows.pointer("/flows").and_then(|v| v.as_array()).expect("flows array") {
        let steps = flow.get("steps").and_then(|s| s.as_array()).expect("steps array");
        let mut last: Option<(Value, i64)> = None;
        for s in steps {
            let from = s.get("from").cloned().unwrap_or(serde_json::json!(null));
            let line = s.get("line").and_then(|v| v.as_i64()).expect("step line");
            if let Some((prev_from, prev_line)) = &last {
                if &from == prev_from {
                    assert!(line >= *prev_line, "steps not ordered by line within parent: {flow}");
                }
            }
            last = Some((from, line));
        }
    }
}

#[test]
fn unused_helper_is_not_an_entry_point() {
    let t = fixture();
    let d = t.path();
    index(d);
    let (o, _e, c) = kula(d, &["flows", "--ordered", "--json", "--limit", "100"]);
    assert_eq!(c, 0);
    let flows: Value = serde_json::from_str(o.trim()).unwrap();
    let text = serde_json::to_string(&flows).unwrap();
    assert!(!text.contains("unused_helper"), "unused helper became an entry point: {text}");
}

#[test]
fn fixture_symbols_and_edges_are_built() {
    let t = fixture();
    let d = t.path();
    index(d);
    let repo = kula::git::Repo::discover(d).unwrap();
    let st = kula::store::Store::open(&repo).unwrap();
    let nodes = st.nodes_where("1=1", ()).unwrap();
    assert!(nodes.iter().any(|n| n.name == "compute"), "compute not indexed");
    assert!(nodes.iter().any(|n| n.name == "dispatch"), "dispatch not indexed");
    assert!(nodes.iter().any(|n| n.name == "health"), "health not indexed");
    let edges = st.all_edges().unwrap();
    assert!(!edges.is_empty(), "no edges built");
    // Every edge carries a source: scip, resolver or name.
    for e in &edges {
        assert!(
            ["scip", "resolver", "name"].contains(&e.source.as_str()),
            "edge with unknown source {:?}",
            e.source
        );
    }
}

#[test]
fn uncommitted_edit_is_never_served_a_stale_cached_parse() {
    let t = fixture();
    let d = t.path();
    index(d);
    // Edit a committed file in the worktree without committing: the git index
    // still names the old blob, so the cache key must not come from it.
    write(d, "app/src/lib.rs", "pub fn compute(n: u32) -> u32 { n + 100 }\npub fn extra() -> u32 { 7 }\n");
    index(d);
    let repo = kula::git::Repo::discover(d).unwrap();
    let st = kula::store::Store::open(&repo).unwrap();
    let nodes = st.nodes_where("1=1", ()).unwrap();
    assert!(nodes.iter().any(|n| n.name == "extra"), "uncommitted edit was not indexed (stale cache hit)");
}
