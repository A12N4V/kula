# Kula buildout map

Run by the team engine in `.team/` (branch `team/kula`, merged to main by hand). Features first, CLI second, web last.

| Phase | Covers (docs/TODO.md) | Budget | Result |
|---|---|---|---|
| K1 | P1.1.6–P1.1.9 resolvers (Go, TS/Py gaps), confidence-aware tools | $3 | DONE: edges precision recorded |
| K2 | P1.2.2–P1.2.9 map, explain, brief, architecture check | $5 | DONE 178cab8: `kula map`, `kula explain`, `kula brief` |
| K3 | P1.3.2–P1.3.7 deps, env, routes, vocab | $4 | DONE 476c430: `kula deps`, `kula query env:`, routes |
| K4 | P1.4.2, .4–.6, .10 plan, gate, retries, slice runner | $5 | DONE 566cd89: `kula plan`, `kula gate`, `kula run-plan`; memory check, `run-plan --status` and blast radius notes, plan kept in `refs/kula/meta`; P1.4.7 `kula merge-train` into an integration branch with a final gate; P1.4.8 slice facts become symbol-anchored memories at merge, slice suggestions queue for review |
| K1b | P1.1.10 edge and schema audit | – | DONE: findings fixed, report `docs/audits/2026-11-edges.md`, bench 0.97/1.00 with `resolved` 59/59 |
| K4b | P1.4.9 guard hardening | – | DONE: bypass matrix closed, regression tests in `tests/cli.rs`, report `docs/audits/2026-11-guard-bypass.md` |
| K4c | P1.3.5 tables layer | – | DONE: ORM models and SQL migrations become Table nodes; `query table:` and `impact table:` reach handlers; KG vocab 4 |
| K4d | P1.3.8 tables audit | – | DONE: 14 critic findings fixed (import scoped uses, SQL in strings only, case folding, new Drizzle/Prisma/SQL forms, inferred uses in impact) |
| K2b | P1.2.10 map audit | – | DONE: 5 repos audited, findings fixed or accepted, report `docs/audits/2026-11-map.md`, bench 0.97/1.00 |
| K5 DONE | P3 Studio web UI, JetBrains Air style, code map plus orchestration canvas | $5 | web/ redesign |

Out of scope for this run: SCIP ingest (P1.1.8), LLM summaries (P1.2.8), merge train (P1.4.7), benchmarks (P1.5), release steps and posting (YOU only).
Each phase: tests first (cheap model), build steps (cheap model), gate (`cargo check`, `cargo test`), independent review (Opus 5.5), fix, tag `kula/<id>-done`.
