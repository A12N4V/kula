//! `kula view` — local HTTP server with the embedded web UI.
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
        let fresh = match (&indexed, &head) {
            (None, _) => "missing",
            (Some(i), Some(h)) if i == h => "current",
            _ => "stale",
        };
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

async fn graph_data(State(s): State<AppState>, Query(q): Query<HashMap<String, String>>) -> ApiResult {
    blocking(move || {
        let st = Store::open(&s.repo)?;
        let level = q.get("level").map(String::as_str).unwrap_or("symbol").to_string();
        let limit = q.get("limit").and_then(|l| l.parse().ok()).unwrap_or(4000);
        Ok(json!(graph::export(&st, &level, limit)?))
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
        let mut v = json!(c);
        v["notes"] = json!(notes);
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
            other => return Err(anyhow!("unknown action {other}")),
        };
        Ok(json!({ "ok": true, "output": out }))
    })
    .await
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
    let state = AppState { repo, token: Arc::new(token) };
    Router::new()
        .route("/api/repo", get(repo_info))
        .route("/api/index", post(reindex))
        .route("/api/graph", get(graph_data))
        .route("/api/search", get(search))
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
        .route("/api/meta/{kind}/{action}", post(meta_action))
        .fallback(static_file)
        .layer(middleware::from_fn_with_state(state.clone(), guard))
        .with_state(state)
}

pub fn serve(repo: Repo, port: u16, open_browser: bool) -> anyhow::Result<()> {
    let token = std::env::var("KULA_TOKEN").unwrap_or_else(|_| random_token());
    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(async move {
        let name = repo.name();
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
