//! `kula view` – local HTTP server with the embedded web UI.
//!
//! Security model: binds to 127.0.0.1 only, rejects non-localhost Host headers
//! (DNS rebinding) and requires a per-session token that is injected into the
//! served page, so other websites cannot drive your repository.

use crate::git::{validate_rev, Repo};
use crate::{graph, index, meta, store::Store};
use anyhow::anyhow;
use axum::{
    body::Body,
    extract::{Path, Query, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rust_embed::RustEmbed;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(RustEmbed)]
#[folder = "web/dist"]
struct Assets;

#[derive(Clone)]
struct AppState {
    repo: Repo,
    token: Arc<String>,
    /// Revision graphs by commit sha, for fast repeated branch contrasts.
    snapshots: Arc<std::sync::Mutex<HashMap<String, Arc<index::Built>>>>,
}

impl AppState {
    fn snapshot(&self, rev: &str) -> anyhow::Result<(String, Arc<index::Built>)> {
        if rev.eq_ignore_ascii_case("worktree") {
            return Ok(("WORKTREE".into(), Arc::new(index::worktree(&self.repo))));
        }
        validate_rev(rev)?;
        let sha = self.repo.run(&["rev-parse", "--verify", &format!("{rev}^{{commit}}")])?.trim().to_string();
        if let Some(b) = self.snapshots.lock().unwrap().get(&sha) {
            return Ok((sha, b.clone()));
        }
        let built = Arc::new(index::snapshot(&self.repo, &sha)?);
        let mut cache = self.snapshots.lock().unwrap();
        if cache.len() >= 8 {
            cache.clear();
        }
        cache.insert(sha.clone(), built.clone());
        Ok((sha, built))
    }
}

struct ApiErr(anyhow::Error);
impl IntoResponse for ApiErr {
    fn into_response(self) -> Response {
        (StatusCode::BAD_REQUEST, Json(json!({ "error": format!("{:#}", self.0) }))).into_response()
    }
}
impl<E: Into<anyhow::Error>> From<E> for ApiErr {
    fn from(e: E) -> Self {
        ApiErr(e.into())
    }
}
type ApiResult = Result<Json<Value>, ApiErr>;

/// Run blocking repository work off the async executor.
async fn blocking<F>(f: F) -> ApiResult
where
    F: FnOnce() -> anyhow::Result<Value> + Send + 'static,
{
    let v = tokio::task::spawn_blocking(f).await.map_err(|e| anyhow!(e))??;
    Ok(Json(v))
}

fn random_token() -> String {
    let mut buf = [0u8; 16];
    let ok = std::fs::File::open("/dev/urandom").and_then(|mut f| std::io::Read::read_exact(&mut f, &mut buf)).is_ok();
    if !ok {
        use std::hash::{BuildHasher, Hasher};
        for chunk in buf.chunks_mut(8) {
            let mut h = std::collections::hash_map::RandomState::new().build_hasher();
            h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
            chunk.copy_from_slice(&h.finish().to_le_bytes()[..chunk.len()]);
        }
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

async fn guard(State(s): State<AppState>, req: Request, next: Next) -> Response {
    let host = req.headers().get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or("");
    let hostname = host.rsplit_once(':').map(|(h, _)| h).unwrap_or(host);
    if !matches!(hostname, "localhost" | "127.0.0.1" | "[::1]") {
        return (StatusCode::FORBIDDEN, "kula only answers on localhost").into_response();
    }
    if req.uri().path().starts_with("/api/") {
        let tok = req.headers().get("x-kula-token").and_then(|h| h.to_str().ok()).unwrap_or("");
        if tok != s.token.as_str() {
            return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "missing or bad session token" }))).into_response();
        }
    }
    next.run(req).await
}

async fn static_file(State(s): State<AppState>, req: Request) -> Response {
    let path = req.uri().path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    let (file, name) = match Assets::get(path) {
        Some(f) => (f, path.to_string()),
        None => match Assets::get("index.html") {
            Some(f) => (f, "index.html".into()),
            None => return StatusCode::NOT_FOUND.into_response(),
        },
    };
    if name == "index.html" {
        let html =
            String::from_utf8_lossy(&file.data).replace("</head>", &format!("<meta name=\"kula-token\" content=\"{}\"></head>", s.token));
        return Response::builder()
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header(header::CACHE_CONTROL, "no-store")
            .body(Body::from(html))
            .unwrap();
    }
    let mime = mime_guess::from_path(&name).first_or_octet_stream();
    Response::builder()
        .header(header::CONTENT_TYPE, mime.as_ref())
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .body(Body::from(file.data.into_owned()))
        .unwrap()
}

// ---------------------------------------------------------------- repo & graph

async fn repo_info(State(s): State<AppState>) -> ApiResult {
    blocking(move || {
        let r = &s.repo;
        let st = Store::open(r).ok();
        let indexed = st.as_ref().and_then(|x| x.meta("indexed_head"));
        let head = r.head();
        let fresh = Store::freshness(r);
        let stats: Value = st.as_ref().and_then(|x| x.meta("stats")).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
        let remotes: Vec<String> = r.run(&["remote"]).unwrap_or_default().lines().map(String::from).collect();
        Ok(json!({ "name": r.name(), "root": r.root, "branch": r.branch(), "head": head, "indexed_head": indexed,
                   "index": fresh, "stats": stats, "user": r.user(), "remotes": remotes, "version": env!("CARGO_PKG_VERSION") }))
    })
    .await
}

async fn reindex(State(s): State<AppState>) -> ApiResult {
    blocking(move || Ok(json!(index::run(&s.repo, true)?))).await
}

/// Before editing a symbol: dependents, direct callers, tests that reach it, files that change with it, advice.
async fn agent_pre_edit(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult {
    blocking(move || {
        let st = Store::open(&s.repo)?;
        Ok(json!(crate::agent::pre_edit(&s.repo, &st, &id)?))
    })
    .await
}

/// After editing: the working tree's graph against HEAD – callers left dangling, callers to re-read.
async fn agent_verify(State(s): State<AppState>) -> ApiResult {
    blocking(move || Ok(json!(crate::agent::verify_edit(&s.repo)?))).await
}

/// Where the stored index build is, for the loader's progress bar. Cheap: no store access.
async fn index_progress() -> Json<Value> {
    Json(index::PROGRESS.json())
}

async fn graph_data(State(s): State<AppState>, Query(q): Query<HashMap<String, String>>) -> ApiResult {
    blocking(move || {
        let st = Store::open(&s.repo)?;
        let level = q.get("level").map(String::as_str).unwrap_or("symbol").to_string();
        let limit = q.get("limit").and_then(|l| l.parse().ok()).unwrap_or(4000);
        let mut out = json!(graph::export(&st, &level, limit)?);
        out["churn"] = json!(graph::churn(&s.repo, 90));
        Ok(out)
    })
    .await
}

async fn search(State(s): State<AppState>, Query(q): Query<HashMap<String, String>>) -> ApiResult {
    blocking(move || {
        let st = Store::open(&s.repo)?;
        Ok(json!(st.search(q.get("q").map(String::as_str).unwrap_or(""), 30)?))
    })
    .await
}

/// What is near a file: the file, the symbols it defines (in source order) and
/// its sibling files – the autofill for notes and memories written beside code.
async fn near(State(s): State<AppState>, Query(q): Query<HashMap<String, String>>) -> ApiResult {
    blocking(move || {
        let st = Store::open(&s.repo)?;
        let path = q.get("path").cloned().unwrap_or_default();
        let dir = path.rsplit_once('/').map(|x| x.0).unwrap_or("").to_string();
        let file = st.nodes_where("kind = 'file' AND path = ?1", rusqlite::params![path])?;
        let symbols =
            st.nodes_where("kind NOT IN ('file','package') AND path = ?1 ORDER BY start_line LIMIT 40", rusqlite::params![path])?;
        let like = if dir.is_empty() { "%".to_string() } else { format!("{dir}/%") };
        let siblings: Vec<_> = st
            .nodes_where("kind = 'file' AND path LIKE ?1 AND path != ?2 ORDER BY path LIMIT 60", rusqlite::params![like, path])?
            .into_iter()
            .filter(|n| n.path[if dir.is_empty() { 0 } else { dir.len() + 1 }..].find('/').is_none())
            .take(12)
            .collect();
        Ok(json!({ "file": file.first(), "symbols": symbols, "siblings": siblings }))
    })
    .await
}

async fn symbol(State(s): State<AppState>, Path(id): Path<i64>) -> ApiResult {
    blocking(move || {
        let st = Store::open(&s.repo)?;
        let c = graph::context(&s.repo, &st, id)?;
        let notes: Vec<_> = meta::load(&s.repo)?
            .notes
            .into_iter()
            .filter(|n| {
                n.target == format!("symbol:{}:{}", c.node.path, c.node.name)
                    || n.target == format!("symbol:{}", c.node.name)
                    || n.target == format!("file:{}", c.node.path)
            })
            .collect();
        let guard = crate::guard::Guards::load(&s.repo)?.node(&c.node);
        let memories = crate::memory::recall(&s.repo, &st, Some(&id.to_string()), None, 12).unwrap_or_default();
        let notes: Vec<_> = notes.into_iter().filter(|n| n.kind.is_empty()).collect();
        let mut v = json!(c);
        v["notes"] = json!(notes);
        v["guard"] = json!(guard);
        v["memories"] = json!(memories);
        Ok(v)
    })
    .await
}

async fn impact(State(s): State<AppState>, Path(id): Path<i64>, Query(q): Query<HashMap<String, String>>) -> ApiResult {
    blocking(move || {
        let st = Store::open(&s.repo)?;
        let up = q.get("dir").map(|d| d != "down").unwrap_or(true);
        let depth = q.get("depth").and_then(|d| d.parse().ok()).unwrap_or(3);
        Ok(json!(graph::impact(&st, id, up, depth)?))
    })
    .await
}

async fn flows(State(s): State<AppState>) -> ApiResult {
    blocking(move || Ok(json!(graph::flows(&Store::open(&s.repo)?, 25)?))).await
}

async fn file(State(s): State<AppState>, Query(q): Query<HashMap<String, String>>) -> ApiResult {
    blocking(move || {
        let p = q.get("path").cloned().unwrap_or_default();
        if p.contains("..") || p.starts_with('/') {
            return Err(anyhow!("bad path"));
        }
        let content = std::fs::read_to_string(s.repo.root.join(&p))?;
        Ok(json!({ "path": p, "content": content }))
    })
    .await
}

async fn compare(State(s): State<AppState>, Query(q): Query<HashMap<String, String>>) -> ApiResult {
    blocking(move || {
        let base = q.get("base").cloned().ok_or_else(|| anyhow!("base required"))?;
        let head = q.get("head").cloned().unwrap_or_else(|| s.repo.branch());
        let st = Store::open(&s.repo).ok();
        Ok(json!(graph::compare(&s.repo, st.as_ref(), &base, &head)?))
    })
    .await
}

async fn graph_diff(State(s): State<AppState>, Query(q): Query<HashMap<String, String>>) -> ApiResult {
    blocking(move || {
        let base = q.get("base").cloned().ok_or_else(|| anyhow!("base required"))?;
        let head = q.get("head").cloned().unwrap_or_else(|| s.repo.branch());
        let focus = q.get("focus").map(|f| f == "changed");
        let (_, b) = s.snapshot(&base)?;
        let (_, h) = s.snapshot(&head)?;
        Ok(json!(graph::graph_diff(&b, &h, &base, &head, focus)))
    })
    .await
}

async fn history(State(s): State<AppState>, Path(id): Path<i64>) -> ApiResult {
    blocking(move || {
        let st = Store::open(&s.repo)?;
        let n = st.node(id)?.ok_or_else(|| anyhow!("no node {id}"))?;
        Ok(json!(graph::symbol_history(&s.repo, &n)?))
    })
    .await
}

/// Everything that needs a human's attention, in one payload.
async fn overview(State(s): State<AppState>) -> ApiResult {
    blocking(move || {
        let r = &s.repo;
        let st = Store::open(r).ok();
        let branches = r.branches().unwrap_or_default();
        let default = ["main", "master", "trunk", "develop"]
            .iter()
            .find(|d| branches.iter().any(|b| !b.remote && b.name == **d))
            .map(|d| d.to_string())
            .unwrap_or_else(|| r.branch());
        let mut local: Vec<Value> = branches
            .iter()
            .filter(|b| !b.remote)
            .map(|b| {
                let (ahead, behind) = r.ahead_behind(&default, &b.name);
                json!({ "name": b.name, "current": b.current, "time": b.time, "subject": b.subject, "ahead": ahead, "behind": behind, "upstream": b.upstream, "track": b.track })
            })
            .collect();
        local.sort_by_key(|b| -b["time"].as_i64().unwrap_or(0));
        let m = meta::load(r)?;
        let proposals: Vec<Value> = m
            .proposals
            .iter()
            .filter(|p| p.status == "open")
            .take(10)
            .map(|p| match graph::compare(r, st.as_ref(), &p.base, &p.head) {
                Ok(c) => json!({ "proposal": p, "risk": c.risk, "touched": c.touched, "affected": c.affected.len(), "ahead": c.ahead, "behind": c.behind, "files": c.files.len() }),
                Err(_) => json!({ "proposal": p, "risk": "unknown" }),
            })
            .collect();
        let mut issues: Vec<_> = m.issues.iter().filter(|i| i.status == "open").cloned().collect();
        issues.sort_by_key(|i| std::cmp::Reverse(i.created));
        let hot = match &st {
            Some(st) => graph::hotspots(r, st, 90, 8)?,
            None => vec![],
        };
        Ok(json!({
            "default_branch": default,
            "branches": local,
            "proposals": proposals,
            "issues": issues.into_iter().take(8).collect::<Vec<_>>(),
            "issues_open": m.issues.iter().filter(|i| i.status == "open").count(),
            "notes": m.notes.len(),
            "hotspots": hot,
            "recent": r.log(8, Some("HEAD")).unwrap_or_default(),
            "changes": r.status().map(|f| f.len()).unwrap_or(0),
        }))
    })
    .await
}

// ---------------------------------------------------------------- git

async fn git_status(State(s): State<AppState>) -> ApiResult {
    blocking(move || Ok(json!({ "branch": s.repo.branch(), "files": s.repo.status()? }))).await
}

async fn git_log(State(s): State<AppState>, Query(q): Query<HashMap<String, String>>) -> ApiResult {
    blocking(move || {
        let limit = q.get("limit").and_then(|l| l.parse().ok()).unwrap_or(300);
        let rev = q.get("rev").cloned();
        if let Some(r) = &rev {
            validate_rev(r)?;
        }
        Ok(json!(s.repo.log(limit, rev.as_deref())?))
    })
    .await
}

async fn git_branches(State(s): State<AppState>) -> ApiResult {
    blocking(move || {
        let tags: Vec<String> = s.repo.run(&["tag", "--sort=-creatordate"]).unwrap_or_default().lines().map(String::from).collect();
        let stashes: Vec<String> = s.repo.run(&["stash", "list"]).unwrap_or_default().lines().map(String::from).collect();
        Ok(json!({ "branches": s.repo.branches()?, "tags": tags, "stashes": stashes }))
    })
    .await
}

async fn git_diff(State(s): State<AppState>, Query(q): Query<HashMap<String, String>>) -> ApiResult {
    blocking(move || {
        let staged = q.get("staged").map(|v| v == "1" || v == "true").unwrap_or(false);
        Ok(json!({ "diff": s.repo.diff(q.get("path").map(String::as_str), staged)? }))
    })
    .await
}

async fn git_show(State(s): State<AppState>, Path(sha): Path<String>) -> ApiResult {
    blocking(move || Ok(json!({ "show": s.repo.show(&sha)? }))).await
}

#[derive(Deserialize, Default)]
struct GitAction {
    #[serde(default)]
    paths: Vec<String>,
    message: Option<String>,
    #[serde(default)]
    amend: bool,
    name: Option<String>,
    from: Option<String>,
    #[serde(default)]
    force: bool,
    args: Option<Vec<String>>,
}

async fn git_action(State(s): State<AppState>, Path(action): Path<String>, Json(a): Json<GitAction>) -> ApiResult {
    blocking(move || {
        let r = &s.repo;
        for p in &a.paths {
            if p.starts_with('-') {
                return Err(anyhow!("bad path {p}"));
            }
        }
        let with_paths = |base: &[&str]| -> Vec<String> {
            let mut v: Vec<String> = base.iter().map(|x| x.to_string()).collect();
            v.push("--".into());
            v.extend(a.paths.iter().cloned());
            v
        };
        let name = || -> anyhow::Result<String> {
            let n = a.name.clone().ok_or_else(|| anyhow!("name required"))?;
            validate_rev(&n)?;
            Ok(n)
        };
        let out = match action.as_str() {
            "stage" => r.run(&if a.paths.is_empty() { vec!["add".to_string(), "-A".into()] } else { with_paths(&["add"]) })?,
            "unstage" => r
                .run(&if a.paths.is_empty() { vec!["reset".to_string(), "-q".into()] } else { with_paths(&["reset", "-q", "HEAD"]) })
                .or_else(|_| r.run(&with_paths(&["rm", "--cached", "-q"])))?,
            "discard" => {
                let tracked = r.run(&with_paths(&["checkout"])).map(|_| ());
                // Untracked files: remove them explicitly.
                if tracked.is_err() {
                    r.run(&with_paths(&["clean", "-f"]))?;
                }
                String::new()
            }
            "commit" => {
                let msg = a.message.clone().filter(|m| !m.trim().is_empty()).ok_or_else(|| anyhow!("commit message required"))?;
                let mut args = vec!["commit", "-m", msg.as_str()];
                if a.amend {
                    args.push("--amend");
                }
                r.run(&args)?
            }
            "checkout" => r.run(&["switch", &name()?])?,
            "branch" => {
                let n = name()?;
                match &a.from {
                    Some(f) => {
                        validate_rev(f)?;
                        r.run(&["branch", &n, f])?
                    }
                    None => r.run(&["branch", &n])?,
                }
            }
            "branch_delete" => r.run(&["branch", if a.force { "-D" } else { "-d" }, &name()?])?,
            "merge" => r.run(&["merge", "--no-edit", &name()?])?,
            "rebase" => r.run(&["rebase", &name()?])?,
            "cherry_pick" => r.run(&["cherry-pick", &name()?])?,
            "revert" => r.run(&["revert", "--no-edit", &name()?])?,
            "tag" => r.run(&["tag", &name()?])?,
            "fetch" => r.run(&["fetch", "--all", "--prune"])?,
            "pull" => r.run(&["pull", "--ff-only"])?,
            "push" => r.run(&["push", "-u", "origin", "HEAD"])?,
            "stash" => r.run(&["stash", "push", "-u"])?,
            "stash_pop" => r.run(&["stash", "pop"])?,
            "exec" => {
                let args = a.args.clone().unwrap_or_default();
                if args.is_empty() {
                    return Err(anyhow!("args required"));
                }
                return Ok(json!(r.exec(&args)?));
            }
            "kula" => {
                let args = a.args.clone().unwrap_or_default();
                if args.is_empty() {
                    return Err(anyhow!("args required"));
                }
                return Ok(json!(r.exec_kula(&args)?));
            }
            other => return Err(anyhow!("unknown action {other}")),
        };
        Ok(json!({ "ok": true, "output": out }))
    })
    .await
}

// ---------------------------------------------------------------- agents

/// Everything agents are told and allowed: guard rules and the files they fence,
/// the task, memories (stale first), and whether MCP and the hook are wired up.
async fn agents_info(State(s): State<AppState>) -> ApiResult {
    blocking(move || {
        let r = &s.repo;
        let cfg = crate::config::Config::load(&r.root)?;
        let g = crate::guard::Guards::load(r)?;
        let st = Store::open(r).ok();
        let rules: Vec<Value> = g
            .rules()
            .into_iter()
            .map(|(rule, level)| json!({ "level": level, "paths": rule.paths, "symbols": rule.symbols, "reason": rule.reason }))
            .collect();
        let (files, levels) = match &st {
            Some(st) => {
                let files = crate::guard::guarded_files(r, st)?;
                let mut levels = serde_json::Map::new();
                for n in st.nodes_where("kind != 'package'", [])? {
                    let v = g.node(&n);
                    if v.level != crate::guard::Level::Open {
                        levels.insert(n.id.to_string(), json!(v.level));
                    }
                }
                (files, levels)
            }
            None => (vec![], Default::default()),
        };
        let memories = match &st {
            Some(st) => crate::memory::recall(r, st, None, None, 500)?,
            None => vec![],
        };
        let read = |p: &str| std::fs::read_to_string(r.root.join(p)).unwrap_or_default();
        Ok(json!({
            "rules": rules,
            "task": g.task(),
            "files": files.iter().map(|(p, v)| json!({ "path": p, "verdict": v })).collect::<Vec<_>>(),
            "levels": levels,
            "memories": memories,
            "secrets_hidden": cfg.agents.hide_secrets,
            "memory_enabled": cfg.agents.memory,
            "mcp_registered": read(".mcp.json").contains("\"kula\""),
            "hook_installed": read(".claude/settings.json").contains("kula guard hook"),
            "kula_toml": crate::config::Config::exists(&r.root),
            "workflows": crate::workflow::all(&cfg),
            "workflow": g.workflow(),
            "workflow_rules": g.workflow_rules().into_iter().map(|(rule, level)| json!({ "level": level, "paths": rule.paths, "symbols": rule.symbols, "reason": rule.reason })).collect::<Vec<_>>(),
            "raw_rules": cfg.guards,
            "docs_list": cfg.agents.docs,
            "connections": crate::agents::connections(&r.root),
            "docs": crate::agents::docs(r)?,
            "suggestions": crate::agents::suggestions(r),
        }))
    })
    .await
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct AgentReq {
    title: String,
    scope: Vec<String>,
    target: String,
    text: String,
    id: u64,
    workflow: String,
    path: String,
    agent: String,
    rules: Vec<crate::config::GuardRule>,
    workflows: Vec<crate::workflow::Workflow>,
    agents: Option<crate::config::Agents>,
}

async fn agents_action(State(s): State<AppState>, Path(action): Path<String>, Json(a): Json<AgentReq>) -> ApiResult {
    blocking(move || {
        let r = &s.repo;
        Ok(match action.as_str() {
            "task_start" => json!(crate::guard::task_start(
                r,
                &a.title,
                a.scope.into_iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect(),
                (!a.workflow.is_empty()).then_some(a.workflow.as_str()),
                &r.user()
            )?),
            "memory_edit" => json!(crate::memory::edit(
                r,
                &Store::open(r)?,
                a.id,
                (!a.text.is_empty()).then_some(a.text.as_str()),
                (!a.target.is_empty()).then_some(a.target.as_str())
            )?),
            "memory_stale" => json!(crate::memory::mark_stale(r, a.id)?),
            "guards_save" => {
                crate::config::set_guards(&r.root, &a.rules)?;
                json!({ "ok": true })
            }
            "workflows_save" => {
                crate::config::set_workflows(&r.root, &a.workflows)?;
                json!({ "ok": true })
            }
            "settings_save" => {
                let ag = a.agents.ok_or_else(|| anyhow!("agents settings required"))?;
                crate::config::set_agents(&r.root, &ag)?;
                json!({ "ok": true })
            }
            "doc_read" => json!({ "path": a.path, "text": crate::agents::doc_read(r, &a.path)? }),
            "doc_save" => {
                crate::agents::doc_save(r, &a.path, &a.text)?;
                json!({ "ok": true })
            }
            "docs_sync" => json!({ "written": crate::agents::sync(r, &[])? }),
            "brief" => json!({ "text": crate::agents::brief(&crate::config::Config::load(&r.root)?) }),
            "connect" => json!({ "files": crate::agents::connect(&r.root, &a.agent)? }),
            "suggestion_accept" => json!(crate::agents::accept(r, a.id)?),
            "suggestion_dismiss" => {
                crate::agents::dismiss(r, a.id)?;
                json!({ "ok": true })
            }
            "preview" => {
                // The fence map a workflow would draw, without starting it.
                let cfg = crate::config::Config::load(&r.root)?;
                let t = crate::guard::Task {
                    title: "preview".into(),
                    workflow: a.workflow.clone(),
                    scope: crate::workflow::find(&cfg, &a.workflow).map(|w| w.scope).unwrap_or_default(),
                    ..Default::default()
                };
                let g = crate::guard::Guards::new(&cfg, (!a.workflow.is_empty()).then_some(t))?;
                let st = Store::open(r)?;
                let mut levels = serde_json::Map::new();
                for n in st.nodes_where("kind != 'package'", [])? {
                    let v = g.node(&n);
                    if v.level != crate::guard::Level::Open {
                        levels.insert(n.id.to_string(), json!(v.level));
                    }
                }
                json!({ "levels": levels })
            }
            "task_done" => json!(crate::guard::task_done(r)?),
            "remember" => json!(crate::memory::remember(r, &Store::open(r)?, &a.target, &a.text, &r.user())?),
            "confirm" => json!(crate::memory::confirm(r, &Store::open(r)?, a.id)?),
            "forget" => {
                meta::note_rm(r, a.id)?;
                json!({ "ok": true })
            }
            other => return Err(anyhow!("unknown action {other}")),
        })
    })
    .await
}

#[derive(Deserialize)]
struct SparqlReq {
    query: String,
    #[serde(default)]
    limit: Option<usize>,
}

async fn kg_sparql(State(s): State<AppState>, Json(q): Json<SparqlReq>) -> ApiResult {
    blocking(move || {
        let st = Store::open(&s.repo)?;
        let t0 = std::time::Instant::now();
        let mut v = crate::kg::sparql(&s.repo, &st, &q.query, q.limit.unwrap_or(500).min(5000))?;
        v["millis"] = json!(t0.elapsed().as_millis());
        Ok(v)
    })
    .await
}

async fn kg_export(State(s): State<AppState>, Query(q): Query<HashMap<String, String>>) -> ApiResult {
    blocking(move || {
        let f = q.get("format").cloned().unwrap_or_else(|| "ttl".into());
        let st = Store::open(&s.repo)?;
        let bytes = crate::kg::export(&s.repo, &st, &f)?;
        Ok(json!({ "format": f, "text": String::from_utf8_lossy(&bytes) }))
    })
    .await
}

/// Example queries and the vocabulary, for the Query view.
async fn kg_examples() -> ApiResult {
    let examples: Vec<Value> = crate::kg::EXAMPLES.iter().map(|(t, q)| json!({ "title": t, "query": q })).collect();
    let vocab: Vec<Value> =
        crate::kg::SCHEMA.iter().map(|(t, what, doc)| json!({ "term": format!("kula:{t}"), "kind": what, "doc": doc })).collect();
    let prefixes: Vec<Value> = crate::kg::PREFIXES.iter().map(|(p, iri)| json!({ "prefix": p, "iri": iri })).collect();
    Ok(Json(json!({ "examples": examples, "vocabulary": vocab, "prefixes": prefixes })))
}

// ---------------------------------------------------------------- meta

async fn meta_all(State(s): State<AppState>) -> ApiResult {
    blocking(move || Ok(json!(meta::load(&s.repo)?))).await
}

#[derive(Deserialize)]
struct MetaReq {
    title: Option<String>,
    body: Option<String>,
    #[serde(default)]
    labels: Vec<String>,
    #[serde(default)]
    anchors: Vec<String>,
    base: Option<String>,
    head: Option<String>,
    target: Option<String>,
    status: Option<String>,
}

async fn meta_action(State(s): State<AppState>, Path((kind, action)): Path<(String, String)>, Json(m): Json<MetaReq>) -> ApiResult {
    blocking(move || {
        let r = &s.repo;
        let body = m.body.clone().unwrap_or_default();
        let id = || -> anyhow::Result<u64> { action.parse().map_err(|_| anyhow!("bad id")) };
        let v = match (kind.as_str(), action.as_str()) {
            ("issues", "new") => json!(meta::issue_new(r, m.title.as_deref().unwrap_or("untitled"), &body, m.labels, m.anchors)?),
            ("proposals", "new") => json!(meta::proposal_new(
                r,
                m.title.as_deref().unwrap_or("untitled"),
                &body,
                m.base.as_deref().unwrap_or("main"),
                &m.head.clone().unwrap_or_else(|| r.branch())
            )?),
            ("notes", "new") => json!(meta::note_add(r, m.target.as_deref().unwrap_or("repo"), &body)?),
            ("issues", _) if m.status.is_some() => json!(meta::issue_set_status(r, id()?, m.status.as_deref().unwrap())?),
            ("proposals", _) if m.status.as_deref() == Some("merged") => json!(meta::proposal_merge(r, id()?)?),
            ("proposals", _) if m.status.is_some() => json!(meta::proposal_set_status(r, id()?, m.status.as_deref().unwrap())?),
            ("issues" | "proposals", _) => {
                meta::comment(r, id()?, &body)?;
                json!({ "ok": true })
            }
            ("notes", _) if m.status.as_deref() == Some("deleted") => {
                meta::note_rm(r, id()?)?;
                json!({ "ok": true })
            }
            ("notes", _) => json!(meta::note_edit(r, id()?, &body)?),
            _ => return Err(anyhow!("unknown {kind}/{action}")),
        };
        Ok(v)
    })
    .await
}

pub fn router(repo: Repo, token: String) -> Router {
    let state = AppState { repo, token: Arc::new(token), snapshots: Default::default() };
    Router::new()
        .route("/api/repo", get(repo_info))
        .route("/api/index", post(reindex))
        .route("/api/index/progress", get(index_progress))
        .route("/api/agent/pre_edit/{id}", get(agent_pre_edit))
        .route("/api/agent/verify", get(agent_verify))
        .route("/api/graph", get(graph_data))
        .route("/api/search", get(search))
        .route("/api/near", get(near))
        .route("/api/graphdiff", get(graph_diff))
        .route("/api/history/{id}", get(history))
        .route("/api/overview", get(overview))
        .route("/api/symbol/{id}", get(symbol))
        .route("/api/impact/{id}", get(impact))
        .route("/api/flows", get(flows))
        .route("/api/file", get(file))
        .route("/api/compare", get(compare))
        .route("/api/git/status", get(git_status))
        .route("/api/git/log", get(git_log))
        .route("/api/git/branches", get(git_branches))
        .route("/api/git/diff", get(git_diff))
        .route("/api/git/show/{sha}", get(git_show))
        .route("/api/git/{action}", post(git_action))
        .route("/api/meta", get(meta_all))
        .route("/api/agents", get(agents_info))
        .route("/api/agents/{action}", post(agents_action))
        .route("/api/kg/sparql", post(kg_sparql))
        .route("/api/kg/export", get(kg_export))
        .route("/api/kg/examples", get(kg_examples))
        .route("/api/meta/{kind}/{action}", post(meta_action))
        .fallback(static_file)
        .layer(middleware::from_fn_with_state(state.clone(), guard))
        .with_state(state)
}

/// Keep the graph honest: reindex in the background whenever HEAD moves.
fn spawn_auto_reindex(repo: Repo) {
    tokio::spawn(async move {
        // Check straight away (a first run indexes behind the UI's loader), then every 3s.
        let mut first = true;
        loop {
            if !first {
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            }
            first = false;
            let r = repo.clone();
            let _ = tokio::task::spawn_blocking(move || {
                if Store::freshness(&r) != "current" {
                    let _ = index::run(&r, true);
                }
            })
            .await;
        }
    });
}

pub fn serve(repo: Repo, port: u16, open_browser: bool) -> anyhow::Result<()> {
    let token = std::env::var("KULA_TOKEN").unwrap_or_else(|_| random_token());
    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(async move {
        let name = repo.name();
        spawn_auto_reindex(repo.clone());
        let app = router(repo, token);
        // Try the requested port, then the next few.
        let mut listener = None;
        for p in port..port.saturating_add(20) {
            if let Ok(l) = tokio::net::TcpListener::bind(("127.0.0.1", p)).await {
                listener = Some(l);
                break;
            }
        }
        let listener = listener.ok_or_else(|| anyhow!("no free port near {port}"))?;
        let addr = listener.local_addr()?;
        let url = format!("http://localhost:{}", addr.port());
        println!("{} {} is live at {}", crate::term::accent("◯"), crate::term::bold(&name), crate::term::bold(&url));
        println!("  {}", crate::term::dim("ctrl+c to stop"));
        if open_browser {
            let _ = open::that(&url);
        }
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = tokio::signal::ctrl_c().await;
            })
            .await?;
        Ok(())
    })
}
