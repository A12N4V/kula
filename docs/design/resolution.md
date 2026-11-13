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
- Fences and `pre_edit` keep using all edges (safe side), but report the tier counts so a reviewer sees how solid a warning is. The `verify_edit` dangling-caller check skips `guessed` edges.
- IMPORTS edges are tiered too: a resolver or exact path hit is `resolved`, a single suffix match on a multi-segment key is `inferred`, anything looser is `guessed`. Go imports resolve through the `go.mod` module path. File level DEPENDS rows and `context` neighbours carry the best tier seen.
- A reference that matches several symbols is an error listing `path:name` (or `path:Owner.name`); `path:Owner.name` and `path:Owner::name` pick a member.

## Resolvers (P1.1.4–P1.1.7)

A resolver is a per-language pass run after parsing, before the name linker. It receives the file's import table and the symbol table and returns exact `(caller, callee)` pairs. Calls it resolves are written `resolved`; the name linker skips those call sites. Anything it cannot resolve falls through unchanged, so a resolver can only raise precision, never remove edges.

Order: TypeScript/JavaScript (imports, re-exports, barrels, `this`, class members, tsconfig paths), Python (imports, relative imports, `self`), Rust (`use` trees, `mod` paths, `impl` blocks), Go (packages, method sets).

## SCIP (P1.1.8)

`kula index --scip file` ingests a SCIP index from an existing indexer. Occurrences with a definition map to nodes by path and range and become `resolved` edges, replacing the guessed ones for that call site.

## Measurement (P1.1.2)

`bench/edges/` holds hand-labelled ground-truth edge sets per fixture and a scorer reporting precision and recall per tier. A resolver is accepted when precision on its language's set improves with recall not dropping.

Recorded 2026-11-12 after the P1.1.10 audit (`KULA_NO_AGENT=1 python3 bench/edges/score.py --kula target/debug/kula`; the PATH `kula` may be stale and must not be used). Truth is path qualified, so a wrong same-name target is a false positive. Overall precision 0.97 recall 1.00 (tp 73 fp 2 fn 0); `resolved` 59/59 = 1.00, `inferred` 11/12, `guessed` 3/4.

| lang | precision | recall | tp | fp |
|---|---|---|---|---|
| ts | 1.00 | 1.00 | 19 | 0 |
| py | 1.00 | 1.00 | 23 | 0 |
| rs | 0.96 | 1.00 | 23 | 1 (`guessed`, glob ambiguity) |
| go | 0.89 | 1.00 | 8 | 1 (`inferred`, interface by name) |

Both false positives are in tiers that say they may be wrong; `docs/audits/2026-11-edges.md` has the detail.

## Migration

`SCHEMA_VERSION` (now 5) is stored in meta key `schema`, and the building kula version in `indexer`. A mismatch in either reads as `stale`, triggers a rebuild, and any command opening the old index prints one stderr hint to run `kula index` (`KULA_QUIET_STALE=1` silences it). Opening an old DB adds the `confidence` column (default `inferred`) so reads never fail before the rebuild runs.
