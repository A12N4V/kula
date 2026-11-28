# Engines

The engine modules of the kula overhaul – one design doc each, built in waves
from the plan. Every module leaves a property or equality test that is part of
the repo's proof.

| Engine | Doc | Module | What it guarantees | Proof |
|---|---|---|---|---|
| Map (T1) | [map.md](map.md) | B1 | Parse cache keyed on blob oid + grammar version; cold and warm graphs byte identical; edge sources scip > resolver > 1/k; symbol ids stable across moves | `cache_parity_cold_and_warm_graphs_are_identical`; warm reindex of kula ~0.35–0.69 s debug (fixture 1.24 s → 0.073 s) |
| Saves (T2) | [swarm-saves.md](swarm-saves.md) | B2 | Append-ordered op log on `refs/kula/ops`; save ops carry a full view; seat throttling and tree dedupe | op-log unit tests; ops equality over CLI and MCP |
| Seats & fences (T3) | [seat-config.md](seat-config.md) | B3 | Per-seat identity and fence enforcement before a change is written | fence tests incl. MCP `kula_fence_explain` |
| Isolate (T3/T4) | – | B3/B4 | Scoped views of a subsystem: symbols, edges, boundary | isolate unit tests |
| Tokens (T4) | [tokens.md](tokens.md) | B6 | Per-seat, per-run cost and metrics from one usage ledger; `usage_detail` is the only door attribution uses | ledger tests; `/api/usage` == `kula_usage` |
| Activity (T4) | [activity.md](activity.md) | B5 | Run-scoped event log: replay equals live, torn-tail safe, sessions split on 5-minute gaps | seq monotone + replay property tests; `/api/runs/{id}/events` == `kula_events` |
| Changes (T5) | [changes.md](changes.md) | B7 | Per-line agent blame (seat, run, op, cost share, flow) and a per-run changelog; moves keep their author, rewrites take the rewriter, a seat's surviving shares sum to its spend | unit tests in `attribution.rs`; `tests/b7.rs` route == MCP over real binaries |

Rendered surfaces for these engines live in `web/`; their states are the B5
event log (never compacted mid-session) and the B2 op log (append-only, so
blame is reproducible from any clone).
