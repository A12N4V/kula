# Engine: Map (T1) – parse cache, edge sources, ordered flows

Module B1. Files: `src/index/`, `src/graph/{resolve,paths,flowmap}.rs`, `src/cache.rs`, `src/store.rs`.

## Procedure

1. **Blob oids without hashing.** `cache.rs::blob_oids()` reads `git ls-files -s`
   (the git index), so every tracked file's oid is free. Untracked and
   staged-but-unmerged paths are dropped with a note; dirty worktree files are
   keyed by an FNV-1a of their content so an uncommitted edit is never served a
   stale cached parse.
2. **Parse cache.** `cache.rs::ParseCache` (SQLite at `.kula/pcache.db`) keys on
   `(blob oid, grammar version)` – `GRAMMAR_VERSION` in `index/mod.rs` bumps
   when a query changes. A hit returns the stored captures and defs
   (`CachedParse`, `CachedDef`); only misses parse. Warm runs never even load a
   grammar for a fully-cached tree.
3. **Parity.** Cached and cold graphs are byte identical – nodes and edges
   serialize with sorted keys and stable ids. Property test
   `cache_parity_cold_and_warm_graphs_are_identical` parses the same tree cold
   and warm and compares the graph bytes; bash and SQL ride in every fixture
   because their queries were the ones warm parsing silently skipped.
4. **Edge sources.** `index/scip.rs` loads `index.scip` when present (hand-rolled
   varint reader; the `scip` crate was rejected as a stated design call to avoid
   a protobuf dependency for one file format). Precedence per edge:
   scip > resolver ladder (`resolve::edge_source`) > 1/k guess. Best source
   wins; disagreements are counted and logged. Confidence tiers stay on
   `Edge::with()`.
5. **Symbol identity.** `index/identity.rs`: `symbol_id(path, name, bodyhash)`
   and `relink(old, new)`; two of the three parts matching means the same
   symbol, so B3 fences follow moves. `relink` keeps path in every pair and
   refuses ambiguous matches deterministically.
6. **Flows.** `graph/flowmap.rs`: entry points = routes ∪ mains ∪ CLI
   subcommands ∪ tests (an unused helper is never an entry point). Steps carry
   the call-site line and branch/loop flags; flows are ordered by call-site
   line. `GET /api/flowmap` and MCP `kula_flows` return the same flows (tested
   for equality over HTTP, including the default limit).

## Data layout

- `.kula/pcache.db` – one row per `(oid, grammar version)`: captures + defs.
- `.kula/index.db` – nodes, edges (with `confidence`), files, clusters.
- Warm fast path: when the base hash (nodes + edges) matches the live meta,
  publishing and clustering are skipped entirely.

## Complexity

- Cache lookup O(1) per file; parse cost only on misses.
- SCIP apply O(occurrences · defs-per-file) with per-path span lists.
- Flowmap O(edges) from entry points with line-sorted steps.

## Proof

- Unit: pcache round trip, identity two-of-three, entry finder negatives.
- Property: cache parity (cold bytes == warm bytes), uncommitted edits never
  hit a stale cache.
- Fixture: `tests/fixtures/mini-monorepo` (Rust crate + TS server + bash/SQL).
- Bench (`bench_warm_reindex_is_faster_than_cold` in `tests/b1.rs`): fixture
  cold 1.24 s → warm 0.073 s; on kula itself warm reindex is ~0.34–0.69 s
  (see `.kula-team/handoff-b1.md`).
