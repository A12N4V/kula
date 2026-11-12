# Team notes

## K1.2 (2026-11-12): Close TS and Py gaps, clean tree
- TS and Python resolvers already covered the spec gaps (`export * from` and `export {a as b}` re-export chains to depth 5 with cycle guard, `from . import x`, `__init__` re-exports). Extended tests/resolve_ts.rs and tests/resolve_py.rs pass (5 + 11 tests), including cyclic barrel cases.
- Deleted src/.DS_Store (it was tracked in git, so the deletion will be committed).
- bench/edges/truth.json covers the re-export/cycle cases (4+ labelled pairs per language); score.py records overall precision 1.00 recall 1.00 (tp 58 fp 0 fn 0), resolved tier 46/46, recorded in docs/design/resolution.md.
- Still needs a human check: score.py's default binary is `kula` from PATH, which is a stale homebrew build lacking the `confidence` column and crashes the scorer; run it with `--kula target/debug/kula`. The Go resolver step (P1.1.7) is handled elsewhere in the phase.

## 2026-11-12 K1.3 (score and record)
- Scorer `bench/edges/score.py` now prints a per-language summary line. Recorded per language: ts 14/14, py 21/21, rs 20/20, go 3/3, all precision 1.00 recall 1.00; resolved tier 46/46, inferred 10/10, guessed 2/2. Note: run it with `--kula target/debug/kula` (absolute path), the PATH binary may be stale.
- P1.1.7 Go resolver, P1.1.9 confidence-aware tools marked DONE in docs/TODO.md; P1.1.8 (SCIP) marked out of scope per the K1 spec.
- P1.1.9 closing changes: `trace` gained `--min-confidence` + tier counts (new JSON shape `{path, tiers}`), `verify_edit` reports per-tier counts and its dangling check ignores guessed edges, `pre_edit` reports tier counts. tests/cli.rs updated for the trace shape.
- Gate: cargo check, tsc --noEmit, all 6 test binaries green; scorer 1.00 everywhere.
- Needs a human: P1.1.8 SCIP still open as a backlog item; confirm the trace JSON shape change is acceptable for any external MCP clients.
