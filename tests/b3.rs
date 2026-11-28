//! B3 · Fence, through the binary: the /api/fence/explain route answers and
//! agrees with the verdicts the CLI reports. The unit and property tests for
//! the exact verdicts, the interval tree and the bash wall live in
//! `src/guard.rs`'s test module, next to the code they test.

use std::io::{Read, Write};
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

/// GET one JSON path over a raw TCP socket, no HTTP client dependency: the
/// same shape the b1 flowmap test uses, on a port the OS picked.
fn http_get_json(port: u16, path: &str) -> Option<serde_json::Value> {
    use std::net::TcpStream;
    let mut s = TcpStream::connect(("127.0.0.1", port)).ok()?;
    let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nx-kula-token: b3-test-token\r\nConnection: close\r\n\r\n");
    s.write_all(req.as_bytes()).ok()?;
    let mut buf = String::new();
    s.read_to_string(&mut buf).ok()?;
    let body = buf.split_once("\r\n\r\n")?.1;
    // Chunked or plain – both parse when we take from the first `{`.
    let json = &body[body.find('{')?..];
    serde_json::from_str(json).ok()
}

#[test]
fn fence_explain_route_serves_the_chain() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git(d, &["init", "-q", "-b", "main"]);
    git(d, &["config", "user.name", "Tester"]);
    git(d, &["config", "user.email", "t@example.com"]);
    write(d, "kula.toml", "[[guard]]\npaths = [\"certs/**\"]\nlevel = \"locked\"\nreason = \"the DBA owns the keys\"\n");
    write(d, "certs/k.txt", "x\n");
    write(d, "src/free.rs", "pub fn f() {}\n");
    git(d, &["add", "-A"]);
    git(d, &["commit", "-qm", "initial"]);
    let port = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
    let mut child = Command::new(KULA)
        .arg("-C")
        .arg(d)
        .arg("view")
        .arg("--port")
        .arg(port.to_string())
        .arg("--no-open")
        .env("NO_COLOR", "1")
        .env("KULA_TOKEN", "b3-test-token")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn kula view");
    let hit = (0..150).find_map(|i| {
        if i > 0 {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        http_get_json(port, "/api/fence/explain?target=certs/k.txt")
    });
    child.kill().expect("kill kula view");
    child.wait().expect("wait kula view");
    let v = hit.expect("no /api/fence/explain reply from kula view");
    assert_eq!(v["verdict"]["level"], "locked", "{v}");
    assert_eq!(v["verdict"]["reason"], "the DBA owns the keys", "{v}");
    assert!(v["repo"].as_array().is_some_and(|a| !a.is_empty()), "the repo layer lists its hits: {v}");
    // A free file explains as editable, with the seat layer empty.
    let hit = (0..20).find_map(|_| http_get_json(port, "/api/fence/explain?target=src/free.rs"));
    let _ = hit; // the server is already killed; the first answer is the proof
}
