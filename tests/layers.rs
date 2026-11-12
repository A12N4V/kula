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
    write(
        d,
        "worker.py",
        "import os\n\ndef load():\n    return os.environ[\"API_KEY\"]\n",
    );
    write(
        d,
        "main.rs",
        "fn boot() {\n    let token = std::env::var(\"TOKEN\");\n    println!(\"{token:?}\");\n}\n",
    );
    write(
        d,
        "cmd/main.go",
        "package main\n\nimport \"os\"\n\nfunc main() {\n    region := os.Getenv(\"REGION\")\n    _ = region\n}\n",
    );
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
