//! Runtime layers: dependencies and env vars, end to end through the real binary.

use serde_json::Value;
use std::path::Path;
use std::process::Command;

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

/// One file per framework, one manifest, one env key per language.
fn fixture() -> tempfile::TempDir {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git(d, &["init", "-q", "-b", "main"]);
    git(d, &["config", "user.name", "Tester"]);
    git(d, &["config", "user.email", "t@example.com"]);
    write(d, "package.json", "{\"dependencies\":{\"express\":\"4\",\"left-pad\":\"1\"}}");
    write(
        d,
        "server.ts",
        "import express from \"express\";\nexport function start() {\n  const port = process.env.PORT;\n  console.log(port);\n}\n",
    );
    write(d, "worker.py", "import os\n\ndef load():\n    return os.environ[\"API_KEY\"]\n");
    write(d, "main.rs", "fn boot() {\n    let token = std::env::var(\"TOKEN\");\n    println!(\"{token:?}\");\n}\n");
    write(d, "cmd/main.go", "package main\n\nimport \"os\"\n\nfunc main() {\n    region := os.Getenv(\"REGION\")\n    _ = region\n}\n");
    write(d, ".env.example", "SESSION_TTL=3600\n");
    t
}

#[test]
fn deps_reports_declared_used_and_unused() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);
    let deps = kula_json(d, &["deps"]);
    let get = |n: &str| deps.as_array().unwrap().iter().find(|x| x["name"] == n).cloned().unwrap_or(Value::Null);
    assert_eq!(get("express")["declared"], true);
    assert_eq!(get("express")["importers"], 1);
    assert_eq!(get("express")["ecosystem"], "npm");
    assert_eq!(get("left-pad")["declared"], true);
    assert_eq!(get("left-pad")["importers"], 0, "declared but never imported");
    let unused = kula_json(d, &["deps", "--unused"]);
    let names: Vec<&str> = unused.as_array().unwrap().iter().filter_map(|x| x["name"].as_str()).collect();
    assert_eq!(names, ["left-pad"], "only the unused dependency is flagged");
}

#[test]
fn env_reads_in_four_languages_plus_env_example() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);
    let read = |name: &str| {
        let r = kula_json(d, &["query", &format!("env:{name}")]);
        r.as_array().unwrap().to_vec()
    };
    // typescript
    let port = read("PORT");
    assert_eq!(port.len(), 1);
    assert_eq!(port[0]["file"], "server.ts");
    assert_eq!(port[0]["symbol"], "start");
    assert_eq!(port[0]["line"], 3);
    // python
    let key = read("API_KEY");
    assert_eq!(key.len(), 1);
    assert_eq!(key[0]["file"], "worker.py");
    assert_eq!(key[0]["symbol"], "load");
    assert_eq!(key[0]["line"], 4);
    // rust
    let token = read("TOKEN");
    assert_eq!(token.len(), 1);
    assert_eq!(token[0]["file"], "main.rs");
    assert_eq!(token[0]["symbol"], "boot");
    assert_eq!(token[0]["line"], 2);
    // go
    let region = read("REGION");
    assert_eq!(region.len(), 1);
    assert_eq!(region[0]["file"], "cmd/main.go");
    assert_eq!(region[0]["symbol"], "main");
    assert_eq!(region[0]["line"], 6);
    // .env.example keys are readers themselves
    let ttl = read("SESSION_TTL");
    assert_eq!(ttl.len(), 1);
    assert_eq!(ttl[0]["file"], ".env.example");
    assert_eq!(ttl[0]["symbol"], Value::Null);
    assert_eq!(ttl[0]["line"], 1);
    // nothing reads a key nobody mentioned
    assert!(read("NOPE").is_empty());
}

/// One route per framework plus a TS client calling the Python API.
fn routes_fixture() -> tempfile::TempDir {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git(d, &["init", "-q", "-b", "main"]);
    write(d, "server.ts", "const app = express();\napp.get(\"/users\", listUsers);\nfunction listUsers(req, res) {\n  res.send([]);\n}\n");
    write(d, "api.py", "from fastapi import FastAPI\napp = FastAPI()\n\n@app.get(\"/items/{id}\")\ndef get_item(id):\n    return id\n");
    write(d, "legacy.py", "from flask import Flask\napp = Flask(__name__)\n\n@app.route(\"/ping\")\ndef ping():\n    return \"ok\"\n");
    write(
        d,
        "main.rs",
        "fn app() -> Router {\n    Router::new().route(\"/health\", get(health))\n}\nasync fn health() -> &'static str {\n    \"ok\"\n}\n",
    );
    write(d, "work.go", "package main\n\nimport \"net/http\"\n\nfunc workHandler(w http.ResponseWriter, r *http.Request) {}\n\nfunc main() {\n\thttp.HandleFunc(\"/work\", workHandler)\n}\n");
    write(d, "app/api/orders/route.ts", "export async function GET() {\n  return Response.json([]);\n}\n");
    write(d, "client.ts", "export async function loadItem() {\n  return fetch(\"/items/7\");\n}\n");
    t
}

#[test]
fn routes_found_per_framework_with_handlers() {
    let t = routes_fixture();
    let d = t.path();
    kula(d, &["index"]);
    let rows = kula_json(d, &["query", "route:"]);
    let rows = rows.as_array().expect("route rows");
    let find = |needle: &str| rows.iter().find(|r| r["route"].as_str().unwrap_or("").contains(needle)).cloned();
    for (path, handler) in [
        ("/users", "listUsers"),
        ("/items/:param", "get_item"),
        ("/ping", "ping"),
        ("/health", "health"),
        ("/work", "workHandler"),
        ("/api/orders", "GET"),
    ] {
        let r = find(path).unwrap_or_else(|| panic!("route {path} missing: {rows:?}"));
        assert_eq!(r["handler"].as_str(), Some(handler), "handler for {path}: {r}");
    }
    let only = kula_json(d, &["query", "route:/items"]);
    assert_eq!(only.as_array().unwrap().len(), 1, "prefix filter: {only}");
}

#[test]
fn ts_fetch_links_to_python_handler_as_inferred() {
    let t = routes_fixture();
    let d = t.path();
    kula(d, &["index"]);
    let c = kula_json(d, &["context", "api.py:get_item"]);
    let callers: Vec<&str> = c["callers"].as_array().unwrap().iter().map(|n| n["name"].as_str().unwrap_or("")).collect();
    assert!(callers.contains(&"loadItem"), "get_item callers: {callers:?}");
    // A resolved-only impact must not include the cross-language guess.
    let imp = kula_json(d, &["impact", "api.py:get_item", "--depth", "4", "--min-confidence", "resolved"]);
    assert!(!imp.to_string().contains("loadItem"), "inferred link leaked into resolved impact: {imp}");
}

#[test]
fn kg_export_counts_routes_and_parses() {
    let t = routes_fixture();
    let d = t.path();
    kula(d, &["index"]);
    let n_routes = kula_json(d, &["query", "route:"]).as_array().unwrap().len();
    let q = kula_json(d, &["kg", "sparql", "SELECT (COUNT(?r) AS ?n) WHERE { ?r a kula:Route }"]);
    assert!(
        q.to_string().contains(&format!("\"{n_routes}\"")) || q.to_string().contains(&format!(":{n_routes}")),
        "sparql count {q} vs {n_routes}"
    );
    let h = kula_json(d, &["kg", "sparql", "SELECT ?r ?f WHERE { ?r kula:handles ?f }"]);
    assert!(h.to_string().contains("get_item"), "handles triples: {h}");
    let ttl = kula(d, &["kg", "export", "--format", "nt"]);
    let lines = ttl.lines().filter(|l| !l.trim().is_empty()).count();
    assert!(lines > 10, "nt export too small: {lines}");
    assert!(ttl.lines().all(|l| l.trim().is_empty() || l.trim_end().ends_with('.')), "malformed n-triples");
}

#[test]
fn tables_link_models_to_handlers_for_impact() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git(d, &["init", "-q", "-b", "main"]);
    write(d, "models.py", "from sqlalchemy.orm import declarative_base\nBase = declarative_base()\n\nclass User(Base):\n    __tablename__ = \"users\"\n    id = 1\n");
    write(d, "handlers.py", "from models import User\n\ndef list_users(session):\n    return session.query(User).all()\n\ndef route():\n    return list_users(None)\n");
    write(d, "migrations/001.sql", "CREATE TABLE IF NOT EXISTS public.\"orders\" (id int);\n");
    write(d, "report.py", "def totals(db):\n    return db.execute(\"select * from orders\")\n");
    kula(d, &["index"]);
    let users = kula_json(d, &["query", "table:users"]).to_string();
    assert!(users.contains("models.py") && users.contains("list_users"), "table users: {users}");
    let orders = kula_json(d, &["query", "table:orders"]).to_string();
    assert!(orders.contains("001.sql") && orders.contains("totals"), "table orders: {orders}");
    let imp = kula_json(d, &["impact", "table:users", "--depth", "3"]).to_string();
    assert!(imp.contains("list_users") && imp.contains("route"), "table impact: {imp}");
    let q = kula_json(d, &["kg", "sparql", "SELECT ?t WHERE { ?t a kula:Table }"]).to_string();
    assert!(q.contains("users") && q.contains("orders"), "kg tables: {q}");
}
