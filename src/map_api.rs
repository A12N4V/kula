//! `/api/map*` handlers – the map contract surface. `/api/syntagm*` stays as
//! a thin alias until the UI no longer calls it.

use crate::map;
use crate::server::{blocking, ApiResult, AppState};
use axum::extract::{Path, Query, State};
use serde::Deserialize;

/// GET /api/map – blocks, families, loops, leaves, flows and stats.
pub(crate) async fn map_all(State(s): State<AppState>) -> ApiResult {
    blocking(move || {
        let store = crate::store::Store::open(&s.repo)?;
        let (idx, embed_state) = crate::embed::similarity_for(&s.repo, &store);
        let sim = idx.as_ref().map(|i| i as &dyn map::Similarity);
        map::all_json_with(&s.repo, &store, sim, embed_state)
    })
    .await
}

#[derive(Deserialize)]
pub struct ChainsQuery {
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub cursor: Option<String>,
    pub limit: Option<usize>,
}

/// GET /api/map/chains?from=&to=&cursor=&limit= – one lazy page of a family.
/// `from`/`to` are the family's source and terminal symbol ids, both listed
/// in `/api/map`'s families; `cursor` resumes where the last page stopped.
pub(crate) async fn map_chains(State(s): State<AppState>, Query(q): Query<ChainsQuery>) -> ApiResult {
    blocking(move || {
        let store = crate::store::Store::open(&s.repo)?;
        let (from, to) = match (q.from, q.to) {
            (Some(f), Some(t)) => (f, t),
            _ => anyhow::bail!("from and to are required – pick a family from /api/map"),
        };
        let page = map::chain_family_page(&s.repo, &store, from, to, q.cursor.as_deref(), q.limit.unwrap_or(50).clamp(1, 500))?;
        Ok(serde_json::json!({ "chains": page.chains, "cursor": page.cursor }))
    })
    .await
}

/// GET /api/map/block/:id – the block, its children and its leaves.
pub(crate) async fn map_block(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult {
    blocking(move || {
        let store = crate::store::Store::open(&s.repo)?;
        map::block_json(&s.repo, &store, &id)
    })
    .await
}
