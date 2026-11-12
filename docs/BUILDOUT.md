# Kula buildout map

Run by the team engine in `.team/` (branch `team/kula`, merged to main by hand). Features first, CLI second, web last.

| Phase | Covers (docs/TODO.md) | Budget | Result |
|---|---|---|---|
| K1 | P1.1.6–P1.1.9 resolvers (Go, TS/Py gaps), confidence-aware tools | $3 | edges precision recorded |
| K2 | P1.2.2–P1.2.9 map, explain, brief, architecture check | $5 | `kula map`, `kula explain` |
| K3 | P1.3.2–P1.3.7 deps, env, routes, vocab | $4 | `kula deps`, `kula query env:` |
| K4 | P1.4.2, .4–.6, .10 plan, gate, retries, slice runner | $5 | `kula plan`, `kula gate`, `kula run` |
| K5 (queued, needs approval) | P3 Studio web UI, JetBrains Air style, code map plus orchestration canvas | $5 | web/ redesign |

Out of scope for this run: SCIP ingest (P1.1.8), LLM summaries (P1.2.8), merge train (P1.4.7), benchmarks (P1.5), release steps and posting (YOU only).
Each phase: tests first (cheap model), build steps (cheap model), gate (`cargo check`, `cargo test`), independent review (Opus 5.5), fix, tag `kula/<id>-done`.
