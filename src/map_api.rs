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
    /// The family id, `f{index}` as listed in /api/map.
    pub family: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<usize>,
}

/// GET /api/map/chains?family=&cursor=&limit= – one lazy page of a family.
/// `cursor` resumes where the last page stopped; `cursor: null` in the reply
/// (and `done: true`) means the family is spent.
pub(crate) async fn map_chains(State(s): State<AppState>, Query(q): Query<ChainsQuery>) -> ApiResult {
    blocking(move || {
        let store = crate::store::Store::open(&s.repo)?;
        let family = q.family.as_deref().ok_or_else(|| anyhow::anyhow!("family is required – pick one from /api/map"))?;
        let page = map::chain_family_page(&s.repo, &store, family, q.cursor.as_deref(), q.limit.unwrap_or(50).clamp(1, 500))?;
        Ok(serde_json::json!({ "chains": page.chains, "cursor": page.cursor, "done": page.done }))
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
