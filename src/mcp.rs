//! Minimal MCP server over stdio (JSON-RPC 2.0, newline-delimited).
//! Gives Claude Code, Cursor, Codex & co. the knowledge graph as tools.

use crate::git::Repo;
use crate::graph;
use crate::store::Store;
use anyhow::Result;
use serde_json::{json, Value};
use std::io::{BufRead, Write};

fn tools() -> Value {
    let s = |props: Value, req: &[&str]| json!({ "type": "object", "properties": props, "required": req });
    json!([
        { "name": "query", "description": "Search the codebase knowledge graph for symbols and files by name or concept.",
          "inputSchema": s(json!({ "text": { "type": "string" }, "limit": { "type": "integer" } }), &["text"]) },
        { "name": "context", "description": "360° view of a symbol: callers, callees, container, cluster, source snippet and notes.",
          "inputSchema": s(json!({ "symbol": { "type": "string", "description": "name, path:name, or node id" } }), &["symbol"]) },
        { "name": "impact", "description": "Blast radius of changing a symbol. direction=upstream (dependents, default) or downstream.",
          "inputSchema": s(json!({ "symbol": { "type": "string" }, "direction": { "type": "string", "enum": ["upstream", "downstream"] }, "depth": { "type": "integer" } }), &["symbol"]) },
        { "name": "trace", "description": "Shortest call path between two symbols.",
          "inputSchema": s(json!({ "from": { "type": "string" }, "to": { "type": "string" } }), &["from", "to"]) },
        { "name": "compare", "description": "Graph-aware diff between two revisions: changed symbols and what they ripple into.",
          "inputSchema": s(json!({ "base": { "type": "string" }, "head": { "type": "string" } }), &["base"]) },
        { "name": "flows", "description": "Execution flows reachable from entry points.",
          "inputSchema": s(json!({ "limit": { "type": "integer" } }), &[]) },
        { "name": "notes", "description": "Human notes and annotations attached to the repo, files and symbols.",
          "inputSchema": s(json!({ "target": { "type": "string" } }), &[]) },
        { "name": "issues", "description": "Local issues and proposals tracked in git.",
          "inputSchema": s(json!({}), &[]) }
    ])
}

fn call(repo: &Repo, name: &str, a: &Value) -> Result<Value> {
    let st = || Store::open(repo);
    let str_arg = |k: &str| a.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let int_arg = |k: &str, d: usize| a.get(k).and_then(|v| v.as_u64()).map(|v| v as usize).unwrap_or(d);
    Ok(match name {
        "query" => json!(st()?.search(&str_arg("text"), int_arg("limit", 20))?),
        "context" => {
            let s = st()?;
            let n = graph::resolve_one(&s, &str_arg("symbol"))?;
            json!(graph::context(repo, &s, n.id)?)
        }
        "impact" => {
            let s = st()?;
            let n = graph::resolve_one(&s, &str_arg("symbol"))?;
            json!(graph::impact(&s, n.id, str_arg("direction") != "downstream", int_arg("depth", 3))?)
        }
        "trace" => {
            let s = st()?;
            let x = graph::resolve_one(&s, &str_arg("from"))?;
            let y = graph::resolve_one(&s, &str_arg("to"))?;
            json!(graph::trace(&s, x.id, y.id)?)
        }
        "compare" => {
            let head = a.get("head").and_then(|v| v.as_str()).map(String::from).unwrap_or_else(|| repo.branch());
            json!(graph::compare(repo, st().ok().as_ref(), &str_arg("base"), &head)?)
        }
        "flows" => json!(graph::flows(&st()?, int_arg("limit", 10))?),
        "notes" => {
            let t = str_arg("target");
            let m = crate::meta::load(repo)?;
            json!(m.notes.into_iter().filter(|n| t.is_empty() || n.target.contains(&t)).collect::<Vec<_>>())
        }
        "issues" => {
            let m = crate::meta::load(repo)?;
            json!({ "issues": m.issues, "proposals": m.proposals })
        }
        _ => anyhow::bail!("unknown tool {name}"),
    })
}

pub fn handle(repo: &Repo, msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned();
    let method = msg.get("method")?.as_str()?;
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": msg.pointer("/params/protocolVersion").cloned().unwrap_or(json!("2025-06-18")),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "kula", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Kula exposes a knowledge graph of this repository. Use `impact` before editing a symbol, `context` to understand it, and `compare` to review a branch."
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => {
            let name = msg.pointer("/params/name").and_then(|v| v.as_str()).unwrap_or("");
            let args = msg.pointer("/params/arguments").cloned().unwrap_or(json!({}));
            Ok(match call(repo, name, &args) {
                Ok(v) => json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&v).unwrap_or_default() }] }),
                Err(e) => json!({ "content": [{ "type": "text", "text": format!("error: {e:#}") }], "isError": true }),
            })
        }
        _ if id.is_none() => return None, // notifications
        _ => Err(json!({ "code": -32601, "message": format!("method not found: {method}") })),
    };
    let id = id?;
    Some(match result {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err(e) => json!({ "jsonrpc": "2.0", "id": id, "error": e }),
    })
}

pub fn run(repo: Repo) -> Result<()> {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(msg) => handle(&repo, &msg),
            Err(e) => Some(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": e.to_string() } })),
        };
        if let Some(r) = reply {
            writeln!(stdout, "{r}")?;
            stdout.flush()?;
        }
    }
    Ok(())
}
