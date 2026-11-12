//! Routes: HTTP endpoints in the tree → `route` nodes and `HANDLES` edges.
//!
//! Detected frameworks: Express/Fastify (`app.get("/p", handler)`), Next.js
//! (`app/**/route.ts` handlers, `pages/api/**`), FastAPI/Flask (`@app.get("/p")`,
//! `@app.route`), Rust axum (`.route("/p", get(handler))`) and Go
//! (`http.HandleFunc`, gin `r.GET`). A `HANDLES` edge runs route → handler:
//! `resolved` when the handler identifier is defined in the same file,
//! `inferred` when it matches a unique symbol anywhere else.
//!
//! Cross-language: a string literal `fetch("/api/x")` / `requests.get("/api/x")`
//! matched to a route by normalised path (params stripped to `:param`) adds a
//! `CALLS` edge from the calling symbol to that route's handler, `inferred`.

use crate::index::Reader;
use crate::store::{Edge, Node};
use std::collections::{HashMap, HashSet};

use super::route_scan::last_segment;
use super::route_scan::{fetch_urls, norm_path, path_matches, scan};

/// Route display name: `GET /api/users`.
pub fn route_name(method: &str, path: &str) -> String {
    format!("{method} {}", norm_path(path))
}

/// Insert route nodes and HANDLES edges into a graph under construction. Also
/// links `fetch`/`requests` literals to route handlers across languages via
/// CALLS edges.
#[allow(clippy::too_many_arguments)]
pub(crate) fn apply(
    parsed: &[crate::index::ParsedFile],
    sym_ids: &[Vec<usize>],
    _files: &[(String, Option<&'static str>)],
    read: Reader,
    nodes: &mut Vec<Node>,
    edges: &mut Vec<Edge>,
    file_id: &HashMap<String, usize>,
    hashes: &mut Vec<u64>,
) {
    // Pass 1: route nodes and HANDLES edges.
    let mut handler_of: HashMap<usize, usize> = HashMap::new(); // route node id → handler node id
    let mut by_norm_path: Vec<(String, usize)> = Vec::new(); // normalised path → route node id (GET first)
    let mut seen: HashSet<(String, String, String)> = HashSet::new();
    for (pi, pf) in parsed.iter().enumerate() {
        let Some(src) = read(&pf.path) else { continue };
        let Some(fid) = file_id.get(&pf.path).copied() else { continue };
        for r in scan(pf.lang, &pf.path, &src) {
            let line = 1 + src[..r.byte].matches('\n').count() as i64;
            let name = route_name(&r.method, &r.path);
            let key = (name.clone(), pf.path.clone(), r.method.clone());
            if !seen.insert(key) {
                continue;
            }
            let id = nodes.len();
            nodes.push(Node {
                id: id as i64,
                kind: "route".into(),
                name,
                path: pf.path.clone(),
                lang: pf.lang.to_string(),
                start_line: line,
                end_line: line,
                parent: Some(fid as i64),
                community: 0,
            });
            hashes.push(0);
            by_norm_path.push((norm_path(&r.path), id));
            let Some(handler) = r.handler.as_deref().map(last_segment) else { continue };
            // Same file: resolved. Unique symbol anywhere: inferred.
            let local = pf.defs.iter().enumerate().find(|(_, d)| d.name == handler).map(|(i, _)| sym_ids[pi][i]);
            let target = local.map(|t| (t, "resolved")).or_else(|| {
                let cands: Vec<usize> = nodes[..id]
                    .iter()
                    .enumerate()
                    .filter(|(_, n)| matches!(n.kind.as_str(), "function" | "method") && n.name == handler)
                    .map(|(i, _)| i)
                    .collect();
                (cands.len() == 1).then(|| (cands[0], "inferred"))
            });
            if let Some((t, conf)) = target {
                handler_of.insert(id, t);
                edges.push(Edge::new(id as i64, t as i64, "HANDLES", 1.0).with(conf));
            }
        }
    }
    // Pass 2: string-literal HTTP calls matched to routes by normalised path.
    for (pi, pf) in parsed.iter().enumerate() {
        let Some(src) = read(&pf.path) else { continue };
        for (url, byte) in fetch_urls(pf.lang, &src) {
            let np = norm_path(&url);
            let exact = by_norm_path.iter().rev().find(|(p, _)| *p == np);
            let Some((_, route_id)) = exact.or_else(|| by_norm_path.iter().rev().find(|(p, _)| path_matches(p, &np))) else {
                continue;
            };
            let Some(&handler) = handler_of.get(route_id) else { continue };
            let caller = pf
                .defs
                .iter()
                .enumerate()
                .filter(|(_, d)| d.start_byte <= byte && byte < d.end_byte)
                .min_by_key(|(_, d)| d.end_byte - d.start_byte)
                .map(|(i, _)| sym_ids[pi][i]);
            let Some(caller) = caller else { continue };
            if caller != handler {
                edges.push(Edge::new(caller as i64, handler as i64, "CALLS", 1.0).with("inferred"));
            }
        }
    }
}

/// One endpoint as stored: name ("GET /api/users"), declaring file and line,
/// and the handler it resolves to with that edge's confidence tier.
#[derive(serde::Serialize)]
pub struct RouteRow {
    pub route: String,
    pub file: String,
    pub line: i64,
    pub handler: Option<String>,
    pub handler_file: Option<String>,
    pub confidence: Option<String>,
}

/// Every route whose normalised path starts with `prefix` (empty: all), in
/// file then line order.
pub fn routes(store: &crate::store::Store, prefix: &str) -> anyhow::Result<Vec<RouteRow>> {
    let want = if prefix.is_empty() { String::new() } else { norm_path(prefix) };
    let mut rows = Vec::new();
    for n in store.nodes_where("kind = 'route'", [])? {
        let path = n.name.split_once(' ').map(|(_, p)| p).unwrap_or(&n.name);
        if !want.is_empty() && !path.starts_with(want.as_str()) {
            continue;
        }
        let h = store.neighbours_conf(n.id, "HANDLES", true)?.into_iter().next();
        rows.push(RouteRow {
            route: n.name.clone(),
            file: n.path.clone(),
            line: n.start_line,
            handler: h.as_ref().map(|(h, _)| h.name.clone()),
            handler_file: h.as_ref().map(|(h, _)| h.path.clone()),
            confidence: h.map(|(_, c)| c),
        });
    }
    rows.sort_by(|a, b| (&a.file, a.line, &a.route).cmp(&(&b.file, b.line, &b.route)));
    Ok(rows)
}
