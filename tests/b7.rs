//! B7: agent attribution. /api/blame/agents and the MCP tool kula_blame_agents
//! return the same per-line provenance; /api/runs/{id}/changelog and
//! kula_changelog return the same flow-grouped changes. See
//! docs/design/engines/changes.md.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};

const KULA: &str = env!("CARGO_BIN_EXE_kula");

/// A repo where seat a introduced two lines, seat b moved one and added its
/// own, seat c rewrote the other – with usage seeded, so dollars attribute.
/// The file stages come from tests/fixtures/attribution/ (see its README).
fn repo7() -> tempfile::TempDir {
    let t = tempfile::tempdir().unwrap();
    let d = t.path().to_path_buf();
    let fx = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/attribution");
    let stage = |n: &str| std::fs::read_to_string(fx.join(n)).unwrap();
    let git = |args: &[&str]| git_out(&d, args);
    std::fs::create_dir_all(d.join("src")).unwrap();
    std::fs::write(d.join("src/lib.rs"), stage("0-base.rs")).unwrap();
    git(&["init", "-q", "-b", "main"]);
    git(&["config", "user.name", "Tester"]);
    git(&["config", "user.email", "t@example.com"]);
    git(&["config", "commit.gpgsign", "false"]);
    git(&["add", "-A"]);
    git(&["commit", "-qm", "initial"]);

    let saves = [("team/a", "1-a-introduces.rs"), ("team/b", "2-b-moves.rs"), ("team/c", "3-c-rewrites.rs")];
    let mut file_parent = git(&["rev-parse", "HEAD"]).trim().to_string();
    let mut op_parent = String::new();
    for (seat, fixture) in saves {
        std::fs::write(d.join("src/lib.rs"), stage(fixture)).unwrap();
        git(&["add", "-A"]);
        let tree = git(&["write-tree"]).trim().to_string();
        let commit = git(&["commit-tree", &tree, "-p", &file_parent, "-m", "kula save"]).trim().to_string();
        file_parent = commit.clone();
        op_parent = append_save_op(&d, &op_parent, seat, "demo", &commit);
    }

    // Seat dollars on the per-run usage ledger: a 3.0, b 1.0, c 2.0.
    let rec = |seat: &str, cost: f64| {
        json!({
            "seat": seat, "run": "demo", "slice": "s", "model": "fake",
            "day": "2026-11-27", "ts": 1_000,
            "tokens": { "input": 10, "output": 5, "cache_read": 0, "cache_write": 0 },
            "cost_usd": cost, "estimated": "",
            "agent": "fake", "message_id": format!("m-{seat}")
        })
        .to_string()
    };
    std::fs::create_dir_all(d.join(".kula").join("runs")).unwrap();
    std::fs::write(
        d.join(".kula").join("runs").join("demo.usage.jsonl"),
        vec![rec("team/a", 3.0), rec("team/b", 1.0), rec("team/c", 2.0), String::new()].join("\n"),
    )
    .unwrap();
    t
}

fn git_out(dir: &Path, args: &[&str]) -> String {
    let o = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
    assert!(o.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&o.stderr));
    String::from_utf8_lossy(&o.stdout).into_owned()
}

/// Append one save op to refs/kula/ops, the way ops::append_op_seat does:
/// op.json in a tree, a commit on the log head, one atomic update-ref. The
/// first op has no parent – the log starts fresh, never at repo history.
fn append_save_op(dir: &Path, parent: &str, seat: &str, run: &str, commit: &str) -> String {
    let op = json!({
        "id": "", "kind": "save", "run": run, "parent": parent,
        "view": { seat: commit }, "seat": seat, "message": "b7 test save",
        "time": 1_000, "undo_of": ""
    });
    let mut c = Command::new("git")
        .arg("-C")
        .arg(dir)
        .arg("hash-object")
        .arg("-w")
        .arg("--stdin")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    c.stdin.take().unwrap().write_all(serde_json::to_string_pretty(&op).unwrap().as_bytes()).unwrap();
    let out = c.wait_with_output().unwrap();
    assert!(out.status.success(), "hash-object: {}", String::from_utf8_lossy(&out.stderr));
    let blob = String::from_utf8_lossy(&out.stdout).trim().to_string();

    let mut c = Command::new("git").arg("-C").arg(dir).arg("mktree").stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
    c.stdin.take().unwrap().write_all(format!("100644 blob {blob}\top.json\n").as_bytes()).unwrap();
    let out = c.wait_with_output().unwrap();
    assert!(out.status.success(), "mktree: {}", String::from_utf8_lossy(&out.stderr));
    let tree = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let mut ct = vec![
        "-c".to_string(),
        "user.name=kula".to_string(),
        "-c".to_string(),
        "user.email=kula@localhost".to_string(),
        "commit-tree".to_string(),
        tree.clone(),
    ];
    if !parent.is_empty() {
        ct.extend(["-p".to_string(), parent.to_string()]);
    }
    ct.extend(["-m".to_string(), "kula op: save b7 test save".to_string()]);
    let id = git_out(dir, &ct.iter().map(String::as_str).collect::<Vec<&str>>()).trim().to_string();
    // The old value is the zero id while the log does not exist yet, exactly
    // what ops::append_op_seat passes for the first op.
    let probe = Command::new("git").arg("-C").arg(dir).args(["rev-parse", "--verify", "--quiet", "refs/kula/ops"]).output().unwrap();
    let exists = probe.status.success() && !String::from_utf8_lossy(&probe.stdout).trim().is_empty();
    let old = if exists { parent.to_string() } else { "0".repeat(40) };
    git_out(dir, &["update-ref", "refs/kula/ops", &id, &old]);
    id
}

/// GET one JSON path from the local view server over a raw TCP socket.
fn http_get_json(port: u16, path: &str, token: &str) -> Option<Value> {
    let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).ok()?;
    s.set_read_timeout(Some(std::time::Duration::from_secs(5))).ok()?;
    let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nx-kula-token: {token}\r\nConnection: close\r\n\r\n");
    s.write_all(req.as_bytes()).ok()?;
    let mut buf = Vec::new();
    s.read_to_end(&mut buf).ok()?;
    let body = String::from_utf8_lossy(&buf).split_once("\r\n\r\n")?.1.to_string();
    serde_json::from_str(&body).ok()
}

/// One MCP tools/call against `kula mcp`, reply text parsed as JSON.
fn mcp_call(dir: &Path, tool: &str, args: Value) -> Value {
    let init = json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": { "clientInfo": { "name": "b7-test" }, "protocolVersion": "2025-06-18" }
    });
    let call = json!({
        "jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": { "name": tool, "arguments": args }
    });
    let mut child =
        Command::new(KULA).arg("-C").arg(dir).arg("mcp").stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().expect("spawn kula mcp");
    {
        let stdin = child.stdin.as_mut().unwrap();
        writeln!(stdin, "{init}").unwrap();
        writeln!(stdin, "{call}").unwrap();
    }
    drop(child.stdin.take());
    let out = child.wait_with_output().unwrap();
    assert!(out.status.success(), "kula mcp exited {}", out.status);
    let text = String::from_utf8_lossy(&out.stdout);
    let replies: Vec<Value> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).unwrap_or_else(|e| panic!("bad mcp line {l:?}: {e}")))
        .collect();
    let reply = replies.iter().find(|r| r.get("id") == Some(&json!(2))).expect("no reply for tools/call");
    serde_json::from_str(reply.pointer("/result/content/0/text").and_then(|v| v.as_str()).expect("text content"))
        .unwrap_or_else(|e| panic!("mcp {tool} payload: {e}: {reply}"))
}

fn view(port: u16, dir: &Path) -> std::process::Child {
    Command::new(KULA)
        .arg("-C")
        .arg(dir)
        .arg("view")
        .arg("--port")
        .arg(port.to_string())
        .arg("--no-open")
        .env("KULA_TOKEN", "b7-test-token")
        .env("KULA_NO_AGENT", "1")
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn kula view")
}

/// The engine's story, through the MCP door (same data the route serves):
/// the moved line stays seat a's, the rewrite takes seat c's, seat b owns its
/// added line, and the dollars sum to each seat's spend.
#[test]
fn blame_and_changelog_attribute_moves_and_rewrites() {
    std::env::set_var("KULA_NO_AGENT", "1");
    let t = repo7();
    let d = t.path();

    let blame = mcp_call(d, "kula_blame_agents", json!({ "path": "src/lib.rs" }));
    let lines = blame["lines"].as_array().expect("lines array");
    assert_eq!(lines.len(), 6, "every worktree line blamed: {blame:?}");
    let seat_of = |n: u64| lines.iter().find(|l| l["line"] == n).and_then(|l| l["seat"].as_str()).unwrap_or("").to_string();
    assert_eq!(seat_of(5), "team/a", "the moved line keeps its introducer: {blame:?}");
    assert_eq!(seat_of(3), "team/c", "the rewritten line takes the rewriter: {blame:?}");
    assert_eq!(seat_of(6), "team/b", "the added line belongs to its saver: {blame:?}");
    // Dollars: each seat's surviving lines sum to its seeded spend.
    let sum = |seat: &str| -> f64 { lines.iter().filter(|l| l["seat"] == seat).filter_map(|l| l["cost_share"].as_f64()).sum() };
    assert!((sum("team/a") - 3.0).abs() < 1e-6, "seat a sums to its spend: {blame:?}");
    assert!((sum("team/b") - 1.0).abs() < 1e-6, "seat b sums to its spend: {blame:?}");
    assert!((sum("team/c") - 2.0).abs() < 1e-6, "seat c sums to its spend: {blame:?}");

    let changes = mcp_call(d, "kula_changelog", json!({ "run": "demo" }));
    let items = changes["changes"].as_array().expect("changes array");
    assert!(!items.is_empty(), "the run's changes: {changes:?}");
    let total: f64 = items.iter().filter_map(|c| c["cost_share"].as_f64()).sum();
    assert!((total - 6.0).abs() < 1e-6, "changelog attributes all spend: {changes:?}");
    assert!(items.iter().all(|c| c["run"] == "demo"), "every change names its run");
}

/// Both doors agree: the HTTP route and the MCP tool return equal payloads
/// for blame and for the run changelog.
#[test]
fn http_routes_equal_mcp_tools() {
    std::env::set_var("KULA_NO_AGENT", "1");
    let t = repo7();
    let d = t.path();
    let port = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
    let mut child = view(port, d);
    let http_blame = (0..150)
        .find_map(|i| {
            if i > 0 {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            http_get_json(port, "/api/blame/agents?path=src/lib.rs", "b7-test-token")
        })
        .expect("no /api/blame/agents reply from kula view");
    let mcp_blame = mcp_call(d, "kula_blame_agents", json!({ "path": "src/lib.rs" }));
    let http_changes = http_get_json(port, "/api/runs/demo/changelog", "b7-test-token").expect("no changelog reply");
    let mcp_changes = mcp_call(d, "kula_changelog", json!({ "run": "demo" }));
    child.kill().expect("kill kula view");
    child.wait().expect("wait kula view");

    assert_eq!(http_blame, mcp_blame, "blame: route and MCP disagree");
    assert_eq!(http_changes, mcp_changes, "changelog: route and MCP disagree");
    assert!(!http_blame["lines"].as_array().expect("blame lines").is_empty(), "blame has lines: {http_blame:?}");
}
