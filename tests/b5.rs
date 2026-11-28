//! B5: /api/runs/{id}/events and the MCP tool kula_events return the same
//! events for the same run, seat filter and from seq. See
//! docs/design/engines/activity.md.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};

const KULA: &str = env!("CARGO_BIN_EXE_kula");

/// A repo with one run's scoped log already on disk: two seats, rising seqs.
fn repo5() -> tempfile::TempDir {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    let ok = Command::new("git").arg("-C").arg(d).args(["init", "-q", "-b", "main"]).output().unwrap();
    assert!(ok.status.success(), "git init failed");
    let kd = d.join(".kula").join("runs");
    std::fs::create_dir_all(&kd).unwrap();
    let ev = |run: &str, seat: &str, seq: u64, ts: u64, kind: &str, msg: &str| json!({ "run": run, "seat": seat, "seq": seq, "ts": ts, "kind": kind, "msg": msg, "target": "src/a.rs", "path": "src/a.rs" });
    let mut lines = vec![];
    for (run, seat, seq, ts, kind, msg) in [
        ("p-1", "team/a", 1, 100, "turn", "turn 1"),
        ("p-1", "team/a", 2, 110, "tool", "sed -n 1,5p src/guard.rs"),
        ("p-1", "team/b", 1, 120, "turn", "turn b"),
        ("p-1", "team/a", 3, 130, "edit", "src/guard.rs"),
    ] {
        lines.push(ev(run, seat, seq, ts, kind, msg).to_string());
    }
    std::fs::write(kd.join("p-1.jsonl"), lines.join("\n") + "\n").unwrap();
    // The run is over: the route may compact it into the ledger.
    std::fs::write(
        d.join(".kula").join("runs").join("p-1.json"),
        json!({ "schema": 1, "id": "p-1", "plan": "p", "goal": "g", "trigger": "manual", "started": 1, "ended": 2, "base": "", "head": "", "state": "passed", "seats": [] })
            .to_string(),
    )
    .unwrap();
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

/// kula_events with the given arguments, exactly as an editor that doesn't
/// set a flag.
fn mcp_call_events(dir: &Path, args: Value) -> Value {
    let init = json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": { "clientInfo": { "name": "b5-test" }, "protocolVersion": "2025-06-18" }
    });
    let call = json!({
        "jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": { "name": "kula_events", "arguments": args }
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
        .expect("kula_events payload")
}

fn view(port: u16, dir: &Path) -> std::process::Child {
    Command::new(KULA)
        .arg("-C")
        .arg(dir)
        .arg("view")
        .arg("--port")
        .arg(port.to_string())
        .arg("--no-open")
        .env("KULA_TOKEN", "b5-test-token")
        .env("KULA_NO_AGENT", "1")
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn kula view")
}

/// One event set, from both doors: the HTTP route and the MCP tool must
/// agree event for event – all seats, one seat, and from a middle seq.
#[test]
fn mcp_kula_events_equals_http_events() {
    std::env::set_var("KULA_NO_AGENT", "1");
    let t = repo5();
    let d = t.path();
    let port = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
    let mut child = view(port, d);
    let http = (0..150).find_map(|i| {
        if i > 0 {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        http_get_json(port, "/api/runs/p-1/events?poll=1", "b5-test-token")
    });
    let http = http.expect("no /api/runs/p-1/events reply from kula view");
    let mcp = mcp_call_events(d, json!({ "run": "p-1" }));
    child.kill().expect("kill kula view");
    child.wait().expect("wait kula view");

    let (he, me) = (http["events"].as_array().expect("events array").clone(), mcp["events"].as_array().expect("events array").clone());
    assert_eq!(he.len(), 4, "all four events: {he:?}");
    assert_eq!(he, me, "route and MCP disagree");
    assert_eq!(he[0]["seat"], "team/a");
    assert_eq!(he[0]["seq"], 1);
    assert_eq!(he[3]["kind"], "edit");

    // Seat filter and from-seq agree too (route on a fresh server, MCP direct).
    let port2 = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
    let mut child2 = view(port2, d);
    let seat_http = (0..150)
        .find_map(|i| {
            if i > 0 {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            http_get_json(port2, "/api/runs/p-1/events?poll=1&seat=team/a&from=2", "b5-test-token")
        })
        .expect("no seat filtered reply from kula view");
    let seat_mcp = mcp_call_events(d, json!({ "run": "p-1", "seat": "team/a", "from": 2 }));
    child2.kill().expect("kill kula view");
    child2.wait().expect("wait kula view");
    assert_eq!(seat_http["events"], seat_mcp["events"], "seat filter disagrees");
    let got: Vec<(String, u64)> =
        seat_http["events"].as_array().unwrap().iter().map(|e| (e["seat"].as_str().unwrap().into(), e["seq"].as_u64().unwrap())).collect();
    assert_eq!(got, vec![("team/a".into(), 2), ("team/a".into(), 3)], "from=2 replays the suffix");
}
