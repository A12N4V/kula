# Team notes

## K1.2 (2026-11-12): Close TS and Py gaps, clean tree
- TS and Python resolvers already covered the spec gaps (`export * from` and `export {a as b}` re-export chains to depth 5 with cycle guard, `from . import x`, `__init__` re-exports). Extended tests/resolve_ts.rs and tests/resolve_py.rs pass (5 + 11 tests), including cyclic barrel cases.
- Deleted src/.DS_Store (it was tracked in git, so the deletion will be committed).
- bench/edges/truth.json covers the re-export/cycle cases (4+ labelled pairs per language); score.py records overall precision 1.00 recall 1.00 (tp 58 fp 0 fn 0), resolved tier 46/46, recorded in docs/design/resolution.md.
- Still needs a human check: score.py's default binary is `kula` from PATH, which is a stale homebrew build lacking the `confidence` column and crashes the scorer; run it with `--kula target/debug/kula`. The Go resolver step (P1.1.7) is handled elsewhere in the phase.
