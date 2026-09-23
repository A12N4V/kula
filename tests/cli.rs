//! End-to-end tests: build a small polyglot repo, then drive the real `kula` binary.

use serde_json::Value;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

const KULA: &str = env!("CARGO_BIN_EXE_kula");

fn git(dir: &Path, args: &[&str]) {
    let ok = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
    assert!(ok.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&ok.stderr));
}

fn kula(dir: &Path, args: &[&str]) -> String {
    let out = Command::new(KULA).arg("-C").arg(dir).args(args).env("NO_COLOR", "1").output().unwrap();
    assert!(
        out.status.success(),
        "kula {:?} failed:\n{}{}",
        args,
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).to_string()
}

fn kula_json(dir: &Path, args: &[&str]) -> Value {
    let mut a = vec!["--json"];
    a.extend_from_slice(args);
    serde_json::from_str(&kula(dir, &a)).expect("valid json")
}

fn write(dir: &Path, rel: &str, body: &str) {
    let p = dir.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn fixture() -> tempfile::TempDir {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git(d, &["init", "-q", "-b", "main"]);
    git(d, &["config", "user.name", "Tester"]);
    git(d, &["config", "user.email", "t@example.com"]);
    git(d, &["config", "commit.gpgsign", "false"]);
    write(d, "src/auth/session.ts", "import { hashToken } from \"../util/crypto\";\nexport class Session {\n  validate(token: string) { return hashToken(token).length > 0; }\n}\nexport function login(user: string) {\n  const s = new Session();\n  return s.validate(user);\n}\n");
    write(
        d,
        "src/util/crypto.ts",
        "export function hashToken(t: string) { return salt(t) + t; }\nfunction salt(t: string) { return t.slice(0, 2); }\n",
    );
    write(d, "src/api/routes.ts", "import { login } from \"../auth/session\";\nexport function handleLogin(req: any) { return login(req.user); }\nexport function handleLogout(req: any) { return logout(req); }\nfunction logout(r: any) { return r; }\n");
    write(d, "worker/jobs.py", "from worker.queue import enqueue\n\nclass Job:\n    def run(self):\n        return enqueue(self)\n\ndef schedule_nightly():\n    Job().run()\n    cleanup_tmp()\n\ndef cleanup_tmp():\n    pass\n");
    write(d, "worker/queue.py", "def enqueue(job):\n    return push_redis(job)\n\ndef push_redis(job):\n    return job\n");
    write(d, "core/src/lib.rs", "mod parse;\npub fn run(input: &str) -> usize { parse::tokenize(input).len() }\n");
    write(
        d,
        "core/src/parse.rs",
        "pub fn tokenize(s: &str) -> Vec<&str> { split_ws(s) }\nfn split_ws(s: &str) -> Vec<&str> { s.split(' ').collect() }\n",
    );
    write(d, "README.md", "# fixture\n");
    git(d, &["add", "-A"]);
    git(d, &["commit", "-qm", "initial"]);
    t
}

#[test]
fn index_and_graph_queries() {
    let t = fixture();
    let d = t.path();
    let out = kula(d, &["index"]);
    assert!(out.contains("symbols"), "{out}");

    // Search finds definitions across languages.
    let hits = kula_json(d, &["query", "hash"]);
    assert_eq!(hits[0]["name"], "hashToken");

    // Context: TS call + import resolution.
    let ctx = kula_json(d, &["context", "hashToken"]);
    let callers: Vec<&str> = ctx["callers"].as_array().unwrap().iter().map(|n| n["name"].as_str().unwrap()).collect();
    assert!(callers.contains(&"validate"), "callers: {callers:?}");
    let callees: Vec<&str> = ctx["callees"].as_array().unwrap().iter().map(|n| n["name"].as_str().unwrap()).collect();
    assert!(callees.contains(&"salt"), "callees: {callees:?}");

    // Methods are owned by their class.
    let v = kula_json(d, &["context", "validate"]);
    assert_eq!(v["node"]["kind"], "method");
    assert_eq!(v["container"]["name"], "Session");

    // Impact: changing salt ripples up to the API route handler.
    let imp = kula_json(d, &["impact", "salt", "--depth", "5"]);
    let names: Vec<&str> = imp["hits"].as_array().unwrap().iter().map(|h| h["node"]["name"].as_str().unwrap()).collect();
    for want in ["hashToken", "validate", "login", "handleLogin"] {
        assert!(names.contains(&want), "missing {want} in {names:?}");
    }

    // Python cross-file + Rust mod resolution.
    let py = kula_json(d, &["impact", "push_redis"]);
    assert!(py["hits"].to_string().contains("schedule_nightly"), "{py}");
    let rs = kula_json(d, &["trace", "run", "split_ws"]);
    let path: Vec<&str> = rs.as_array().unwrap().iter().map(|n| n["name"].as_str().unwrap()).collect();
    assert_eq!(path, vec!["run", "tokenize", "split_ws"]);

    // Flows and clusters exist.
    assert!(!kula_json(d, &["flows"]).as_array().unwrap().is_empty());
    assert!(!kula_json(d, &["clusters"]).as_array().unwrap().is_empty());
}

#[test]
fn compare_proposals_issues_notes() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);
    git(d, &["switch", "-qc", "feat/salt"]);
    write(
        d,
        "src/util/crypto.ts",
        "export function hashToken(t: string) { return salt(t) + t; }\nfunction salt(t: string) { return t.slice(0, 4) + \"!\"; }\n",
    );
    git(d, &["commit", "-qam", "stronger salt"]);

    let c = kula_json(d, &["compare", "main", "feat/salt"]);
    assert_eq!(c["ahead"], 1);
    assert_eq!(c["files"][0]["path"], "src/util/crypto.ts");
    let touched: Vec<&str> = c["files"][0]["symbols"].as_array().unwrap().iter().map(|s| s["name"].as_str().unwrap()).collect();
    assert_eq!(touched, vec!["salt"]);
    assert!(c["affected"].to_string().contains("handleLogin"));

    // Issues live in refs/kula/meta.
    kula(d, &["issue", "new", "Salt is too short", "-l", "security", "-a", "salt"]);
    kula(d, &["issue", "comment", "1", "fixing on feat/salt"]);
    let issues = kula_json(d, &["issue", "list"]);
    assert_eq!(issues[0]["labels"][0], "security");
    assert_eq!(issues[0]["comments"].as_array().unwrap().len(), 1);

    // Notes.
    kula(d, &["note", "add", "salt", "must stay deterministic"]);
    let notes = kula_json(d, &["note", "list"]);
    assert_eq!(notes[0]["target"], "symbol:salt");

    // Proposal → merge.
    kula(d, &["pr", "new", "Stronger salt", "--base", "main"]);
    let prs = kula_json(d, &["pr", "list"]);
    let id = prs[0]["id"].as_u64().unwrap().to_string();
    let out = kula(d, &["pr", "merge", &id]);
    assert!(out.contains(&format!("merged #{id}")), "{out}");
    let log = Command::new("git").arg("-C").arg(d).args(["log", "-1", "--format=%s", "main"]).output().unwrap();
    assert!(String::from_utf8_lossy(&log.stdout).contains("Merge proposal #"));
    kula(d, &["issue", "close", "1"]);
    assert!(kula_json(d, &["issue", "list"]).as_array().unwrap().is_empty());

    // The meta ref is a real commit chain.
    let n = Command::new("git").arg("-C").arg(d).args(["rev-list", "--count", "refs/kula/meta"]).output().unwrap();
    assert!(String::from_utf8_lossy(&n.stdout).trim().parse::<u32>().unwrap() >= 5);
}

#[test]
fn git_passthrough_and_status() {
    let t = fixture();
    let d = t.path();
    // Unknown subcommands go straight to git.
    let out = kula(d, &["rev-parse", "--abbrev-ref", "HEAD"]);
    assert_eq!(out.trim(), "main");
    write(d, "new.txt", "hi");
    let s = kula_json(d, &["status"]);
    assert_eq!(s["index"], "missing");
    assert_eq!(s["files"][0]["path"], "new.txt");
    kula(d, &["add", "new.txt"]);
    kula(d, &["commit", "-qm", "via kula"]);
    assert!(kula(d, &["log", "-1", "--format=%s"]).contains("via kula"));
}

#[test]
fn mcp_stdio_roundtrip() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);
    let mut child = Command::new(KULA).arg("-C").arg(d).arg("mcp").stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
    {
        let mut stdin = child.stdin.take().unwrap();
        writeln!(stdin, r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{"protocolVersion":"2025-06-18"}}}}"#).unwrap();
        writeln!(stdin, r#"{{"jsonrpc":"2.0","method":"notifications/initialized"}}"#).unwrap();
        writeln!(stdin, r#"{{"jsonrpc":"2.0","id":2,"method":"tools/list"}}"#).unwrap();
        writeln!(stdin, r#"{{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{{"name":"impact","arguments":{{"symbol":"salt"}}}}}}"#)
            .unwrap();
    }
    let out = child.wait_with_output().unwrap();
    let lines: Vec<Value> = String::from_utf8_lossy(&out.stdout).lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(lines.len(), 3, "notifications get no reply");
    assert_eq!(lines[0]["result"]["serverInfo"]["name"], "kula");
    assert!(lines[1]["result"]["tools"].as_array().unwrap().len() >= 6);
    let text = lines[2]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("hashToken"), "{text}");
}

#[test]
fn graph_diff_between_branches_and_worktree() {
    let t = fixture();
    let d = t.path();
    git(d, &["switch", "-qc", "feat/diff"]);
    // modify salt, remove logout, add rotateToken (which calls hashToken)
    write(
        d,
        "src/util/crypto.ts",
        "export function hashToken(t: string) { return salt(t) + t; }\nfunction salt(t: string) { return t.slice(0, 8); }\nexport function rotateToken(t: string) { return hashToken(t + \"!\"); }\n",
    );
    write(
        d,
        "src/api/routes.ts",
        "import { login } from \"../auth/session\";\nexport function handleLogin(req: any) { return login(req.user); }\n",
    );
    git(d, &["commit", "-qam", "rotate tokens"]);

    let g = kula_json(d, &["graph-diff", "main", "feat/diff"]);
    let names = |status: &str| -> Vec<String> {
        g["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|n| n["status"] == status && n["kind"] != "file")
            .map(|n| n["name"].as_str().unwrap().to_string())
            .collect()
    };
    assert_eq!(names("added"), vec!["rotateToken"]);
    let removed = names("removed");
    assert!(removed.contains(&"logout".to_string()) && removed.contains(&"handleLogout".to_string()), "{removed:?}");
    assert_eq!(names("modified"), vec!["salt"]);
    assert_eq!(g["summary"]["added"], 1);
    assert!(g["summary"]["edges_added"].as_u64().unwrap() >= 1, "rotateToken → hashToken call edge");

    // Uncommitted code is contrasted with WORKTREE.
    write(d, "src/util/extra.ts", "export function brandNew() { return 1; }\n");
    let w = kula_json(d, &["graph-diff", "HEAD", "WORKTREE"]);
    assert!(w["nodes"].to_string().contains("brandNew"));
    assert_eq!(w["summary"]["added"], 1);
}
