//! Minimal MCP server over stdio (JSON-RPC 2.0, newline-delimited).
//! Gives Claude Code, Cursor, Codex & co. the knowledge graph as tools.

use crate::git::Repo;
use crate::graph;
use crate::guard::Guards;
use crate::store::{Node, Store};
use anyhow::{bail, Result};
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
        { "name": "graph_diff", "description": "Contrast the knowledge graphs of two revisions (head may be WORKTREE): symbols added/removed/modified and call edges gained/lost.",
          "inputSchema": s(json!({ "base": { "type": "string" }, "head": { "type": "string" } }), &["base"]) },
        { "name": "isolate", "description": "Isolate part of the codebase: only the symbols a selector picks, the edges among them, and the boundary – who calls in and what it calls out, with counts. Selectors (unioned): a path glob (src/auth/**), cluster:<id|label>, symbol:<name>[~hops], diff:<base>[..head] for what a branch touches, or @<name> for a scope saved in kula.toml. Use it to understand a subsystem's surface before changing it.",
          "inputSchema": s(json!({ "select": { "type": "array", "items": { "type": "string" } }, "hops": { "type": "integer", "description": "neighbourhood for symbol selectors without ~N (default 1)" }, "limit": { "type": "integer", "description": "max nodes and peers listed (default 200)" } }), &["select"]) },
        { "name": "flows", "description": "Execution flows reachable from entry points.",
          "inputSchema": s(json!({ "limit": { "type": "integer" } }), &[]) },
        { "name": "notes", "description": "Human notes and annotations attached to the repo, files and symbols.",
          "inputSchema": s(json!({ "target": { "type": "string" } }), &[]) },
        { "name": "issues", "description": "Local issues and proposals tracked in git.",
          "inputSchema": s(json!({}), &[]) },
        { "name": "context_pack", "description": "The code you need for a task, not whole files: give symbols, files or a plain-language question; get their definitions plus what they use, who uses them, containers and tests, ranked by graph distance and fitted to a token budget (big bodies shrink to signatures). Use it before reading files.",
          "inputSchema": s(json!({ "targets": { "type": "array", "items": { "type": "string" }, "description": "symbol names, path:name, file paths, or a question" }, "budget": { "type": "integer", "description": "token budget (default 6000)" } }), &["targets"]) },
        { "name": "pre_edit", "description": "Call before changing a symbol: direct callers, total dependents and risk, the tests that reach it through the call graph, files that historically change with it, human notes, and concrete advice.",
          "inputSchema": s(json!({ "symbol": { "type": "string" } }), &["symbol"]) },
        { "name": "verify_edit", "description": "Call after editing: the working tree against HEAD through the graph – symbols added/removed/modified, callers left pointing at removed code (dangling), callers of modified symbols in other files to re-check, and edits to code you may not change (guard_violations). ok=false means something is broken or fenced.",
          "inputSchema": s(json!({}), &[]) },
        { "name": "guards", "description": "What you may change. Lists the repository's guard rules (locked: read only; hidden: never shown to you; review: a person reviews it), the active task and its scope, and – given paths – the verdict for each. Check before editing files you have not been asked to touch.",
          "inputSchema": s(json!({ "paths": { "type": "array", "items": { "type": "string" } } }), &[]) },
        { "name": "remember", "description": "Save a durable fact about this code for future sessions: why something is the way it is, a pitfall, a flaky test, a decision. Pin it to a symbol, a file (file:<path>) or `repo`. It is stored in git with the code and marked stale when that code changes. One fact per memory, at most 2000 characters; never secrets.",
          "inputSchema": s(json!({ "target": { "type": "string", "description": "symbol name, path:name, file:<path>, or repo" }, "text": { "type": "string" } }), &["target", "text"]) },
        { "name": "recall", "description": "Memories about a symbol, file or the repo – its own, its file's, its callers' and callees' – or matching a query. stale=true means the code changed after the memory was written: verify before relying on it.",
          "inputSchema": s(json!({ "target": { "type": "string" }, "query": { "type": "string" }, "limit": { "type": "integer" } }), &[]) },
        { "name": "sparql", "description": "Ask the knowledge graph anything in SPARQL 1.1 (read only). Prefixes kula: (vocabulary), code: (urn:kula: instances), rdf:, rdfs:, xsd: are predeclared. Classes: kula:Symbol (with subclasses Function, Method, Class, Interface), File, Package, Cluster, Note, Memory, Issue, Guard. Properties: name, path, language, startLine, endLine, definedIn, memberOf, calls, imports, inCluster, about, body, author, created, stale, status, guardLevel, reason, fences. Example: SELECT ?name (COUNT(?c) AS ?n) WHERE { ?s a kula:Function ; kula:name ?name . ?c kula:calls ?s } GROUP BY ?name ORDER BY DESC(?n) LIMIT 10",
          "inputSchema": s(json!({ "query": { "type": "string" }, "limit": { "type": "integer", "description": "max rows (default 200)" } }), &["query"]) },
        { "name": "workflows", "description": "How work is done here. Lists the workflows (explore, fix, refactor, tests, docs, autoresearch and the repository's own); when a team is at work, your place in it – your workflow, who you answer to, who you hand off to – and your full instructions: each has its own fences, default scope, memory policy, the steps to follow and the docs to read first. Returns the active task's workflow in full. Call it at the start of a task.",
          "inputSchema": s(json!({}), &[]) },
        { "name": "start_task", "description": "Declare what you are doing, optionally in a workflow; its fences then apply to you. Only when no task is active – you cannot replace a task a person started.",
          "inputSchema": s(json!({ "title": { "type": "string" }, "workflow": { "type": "string" }, "scope": { "type": "array", "items": { "type": "string" }, "description": "globs or symbol names; defaults to the workflow's scope" } }), &["title"]) },
        { "name": "finish_task", "description": "Finish the task you started with start_task and lift its fences.",
          "inputSchema": s(json!({}), &[]) },
        { "name": "update_memory", "description": "Maintain a memory: rewrite its text, move it to another target, confirm it still holds after the code changed (still_true), or flag it stale. Agents may change memories agents wrote.",
          "inputSchema": s(json!({ "id": { "type": "integer" }, "text": { "type": "string" }, "target": { "type": "string" }, "still_true": { "type": "boolean" }, "stale": { "type": "boolean" } }), &["id"]) },
        { "name": "research", "description": "The autoresearch run: the metric kula measures, which way is better, the baseline, the best so far, the budget left, the scope you may change, and every experiment tried with its result. Read it before forming a hypothesis, so you don't repeat what failed.",
          "inputSchema": s(json!({}), &[]) },
        { "name": "experiment", "description": "Run one autoresearch experiment: your working-tree change, in scope, is the experiment. kula checks it against the fences, runs the metric itself, commits the change if the number improved and reverts it if not. Give a one-line hypothesis; one idea per experiment.",
          "inputSchema": s(json!({ "hypothesis": { "type": "string" } }), &["hypothesis"]) },
        { "name": "suggest", "description": "Propose a new fence or workflow for this repository; a person accepts or dismisses it. Use it when you notice code that should not be changed casually (generated files, migrations, vendored code), or a repeatable way of working.",
          "inputSchema": s(json!({ "kind": { "type": "string", "enum": ["guard", "workflow"] }, "why": { "type": "string" },
            "guard": { "type": "object", "properties": { "paths": { "type": "array", "items": { "type": "string" } }, "symbols": { "type": "array", "items": { "type": "string" } }, "level": { "type": "string", "enum": ["locked", "hidden", "review"] }, "reason": { "type": "string" } } },
            "workflow": { "type": "object", "properties": { "name": { "type": "string" }, "about": { "type": "string" }, "scope": { "type": "array", "items": { "type": "string" } }, "lock": { "type": "array", "items": { "type": "string" } }, "hide": { "type": "array", "items": { "type": "string" } }, "review": { "type": "array", "items": { "type": "string" } }, "memory": { "type": "string", "enum": ["write", "read", "off"] }, "steps": { "type": "array", "items": { "type": "string" } }, "docs": { "type": "array", "items": { "type": "string" } } } } }), &["kind", "why"]) }
    ])
}

/// Who is calling, from the MCP handshake: memories are signed `agent:<client>`.
static CLIENT: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// Hidden code never reaches an agent: drop it from lists, refuse it by name.
fn visible(g: &Guards, nodes: Vec<Node>) -> Vec<Node> {
    nodes.into_iter().filter(|n| g.node(n).level.readable()).collect()
}

fn refuse_hidden(g: &Guards, n: &Node) -> Result<()> {
    let v = g.node(n);
    if !v.level.readable() {
        bail!("{} is hidden from agents: {} ({})", n.name, v.reason, v.rule);
    }
    Ok(())
}

fn agent() -> String {
    format!("agent:{}", CLIENT.get().map(String::as_str).unwrap_or("mcp"))
}

/// kula.toml's [agents] memory switch, then the active workflow's policy.
fn memory_allowed(repo: &Repo, g: &Guards, write: bool) -> Result<()> {
    if !crate::config::Config::load(&repo.root)?.agents.memory {
        bail!("agent memory is off in kula.toml ([agents] memory = false)");
    }
    if let Some(w) = g.workflow() {
        match w.memory_policy() {
            "off" => bail!("the {} workflow keeps memory off", w.name),
            "read" if write => bail!("the {} workflow lets you recall memories, not write them", w.name),
            _ => {}
        }
    }
    Ok(())
}

fn call(repo: &Repo, name: &str, a: &Value) -> Result<Value> {
    let st = || Store::open(repo);
    let g = Guards::for_agent(repo, CLIENT.get().map(String::as_str))?;
    let str_arg = |k: &str| a.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let int_arg = |k: &str, d: usize| a.get(k).and_then(|v| v.as_u64()).map(|v| v as usize).unwrap_or(d);
    Ok(match name {
        "query" => json!(visible(&g, st()?.search(&str_arg("text"), int_arg("limit", 20))?)),
        "context" => {
            let s = st()?;
            let n = graph::resolve_one(&s, &str_arg("symbol"))?;
            refuse_hidden(&g, &n)?;
            let mut c = graph::context(repo, &s, n.id)?;
            for list in [&mut c.callers, &mut c.callees, &mut c.children, &mut c.imports, &mut c.imported_by] {
                *list = visible(&g, std::mem::take(list));
            }
            let v = g.node(&c.node);
            let mut out = json!(c);
            out["guard"] = json!(v);
            out
        }
        "impact" => {
            let s = st()?;
            let n = graph::resolve_one(&s, &str_arg("symbol"))?;
            refuse_hidden(&g, &n)?;
            let mut i = graph::impact(&s, n.id, str_arg("direction") != "downstream", int_arg("depth", 3))?;
            i.hits.retain(|h| g.node(&h.node).level.readable());
            json!(i)
        }
        "isolate" => {
            let sel: Vec<String> = match a.get("select") {
                Some(Value::String(x)) => vec![x.clone()],
                Some(Value::Array(v)) => v.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
                _ => vec![],
            };
            let mut sl = crate::isolate::isolate(repo, &st()?, &sel, int_arg("hops", 1))?;
            let limit = int_arg("limit", 200);
            sl.nodes = visible(&g, std::mem::take(&mut sl.nodes));
            let seen: std::collections::HashSet<i64> = sl.nodes.iter().map(|n| n.id).collect();
            sl.edges.retain(|e| seen.contains(&e.src) && seen.contains(&e.dst));
            for list in [&mut sl.inbound, &mut sl.outbound] {
                list.retain(|p| g.node(&p.node).level.readable());
                list.truncate(limit);
            }
            sl.boundary.clear(); // drawing data; the peers say the same
            sl.files.retain(|f| g.path(f).level.readable());
            sl.nodes.truncate(limit);
            json!(sl)
        }
        "trace" => {
            let s = st()?;
            let x = graph::resolve_one(&s, &str_arg("from"))?;
            let y = graph::resolve_one(&s, &str_arg("to"))?;
            refuse_hidden(&g, &x)?;
            refuse_hidden(&g, &y)?;
            json!(graph::trace(&s, x.id, y.id)?)
        }
        "compare" => {
            let head = a.get("head").and_then(|v| v.as_str()).map(String::from).unwrap_or_else(|| repo.branch());
            json!(graph::compare(repo, st().ok().as_ref(), &str_arg("base"), &head)?)
        }
        "graph_diff" => {
            let head = a.get("head").and_then(|v| v.as_str()).map(String::from).unwrap_or_else(|| repo.branch());
            let b = crate::index::snapshot_any(repo, &str_arg("base"))?;
            let h = crate::index::snapshot_any(repo, &head)?;
            let d = graph::graph_diff(&b, &h, &str_arg("base"), &head, Some(true));
            // Agents only need what changed.
            let changed: Vec<_> = d.nodes.iter().filter(|n| n.status != "same").collect();
            json!({ "summary": d.summary, "changed": changed })
        }
        "flows" => json!(graph::flows(&st()?, int_arg("limit", 10))?),
        "notes" => {
            let t = str_arg("target");
            let m = crate::meta::load(repo)?;
            let hidden = |target: &str| target.strip_prefix("file:").is_some_and(|p| !g.path(p).level.readable());
            json!(m
                .notes
                .into_iter()
                .filter(|n| n.kind.is_empty() && !hidden(&n.target) && (t.is_empty() || n.target.contains(&t)))
                .collect::<Vec<_>>())
        }
        "issues" => {
            let m = crate::meta::load(repo)?;
            json!({ "issues": m.issues, "proposals": m.proposals })
        }
        "context_pack" => {
            let targets: Vec<String> = a
                .get("targets")
                .and_then(|v| v.as_array())
                .map(|v| v.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let mut p = crate::agent::context_pack(repo, &st()?, &targets, int_arg("budget", 6000))?;
            let before = p.items.len();
            p.items.retain(|i| g.path(&i.path).level.readable());
            let mut out = json!(p);
            if p.items.len() < before {
                out["withheld"] = json!(format!("{} item(s) hidden by kula.toml guards", before - p.items.len()));
            }
            out
        }
        "pre_edit" => {
            let s = st()?;
            refuse_hidden(&g, &graph::resolve_one(&s, &str_arg("symbol"))?)?;
            json!(crate::agent::pre_edit(repo, &s, &str_arg("symbol"))?)
        }
        "verify_edit" => json!(crate::agent::verify_edit(repo, CLIENT.get().map(String::as_str))?),
        "guards" => {
            let paths: Vec<String> = a
                .get("paths")
                .and_then(|v| v.as_array())
                .map(|v| v.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let s = st().ok();
            let rules: Vec<Value> = g
                .rules()
                .into_iter()
                .map(|(r, l)| json!({ "level": l, "paths": r.paths, "symbols": r.symbols, "reason": r.reason }))
                .collect();
            let verdicts: Vec<Value> = paths.iter().map(|p| json!({ "path": p, "verdict": g.edit(s.as_ref(), p) })).collect();
            let wf_rules: Vec<Value> = g
                .workflow_rules()
                .into_iter()
                .map(|(r, l)| json!({ "level": l, "paths": r.paths, "symbols": r.symbols, "reason": r.reason }))
                .collect();
            json!({ "rules": rules, "task": g.task(), "workflow": g.workflow(), "workflow_rules": wf_rules, "secrets_hidden": crate::config::Config::load(&repo.root)?.agents.hide_secrets, "verdicts": verdicts })
        }
        "remember" => {
            memory_allowed(repo, &g, true)?;
            json!(crate::memory::remember(repo, &st()?, &str_arg("target"), &str_arg("text"), &agent())?)
        }
        "workflows" => {
            let cfg = crate::config::Config::load(&repo.root)?;
            let list: Vec<Value> = crate::workflow::all(&cfg)
                .into_iter()
                .map(|w| json!({ "name": w.name, "about": w.about, "builtin": w.builtin, "research": w.research.is_some() }))
                .collect();
            let team = CLIENT.get().and_then(|c| crate::guard::member(repo, &cfg, c)).map(|(t, m)| {
                let team = cfg.teams.iter().find(|x| x.name == t);
                json!({ "team": t, "you": m, "members": team.map(|x| &x.members), "instructions": team.map(|x| crate::agents::team_prompt(&cfg, x, &m)) })
            });
            json!({ "workflows": list, "task": g.task(), "active": g.workflow(), "team": team, "docs": crate::agents::docs(repo)?.into_iter().filter(|d| d.exists).map(|d| d.path).collect::<Vec<_>>() })
        }
        "start_task" => {
            if let Some(t) = g.task() {
                bail!("a task is already active: \"{}\" (started by {}). Work inside it, or ask the user to finish it.", t.title, t.by);
            }
            let scope: Vec<String> = a
                .get("scope")
                .and_then(|v| v.as_array())
                .map(|v| v.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let wf = str_arg("workflow");
            let t = crate::guard::task_start(repo, &str_arg("title"), scope, (!wf.is_empty()).then_some(wf.as_str()), &agent())?;
            let g = Guards::for_agent(repo, CLIENT.get().map(String::as_str))?;
            json!({ "task": t, "workflow": g.workflow() })
        }
        "finish_task" => match g.task() {
            Some(t) if t.by.starts_with("agent:") => json!({ "finished": crate::guard::task_done(repo)? }),
            Some(t) => bail!("{} started this task; only a person can finish it", t.by),
            None => bail!("no active task"),
        },
        "update_memory" => {
            memory_allowed(repo, &g, true)?;
            let id = a.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
            let m = crate::meta::load(repo)?;
            let Some(n) = m.notes.iter().find(|n| n.id == id && n.kind == "memory") else { bail!("no memory #{id}") };
            if !n.author.starts_with("agent:") {
                bail!("memory #{id} was written by {}; agents may change only agents' memories – suggest the change to the user", n.author);
            }
            let s = st()?;
            let flag = |k: &str| a.get(k).and_then(|v| v.as_bool()).unwrap_or(false);
            let text = str_arg("text");
            let target = str_arg("target");
            let mut out = json!(null);
            if !text.is_empty() || !target.is_empty() {
                out = json!(crate::memory::edit(
                    repo,
                    &s,
                    id,
                    (!text.is_empty()).then_some(text.as_str()),
                    (!target.is_empty()).then_some(target.as_str())
                )?);
            }
            if flag("still_true") {
                out = json!(crate::memory::confirm(repo, &s, id)?);
            }
            if flag("stale") {
                out = json!(crate::memory::mark_stale(repo, id)?);
            }
            if out.is_null() {
                bail!("give text, target, still_true or stale");
            }
            out
        }
        "research" => {
            let cur = crate::research::active(repo).or_else(|| crate::research::list(repo).into_iter().next());
            match cur {
                Some(st) => {
                    let w = crate::workflow::find(&crate::config::Config::load(&repo.root)?, &st.workflow);
                    json!({ "run": st, "gain": st.gain(), "left": st.left(), "scope": w.map(|w| w.scope).unwrap_or_default() })
                }
                None => {
                    json!({ "run": null, "hint": "no research yet – a person sets one up: `kula research init --metric \"<command>\"`, then `kula research start`" })
                }
            }
        }
        "experiment" => json!(crate::research::experiment(repo, &str_arg("hypothesis"), &agent())?),
        "suggest" => {
            let sug: crate::agents::Suggestion = serde_json::from_value(a.clone())?;
            json!(crate::agents::suggest(repo, sug, &agent())?)
        }
        "recall" => {
            memory_allowed(repo, &g, false)?;
            let t = str_arg("target");
            let q = str_arg("query");
            json!(crate::memory::recall(
                repo,
                &st()?,
                (!t.is_empty()).then_some(t.as_str()),
                (!q.is_empty()).then_some(q.as_str()),
                int_arg("limit", 20)
            )?)
        }
        "sparql" => crate::kg::sparql(repo, &st()?, &str_arg("query"), int_arg("limit", 200).min(2000))?,
        _ => anyhow::bail!("unknown tool {name}"),
    })
}

pub fn handle(repo: &Repo, msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned();
    let method = msg.get("method")?.as_str()?;
    let result = match method {
        "initialize" => {
            if let Some(c) = msg.pointer("/params/clientInfo/name").and_then(|v| v.as_str()) {
                let _ = CLIENT.set(c.chars().filter(|c| c.is_alphanumeric() || "-_.".contains(*c)).take(40).collect());
            }
            Ok(json!({
            "protocolVersion": msg.pointer("/params/protocolVersion").cloned().unwrap_or(json!("2025-06-18")),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "kula", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Kula is a knowledge graph of this repository. Before reading files, use `context_pack` for the code a task needs. Before changing a symbol, call `pre_edit` (callers, tests, risk, guards, memories); after editing, call `verify_edit`. Call `workflows` at the start: the active task's workflow says how this kind of work is done here (its steps, docs and fences). Call `guards` to learn what you may change: locked code is read-only for you, hidden code is never shown, and an active task limits you to its scope. If none is active, declare yours with `start_task`. Propose fences or workflows with `suggest`; a person decides. Use `remember` for facts worth keeping about this code and `recall` to read them; stale memories describe code that has since changed. `sparql` answers structural questions over the whole graph."
            }))
        }
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
