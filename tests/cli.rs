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

#[test]
fn init_sets_up_a_project_idempotently() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    write(d, "src/app.ts", "import React from \"react\";\nimport { z } from \"zod\";\nexport function App() { return React; }\n");
    write(d, "package.json", "{\"dependencies\":{\"react\":\"19\",\"left-pad\":\"1\"}}");
    // Not a repo yet: init makes one, like `npm init` makes package.json.
    kula(d, &["init", "-y", "--hooks", "--agents", "--ci", "github"]);
    assert!(d.join(".git").exists());
    let toml = std::fs::read_to_string(d.join("kula.toml")).unwrap();
    assert!(toml.contains("[check]") && toml.contains("max_risk"), "{toml}");
    let mcp: Value = serde_json::from_str(&std::fs::read_to_string(d.join(".mcp.json")).unwrap()).unwrap();
    assert_eq!(mcp["mcpServers"]["kula"]["args"][0], "mcp");
    assert!(d.join(".github/workflows/kula.yml").exists());
    assert!(d.join(".kula/graph.db").exists(), "init builds the first graph");
    let hook = std::fs::read_to_string(d.join(".git/hooks/post-commit")).unwrap();
    assert!(hook.contains("kula index --if-stale"));

    // Idempotent: a second run changes nothing and keeps one hook block.
    std::fs::write(d.join("kula.toml"), "[check]\nmax_risk = \"high\"\n").unwrap();
    kula(d, &["init", "-y", "--hooks", "--no-agents", "--ci", "none", "--no-index"]);
    assert_eq!(std::fs::read_to_string(d.join("kula.toml")).unwrap(), "[check]\nmax_risk = \"high\"\n");
    assert_eq!(std::fs::read_to_string(d.join(".git/hooks/post-commit")).unwrap().matches(">>> kula").count(), 1);

    // hooks uninstall leaves no trace in hooks it created.
    kula(d, &["hooks", "uninstall"]);
    assert!(!d.join(".git/hooks/post-commit").exists());
}

#[test]
fn deps_reports_imported_declared_and_undeclared() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git(d, &["init", "-q", "-b", "main"]);
    write(d, "src/app.ts", "import React from \"react\";\nimport { z } from \"zod\";\nimport fs from \"node:fs\";\nimport { a } from \"./a\";\nexport function App() { return [React, z, fs, a]; }\n");
    write(d, "src/a.ts", "export const a = 1;\n");
    write(d, "package.json", "{\"dependencies\":{\"react\":\"19\",\"left-pad\":\"1\"}}");
    kula(d, &["index"]);
    let deps = kula_json(d, &["deps"]);
    let get = |n: &str| deps.as_array().unwrap().iter().find(|x| x["name"] == n).cloned().unwrap_or(Value::Null);
    assert_eq!(get("react")["declared"], true);
    assert_eq!(get("react")["importers"], 1);
    assert_eq!(get("zod")["declared"], false);
    assert_eq!(get("node:fs")["builtin"], true);
    assert_eq!(get("left-pad")["importers"], 0);
    assert!(get("./a").is_null(), "relative imports are not packages");
    let und = kula_json(d, &["deps", "--undeclared"]);
    assert_eq!(und.as_array().unwrap().len(), 1);
    assert_eq!(und[0]["name"], "zod");
}

#[test]
fn check_gates_on_risk_and_speaks_markdown() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);
    git(d, &["checkout", "-qb", "feat"]);
    write(
        d,
        "src/util/crypto.ts",
        "export function hashToken(t: string) { return salt(t) + t + \"!\"; }\nfunction salt(t: string) { return t.slice(0, 3); }\n",
    );
    git(d, &["commit", "-qam", "tweak"]);
    let r = kula_json(d, &["check", "--base", "main", "--max-risk", "high"]);
    assert_eq!(r["pass"], true);
    assert!(r["touched"].as_u64().unwrap() >= 1);
    let md = kula(d, &["check", "--base", "main", "--max-risk", "high", "--md"]);
    assert!(md.starts_with("### kula check"), "{md}");
    // A gate of "none" fails any change, with exit code 2.
    let out =
        Command::new(KULA).arg("-C").arg(d).args(["check", "--base", "main", "--max-risk", "none"]).env("NO_COLOR", "1").output().unwrap();
    assert_eq!(out.status.code(), Some(2));
}

#[test]
fn index_if_stale_skips_when_current() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index", "--quiet"]);
    let db = d.join(".kula/graph.db");
    let m1 = std::fs::metadata(&db).unwrap().modified().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    assert_eq!(kula(d, &["index", "--if-stale", "--quiet"]), "");
    assert_eq!(std::fs::metadata(&db).unwrap().modified().unwrap(), m1, "no rebuild when HEAD is unchanged");
}

#[test]
fn kula_toml_excludes_and_size_limit_shape_the_graph() {
    let t = fixture();
    let d = t.path();
    write(d, "gen/big.ts", &format!("export function huge() {{ return 1; }}\n{}", "// pad\n".repeat(400)));
    write(d, "kula.toml", "[index]\nexclude = [\"worker/**\"]\nmax_file_kb = 2\n");
    kula(d, &["index"]);
    let q = |s: &str| kula_json(d, &["query", s]).as_array().map(|a| a.iter().any(|n| n["name"] == s)).unwrap_or(false);
    assert!(!q("schedule_nightly"), "worker/** is excluded");
    assert!(!q("huge"), "files over max_file_kb are skipped");
    assert!(q("hashToken"), "everything else is indexed");
}

#[test]
fn agent_context_pack_fits_the_budget_and_ranks_by_graph() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);
    let p = kula_json(d, &["pack", "hashToken", "--budget", "4000"]);
    let items = p["items"].as_array().unwrap();
    assert_eq!(items[0]["name"], "hashToken");
    assert_eq!(items[0]["why"], "seed");
    let whys: Vec<(&str, &str)> = items.iter().map(|i| (i["name"].as_str().unwrap(), i["why"].as_str().unwrap())).collect();
    assert!(whys.contains(&("salt", "uses")), "{whys:?}");
    assert!(whys.iter().any(|(n, w)| *w == "used by" && (*n == "validate" || *n == "login")), "{whys:?}");
    assert!(p["used"].as_u64().unwrap() <= 4000);
    // A tiny budget keeps the seed (as a signature if need be) and says what it left out.
    let small = kula_json(d, &["pack", "hashToken", "--budget", "60"]);
    assert!(small["items"].as_array().unwrap().len() <= 1);
    assert!(!small["omitted"].as_array().unwrap().is_empty());
}

#[test]
fn agent_before_and_verify_bracket_an_edit() {
    let t = fixture();
    let d = t.path();
    write(
        d,
        "src/util/crypto.test.ts",
        "import { hashToken } from \"./crypto\";\nexport function testHash() { return hashToken(\"ab\"); }\n",
    );
    write(
        d,
        "src/util/crypto.ts",
        "export function hashToken(t: string) { return salt(t) + t; }\nfunction salt(t: string) { return t.slice(0, 2); }\n// v2\n",
    );
    git(d, &["add", "-A"]);
    git(d, &["commit", "-qm", "test + crypto"]);
    write(
        d,
        "src/util/crypto.test.ts",
        "import { hashToken } from \"./crypto\";\nexport function testHash() { return hashToken(\"abc\"); }\n",
    );
    write(
        d,
        "src/util/crypto.ts",
        "export function hashToken(t: string) { return salt(t) + t; }\nfunction salt(t: string) { return t.slice(0, 3); }\n// v3\n",
    );
    git(d, &["commit", "-qam", "tweak both"]);
    kula(d, &["index"]);

    let b = kula_json(d, &["before", "salt"]);
    assert!(b["direct_callers"].as_array().unwrap().iter().any(|c| c.as_str().unwrap().starts_with("hashToken")));
    assert!(b["tests"].as_array().unwrap().iter().any(|c| c.as_str().unwrap().starts_with("testHash")), "{b}");
    let co = kula_json(d, &["before", "hashToken"]);
    assert!(co["co_changes"].as_array().unwrap().iter().any(|c| c[0] == "src/util/crypto.test.ts"), "{co}");

    // Clean tree: nothing moved.
    assert_eq!(kula_json(d, &["verify"])["ok"], true);
    // Delete salt but leave hashToken calling it: verify names the dangling caller and exits 2.
    write(d, "src/util/crypto.ts", "export function hashToken(t: string) { return salt(t) + t; }\n");
    let out = Command::new(KULA).arg("-C").arg(d).args(["--json", "verify"]).env("NO_COLOR", "1").output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert!(v["dangling"][0].as_str().unwrap().contains("hashToken"), "{v}");
    assert_eq!(v["dangling_refs"][0]["name"], "hashToken");
    assert_eq!(v["dangling_refs"][0]["path"], "src/util/crypto.ts");
    assert_eq!(v["dangling_refs"][0]["detail"], "salt");
    assert!(b["test_refs"].as_array().unwrap().iter().any(|t| t["name"] == "testHash" && t["line"] == 2), "{b}");
}

#[test]
fn mcp_lists_and_runs_the_agent_tools() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);
    let mut child = Command::new(KULA).arg("-C").arg(d).arg("mcp").stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
    {
        let stdin = child.stdin.as_mut().unwrap();
        writeln!(stdin, r#"{{"jsonrpc":"2.0","id":1,"method":"tools/list"}}"#).unwrap();
        writeln!(stdin, r#"{{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{{"name":"context_pack","arguments":{{"targets":["login"],"budget":2000}}}}}}"#).unwrap();
        writeln!(
            stdin,
            r#"{{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{{"name":"pre_edit","arguments":{{"symbol":"login"}}}}}}"#
        )
        .unwrap();
    }
    drop(child.stdin.take());
    let out = child.wait_with_output().unwrap();
    let lines: Vec<Value> = String::from_utf8_lossy(&out.stdout).lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    let names: Vec<&str> = lines[0]["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
    for n in ["context_pack", "pre_edit", "verify_edit"] {
        assert!(names.contains(&n), "{names:?}");
    }
    let pack = lines[1]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(pack.contains("\"why\": \"seed\"") || pack.contains("\"why\":\"seed\""), "{pack}");
    let pre = lines[2]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(pre.contains("handleLogin"), "{pre}");
}

/// Run kula expecting a given exit code; returns (stdout, stderr).
fn kula_code(dir: &Path, args: &[&str], stdin: Option<&str>, code: i32) -> (String, String) {
    let mut c = Command::new(KULA)
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("NO_COLOR", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    if let Some(s) = stdin {
        c.stdin.as_mut().unwrap().write_all(s.as_bytes()).unwrap();
    }
    drop(c.stdin.take());
    let out = c.wait_with_output().unwrap();
    let (so, se) = (String::from_utf8_lossy(&out.stdout).to_string(), String::from_utf8_lossy(&out.stderr).to_string());
    assert_eq!(out.status.code(), Some(code), "kula {args:?}\n{so}{se}");
    (so, se)
}

#[test]
fn every_language_parses_and_links_within_its_family() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git(d, &["init", "-q", "-b", "main"]);
    write(d, "j/App.java", "public class App { void run() { helper(); } static void helper() {} }\n");
    write(d, "c/m.c", "static int add(int a) { return a; }\nint main(void) { return add(1); }\n");
    write(d, "c/v.cpp", "class Box { public: int size() { return count(); } int count() { return 1; } };\n");
    write(d, "s/P.cs", "class P { void Main() { Run(); } void Run() {} }\n");
    write(d, "r/a.rb", "class Cart\n  def total; sum(1); end\n  def sum(x); x; end\nend\n");
    write(d, "p/a.php", "<?php\nfunction helper2($x) { return $x; }\nfunction find($id) { return helper2($id); }\n");
    // Same name, two languages: a TypeScript call must never land on the Rust definition.
    write(d, "web/a.ts", "export function confirmIt() { return 1; }\nexport function ui() { return confirmIt(); }\n");
    write(d, "core/a.rs", "pub fn confirmIt() -> u8 { 1 }\n");
    kula(d, &["index"]);
    for (callee, caller) in [("helper", "run"), ("add", "main"), ("count", "size"), ("Run", "Main"), ("sum", "total"), ("helper2", "find")]
    {
        let i = kula_json(d, &["impact", callee]);
        let names: Vec<&str> = i["hits"].as_array().unwrap().iter().map(|h| h["node"]["name"].as_str().unwrap()).collect();
        assert!(names.contains(&caller), "{caller} should call {callee}: {names:?}");
    }
    let rs = kula_json(d, &["impact", "core/a.rs:confirmIt"]);
    assert_eq!(rs["hits"].as_array().unwrap().len(), 0, "no cross-language callers: {rs}");
}

#[test]
fn a_repo_with_no_commits_is_current_once_indexed() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git(d, &["init", "-q", "-b", "trunk"]);
    write(d, "a.py", "def f():\n    return 1\n");
    kula(d, &["index", "-q"]);
    let s = kula_json(d, &["status"]);
    assert_eq!(s["index"], "current", "{s}");
    assert_eq!(s["branch"], "trunk");
}

#[test]
fn guards_tasks_and_the_agent_hook() {
    let t = fixture();
    let d = t.path();
    write(d, "migrations/001.sql", "create table t();\n");
    write(d, ".env", "KEY=1\n");
    write(d, "kula.toml", "[[guard]]\npaths = [\"migrations\"]\nlevel = \"locked\"\nreason = \"the DBA owns the schema\"\n\n[[guard]]\nsymbols = [\"hashToken\"]\nlevel = \"review\"\n");
    git(d, &["add", "-A"]);
    git(d, &["commit", "-qm", "guards"]);
    kula(d, &["index"]);

    let (_, err) = kula_code(d, &["guard", "check", "migrations/001.sql", "src/api/routes.ts"], None, 1);
    assert!(err.is_empty());
    let v = kula_json(d, &["guard", "list"]);
    assert_eq!(v["rules"].as_array().unwrap().len(), 2);

    let hook = |tool: &str, path: &str| format!(r#"{{"tool_name":"{tool}","tool_input":{{"file_path":"{path}"}}}}"#);
    let (_, why) = kula_code(d, &["guard", "hook"], Some(&hook("Edit", &d.join("migrations/001.sql").display().to_string())), 2);
    assert!(why.contains("the DBA owns the schema"), "{why}");
    kula_code(d, &["guard", "hook"], Some(&hook("Read", "migrations/001.sql")), 0);
    kula_code(d, &["guard", "hook"], Some(&hook("Read", ".env")), 2);
    kula_code(d, &["guard", "hook"], Some(&hook("Write", "src/api/routes.ts")), 0);
    kula_code(d, &["guard", "hook"], Some(r#"{"tool_name":"Bash","tool_input":{"command":"ls"}}"#), 0);

    // A task scoped to one symbol opens its file and nothing else.
    kula(d, &["task", "start", "speed up login", "--scope", "login"]);
    kula_code(d, &["guard", "hook"], Some(&hook("Edit", "src/auth/session.ts")), 0);
    let (_, why) = kula_code(d, &["guard", "hook"], Some(&hook("Edit", "src/api/routes.ts")), 2);
    assert!(why.contains("speed up login"), "{why}");
    kula(d, &["task", "done"]);
    kula_code(d, &["guard", "hook"], Some(&hook("Edit", "src/api/routes.ts")), 0);

    // pre_edit says so; the CI gate fails when locked code changes.
    let pe = kula_json(d, &["before", "hashToken"]);
    assert_eq!(pe["guard"]["level"], "review");
    write(d, "migrations/001.sql", "create table t(id int);\n");
    git(d, &["commit", "-qam", "schema"]);
    let (out, _) = kula_code(d, &["--json", "check", "--base", "HEAD~1"], None, 2);
    let r: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(r["guarded"][0][1], "locked", "{r}");
}

#[test]
fn memories_are_anchored_and_go_stale() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);
    kula(d, &["memory", "add", "salt", "salt must stay two characters: stored hashes depend on it", "--by", "agent:test"]);
    let near = kula_json(d, &["memory", "recall", "hashToken"]);
    assert_eq!(near[0]["via"], "callee", "{near}");
    assert_eq!(near[0]["stale"], false);
    write(
        d,
        "src/util/crypto.ts",
        "export function hashToken(t: string) { return salt(t) + t; }\nfunction salt(t: string) { return t.slice(0, 3); }\n",
    );
    let now = kula_json(d, &["memory", "recall", "salt"]);
    assert_eq!(now[0]["stale"], true, "{now}");
    let id = now[0]["id"].as_u64().unwrap().to_string();
    kula(d, &["memory", "confirm", &id]);
    assert_eq!(kula_json(d, &["memory", "recall", "salt"])[0]["stale"], false);
    let q = kula_json(d, &["memory", "recall", "--query", "stored hashes"]);
    assert_eq!(q.as_array().unwrap().len(), 1);
}

#[test]
fn the_knowledge_graph_is_rdf_and_answers_sparql() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);
    kula(d, &["note", "add", "symbol:salt", "keep it short"]);
    let ttl = kula(d, &["kg", "export", "-f", "ttl"]);
    assert!(ttl.contains("@prefix kula: <https://kula.dev/ns#>"));
    assert!(ttl.contains("<urn:kula:sym:src/util/crypto.ts#salt>"), "{}", &ttl[..ttl.len().min(2000)]);
    let jsonld = kula(d, &["kg", "export", "-f", "jsonld"]);
    assert!(serde_json::from_str::<Value>(&jsonld).is_ok());
    let r = kula_json(d, &["kg", "sparql", "SELECT ?caller WHERE { ?c kula:calls ?s . ?s kula:name \"salt\" . ?c kula:name ?caller }"]);
    assert_eq!(r["rows"][0]["caller"], "hashToken", "{r}");
    let r = kula_json(d, &["kg", "sparql", "ASK { ?n a kula:Note ; kula:about ?s . ?s kula:name \"salt\" }"]);
    assert_eq!(r["boolean"], true);
    let r = kula_json(d, &["kg", "sparql", "SELECT (COUNT(?s) AS ?n) WHERE { ?s a kula:Symbol }"]);
    assert!(r["rows"][0]["n"].as_i64().unwrap() >= 10, "{r}");
    // Read-only: updates are rejected.
    kula_code(d, &["kg", "sparql", "DELETE WHERE { ?s ?p ?o }"], None, 1);
}

#[test]
fn history_leaves_out_kulas_own_bookkeeping() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);
    kula(d, &["note", "add", "repo", "a note commits onto refs/kula/meta"]);
    let lg = kula(d, &["lg"]);
    assert!(!lg.contains("note #"), "{lg}");
}
