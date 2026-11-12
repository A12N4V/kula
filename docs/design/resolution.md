# Call resolution and edge confidence

Status: accepted 2026-11-11. Implements P1.1.1; schema work shipped as P1.1.3.

## Problem

The linker in `src/index/mod.rs` resolves calls by name. It prefers a same-file match, then names in imported files, then a fallback of at most 3 same-language candidates. It has no types, so `a.get()` can link to the wrong `get`. Every downstream tool (`impact`, `trace`, fences, `verify_edit`) inherits that error without saying so.

## Tiers

Every edge carries `confidence`:

| Tier | Meaning | Source |
|---|---|---|
| `resolved` | Exact. Structural edges (CONTAINS, IMPORTS to a resolved file) and calls resolved by a language resolver or SCIP. | resolver, SCIP, structure |
| `inferred` | Unique name match in the same file or an imported file. | name linker |
| `guessed` | One of several name matches. | name linker |

Order is `resolved > inferred > guessed`. A path's confidence is its weakest edge.

## Surfaces

- `impact` returns per-tier counts and a per-hit `confidence`; `--min-confidence` (CLI) and `min_confidence` (MCP) drop weaker edges.
- Fences and `pre_edit` keep using all edges (safe side), but report the tier counts so a reviewer sees how solid a warning is.

## Resolvers (P1.1.4–P1.1.7)

A resolver is a per-language pass run after parsing, before the name linker. It receives the file's import table and the symbol table and returns exact `(caller, callee)` pairs. Calls it resolves are written `resolved`; the name linker skips those call sites. Anything it cannot resolve falls through unchanged, so a resolver can only raise precision, never remove edges.

Order: TypeScript/JavaScript (imports, re-exports, barrels, `this`, class members, tsconfig paths), Python (imports, relative imports, `self`), Rust (`use` trees, `mod` paths, `impl` blocks), Go (packages, method sets).

## SCIP (P1.1.8)

`kula index --scip file` ingests a SCIP index from an existing indexer. Occurrences with a definition map to nodes by path and range and become `resolved` edges, replacing the guessed ones for that call site.

## Measurement (P1.1.2)

`bench/edges/` holds hand-labelled ground-truth edge sets per fixture and a scorer reporting precision and recall per tier. A resolver is accepted when precision on its language's set improves with recall not dropping.

Recorded 2026-11-12 (`python3 bench/edges/score.py --kula target/debug/kula`; the PATH `kula` may be stale and must not be used): overall precision 1.00 recall 1.00 (tp 58 fp 0 fn 0); `resolved` tier 46/46 = 1.00, `inferred` 10/10, `guessed` 2/2. `resolved` precision is above the 0.95 bar on every fixture set (ts, py, rs, go).

Per language, same run (the scorer prints a per-language summary since 2026-11-12):

| lang | precision | recall | edges | `resolved` before → after |
|---|---|---|---|---|
| ts | 1.00 | 1.00 | 14 | 13/16 → 13/14 resolved-tier precision |
| py | 1.00 | 1.00 | 21 | 3/5 → 16/21 resolved-tier precision |
| rs | 1.00 | 1.00 | 20 | 0/3 → 17/20 resolved-tier precision |
| go | 1.00 | 1.00 | 3 | 0/3 → all 3 `resolved` (P1.1.7 closed) |

Before/after tier detail per language is in `docs/TODO.md` on the P1.1.4–P1.1.7 lines; the Go resolver's first recorded run is this one: 3/3 edges `resolved`, precision 1.00 recall 1.00, above the 0.95 bar.

## Migration

`SCHEMA_VERSION` is stored in meta key `schema`. A mismatch reads as `stale` and triggers a rebuild. Opening an old DB adds the `confidence` column (default `inferred`) so reads never fail before the rebuild runs.
