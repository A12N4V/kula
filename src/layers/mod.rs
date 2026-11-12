//! Runtime layers: graph facts beyond the code itself. Each layer turns plain
//! text in the tree (manifests, env reads, later routes) into nodes and edges
//! during the index build.

pub mod deps;
pub mod env;
pub mod route_scan;
pub mod routes;

use crate::index::Reader;
use crate::store::{Edge, Node};
use std::collections::HashMap;

/// Insert every layer's nodes and edges into a graph under construction.
/// Runs after imports and calls are linked, before communities.
#[allow(clippy::too_many_arguments)]
pub(crate) fn apply(
    parsed: &[crate::index::ParsedFile],
    sym_ids: &[Vec<usize>],
    files: &[(String, Option<&'static str>)],
    read: Reader,
    nodes: &mut Vec<Node>,
    edges: &mut Vec<Edge>,
    file_id: &HashMap<String, usize>,
    hashes: &mut Vec<u64>,
) {
    deps::apply(parsed, files, read, nodes, edges, file_id, hashes);
    env::apply(parsed, sym_ids, files, read, nodes, edges, file_id, hashes);
    routes::apply(parsed, sym_ids, files, read, nodes, edges, file_id, hashes);
}
