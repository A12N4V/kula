//! B4: /api/seats and the MCP tool kula_seats return the same seat set and
//! the same lint verdicts. The seat-lint fixture is copied into a tempdir –
//! never the repo's own kula.toml.

use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::Value;

const KULA: &str = env!("CARGO_BIN_EXE_kula");
const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/seat-lint");

/// The fixture repo: a disposable kula.toml, one skill, one MCP server, notes.
fn seat_repo() -> tempfile::TempDir {
    let t = tempfile::tempdir().unwrap();
    let src = Path::new(FIXTURE);
    let mut stack = vec![src.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for e in std::fs::read_dir(&dir).unwrap().flatten() {
            let p = e.path();
            let rel = p.strip_prefix(src).unwrap();
            if p.is_dir() {
                stack.push(p);
            } else {
                let to = t.path().join(rel);
                std::fs::create_dir_all(to.parent().unwrap()).unwrap();
                std::fs::copy(&p, &to).unwrap();
            }
        }
    }
    // kula view serves a git repo: init one so the fixture is servable.
    let ok = Command::new("git").arg("-C").arg(t.path()).args(["init", "-q", "-b", "main"]).output().unwrap();
    assert!(ok.status.success(), "git init failed");
    let ok = Command::new("git").arg("-C").arg(t.path()).args(["add", "-A"]).output().unwrap();
    assert!(ok.status.success(), "git add failed");
    let ok = Command::new("git")
        .arg("-C")
        .arg(t.path())
        .args(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "fixture"])
        .output()
        .unwrap();
    assert!(ok.status.success(), "git commit failed: {}", String::from_utf8_lossy(&ok.stderr));
    t
}

/// GET one JSON path from the local view server over a raw TCP socket, no
/// HTTP client dependency: x-kula-token auth, plain HTTP/1.1, one response.
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

/// kula_seats with no arguments, exactly as an editor that doesn't set a flag.
fn mcp_call_seats(dir: &Path) -> Value {
    let init = serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": { "clientInfo": { "name": "b4-test" }, "protocolVersion": "2025-06-18" }
    });
    let call = serde_json::json!({
        "jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": { "name": "kula_seats", "arguments": { "render": false } }
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
    let reply = replies.iter().find(|r| r.get("id") == Some(&serde_json::json!(2))).expect("no reply for tools/call");
    serde_json::from_str(reply.pointer("/result/content/0/text").and_then(|v| v.as_str()).expect("text content"))
        .expect("kula_seats payload")
}

/// One seat set, one lint verdict, from both doors: the HTTP route and the
/// MCP tool must agree on seats, hashes and lint errors.
#[test]
fn mcp_kula_seats_equals_http_seats() {
    std::env::set_var("KULA_NO_AGENT", "1");
    let t = seat_repo();
    let d = t.path();
    let port = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
    let mut child = Command::new(KULA)
        .arg("-C")
        .arg(d)
        .arg("view")
        .arg("--port")
        .arg(port.to_string())
        .arg("--no-open")
        .env("KULA_TOKEN", "b4-test-token")
        .env("KULA_NO_AGENT", "1")
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn kula view");
    let http = (0..150).find_map(|i| {
        if i > 0 {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        http_get_json(port, "/api/seats?render=0", "b4-test-token")
    });
    let http = http.expect("no /api/seats reply from kula view");
    let mcp = mcp_call_seats(d);
    child.kill().expect("kill kula view");
    child.wait().expect("wait kula view");

    let (hs, ms) = (http["seats"].as_array().expect("seats array").clone(), mcp["seats"].as_array().expect("seats array").clone());
    assert_eq!(hs.len(), ms.len(), "the two doors disagree on seat count");
    for (h, m) in hs.iter().zip(ms.iter()) {
        assert_eq!(h["seat"], m["seat"], "seat set differs: {h} vs {m}");
        assert_eq!(h["ok"], m["ok"], "lint verdict differs for {}: {h} vs {m}", h["seat"]);
        assert_eq!(h["lint"], m["lint"], "lint errors differ for {}: {h} vs {m}", h["seat"]);
    }
    // The fixture lints clean (CLI check is skipped under KULA_NO_AGENT).
    assert!(hs.iter().all(|s| s["ok"] == Value::Bool(true)), "fixture must lint clean: {hs:?}");
    assert!(hs.iter().any(|s| s["seat"] == "lint/alpha"), "fixture seat alpha present: {hs:?}");
}
