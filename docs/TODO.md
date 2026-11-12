# Kula master todo

Goal: the AI orchestration toolkit for codebases. It maps, simplifies and deconstructs a repo, then plans, runs and gates agent work against that map.
Order: **features first, complex CLI second, web UI last.** Written 2026-11-08.

## How to read this

- **ID**: `phase.section.item`, e.g. `P1.2.3`. `needs:` lists IDs that must be done first.
- **Owner** is who does the work:
  - `YOU` – decision or action only you can take (merges, tags, accounts, posting, history wipe).
  - `MAIN` – the main Claude session (design-heavy or cross-cutting code).
  - `WORKER` – a general-purpose agent given one scoped item and its acceptance test.
  - `PLAN` – the Plan agent produces a design doc before code starts.
  - `CRITIC` – the `kula-critic` agent audits; read-only, returns a ranked report.
  - `UICRITIC` – the `ui-critic` agent; used in P3 only.
  - `EXPLORE` – read-only search agent for fact-finding.
- **Done** means the acceptance line is true and `./scripts/test.sh` passes.
- **Resource rules** (16 GB Mac): run `memguard.sh` before any heavy job; one heavy job at a time (build, tests, Playwright, indexing a big repo); `cargo -j 4`; never cargo alongside Playwright or `pnpm build`. Delegation below is therefore **sequential lanes, not parallel agents**. Read-only CRITIC/EXPLORE/PLAN work may overlap with one heavy job.
- Repo rules: commit straight to main, no attribution trailers, en dashes only in docs, verify builds first, never clobber the dirty tree.

---

## P0 – Ground work (before any feature)

| ID | Task | Owner | needs | Acceptance |
|---|---|---|---|---|
| P0.1 | DONE: licence is MIT everywhere (checked live: GitHub, crates.io, PyPI, brew, nix, npm) | YOU | – | Done |
| P0.2 | DONE: 0.3.0 live on GitHub, crates.io, PyPI, brew, apt (1:0.3.0); npm launcher is 0.3.1 by design | YOU | – | Done |
| P0.3 | DONE 2026-11-11: dirty tree and UI work discarded; main reset to origin/main, old work kept on backup/* branches | MAIN | – | Done |
| P0.4 | DONE: `@kula-cli/kula` is live on npm (MIT); README is accurate | YOU | P0.2 | Done |
| P0.5 | DONE 2026-11-11: stale tags and releases deleted; only v0.3.0 remains | YOU | P0.2 | Done |
| P0.6 | DONE 2026-11-11: report in `docs/audits/2026-11-baseline.md`; no blockers. Follow-ups: filing local issues for majors 2-4 | CRITIC | P0.3 | Done |
| P0.7 | DONE 2026-11-11: `main.rs` is 90 lines; CLI types in `src/cli.rs`, handlers in `src/cmd/*.rs`; fmt, clippy and tests green | WORKER | P0.3 | Done |
| P0.8 | DONE 2026-11-11 (`scripts/stats.sh`). Telemetry-free usage signal: decide how we will know adoption (GitHub traffic, release downloads, crates/pypi/brew counts) and script it | MAIN | – | `scripts/stats.sh` prints stars, views, clones, downloads per channel |

Gate G0: PASSED 2026-11-11 (P0.1–P0.3, P0.6, P0.7 done; no blockers). Fix any CRITIC "blocker" items before P1.

---

## P1 – Features (the engine)

### P1.1 Edge quality (do first; everything rests on it)

| ID | Task | Owner | needs | Acceptance |
|---|---|---|---|---|
| P1.1.1 | DONE 2026-11-11 (docs/design/resolution.md): Design doc: resolution architecture. Per-language resolvers vs SCIP ingest; edge schema with `confidence` = resolved / inferred / guessed; migration of existing index | PLAN | G0 | `docs/design/resolution.md` reviewed by YOU |
| P1.1.2 | PARTIAL 2026-11-11: scorer + 4 small hand-labelled fixtures (~16 edges, `bench/edges/score.py`); scaling to ~300 edges per real repo still open. Ground-truth set: label call edges by hand or from compiler/LSP output on 4 repos (one each: TS, Python, Rust, Go), ~300 edges each | WORKER | P1.1.1 | `bench/edges/*.json` + scorer script reporting precision and recall per confidence tier |
| P1.1.3 | DONE 2026-11-11: Add `confidence` to the edges table, tag every existing edge `guessed` or `inferred` (same-file, imported), index version bump | MAIN | P1.1.1 | Old indexes rebuild cleanly; `impact`/`trace` output shows confidence |
| P1.1.4 | DONE 2026-11-11: `ResolveCtx`/`ResolveOut`/`Resolver` hook in `src/index/resolve/mod.rs`; the `this`/`self` rule moved behind `resolve::self_target` unchanged. TS/JS resolver (`src/index/resolve/ts.rs`): named, default and namespace imports, aliased imports, re-exports and barrels (`export *`, `export {x as y} from`) chasing to depth 5 with cycle protection, member calls on an imported class via `new` expressions and typed params, tsconfig `paths`/`baseUrl` (JSONC). TS fixture set 16 → 25 edges, recall 0.96 → 1.00, overall precision 1.00 recall 1.00, `resolved` tier 13/13 | WORKER | P1.1.3 | Recall on the TS set rises vs baseline; precision of `resolved` tier ≥ 95% |
| P1.1.5 | DONE 2026-11-11: Python resolver (`src/index/resolve/py.rs`): `import a.b as c` and `c.fn()`, `from a import b` (aliased too), relative imports (`.`/`..`), `__init__.py` re-export chasing to depth 5 with cycle protection, `self.method()` including inherited in-repo bases, `cls.method()`, `Klass.method()`, and `x = Klass(); x.m()` in one function body. Python fixture set 5 → 20 edges, `resolved` tier 3/5 → 15/20, precision 1.00 everywhere | WORKER | P1.1.3 | Same bar on the Python set |
| P1.1.6 | Resolver: Rust (`use` trees, `mod` paths, `impl` blocks, trait methods by receiver where cheap) | WORKER | P1.1.3 | Same bar on the Rust set |
| P1.1.7 | Resolver: Go (packages, method sets, interface satisfaction by name) | WORKER | P1.1.3 | Same bar on the Go set |
| P1.1.8 | Optional SCIP ingest (`kula index --scip file`) to replace guessed edges with exact ones where an indexer exists | WORKER | P1.1.3 | An imported SCIP index overrides guessed edges; round trip test |
| P1.1.9 | Make tools confidence-aware: `impact`, `trace`, `verify_edit`, `pre_edit` report counts per tier and an option `--min-confidence` | MAIN | P1.1.4 | MCP schema + CLI flag documented; dangling-caller check no longer fires on `guessed` edges by default |
| P1.1.10 | Audit edges and the new schema | CRITIC | P1.1.9 | No blocker; findings triaged |

### P1.2 Semantic map (simplify, deconstruct, map)

| ID | Task | Owner | needs | Acceptance |
|---|---|---|---|---|
| P1.2.1 | Design doc: hierarchy (package → module → symbol), cluster naming, layers, entry points, summaries, storage (index vs `refs/kula/meta`) | PLAN | P1.1.3 | `docs/design/map.md` reviewed by YOU |
| P1.2.2 | Module tree from directories + manifests (Cargo, package.json, pyproject, go.mod), with size, churn (git), fan-in/out | WORKER | P1.2.1 | `kula map --json` emits the tree; correct on kula itself |
| P1.2.3 | Deterministic cluster naming: distinctive vocabulary of symbols and paths per cluster; stable names across reindexes | WORKER | P1.2.1 | Names stable across 3 consecutive indexes of an unchanged repo; hand-reviewed on 3 repos |
| P1.2.4 | Entry-point detection: CLI mains, HTTP route handlers, job/cron handlers, test roots, exported public API | WORKER | P1.2.1 | `kula flows` starts from detected entries; recall check on the 4 bench repos |
| P1.2.5 | Layer and architecture checks: dependency direction, cycles between modules, coupling score, god modules, dead code candidates | WORKER | P1.2.2 | `kula check architecture` exits non-zero on a seeded cycle; rules configurable in `kula.toml` |
| P1.2.6 | `kula map` – whole repo at four zoom levels (repo, package, module, symbol) in terminal/markdown/JSON/Mermaid | MAIN | P1.2.2–P1.2.4 | Output for kula and 2 other repos checked by YOU as "readable by a newcomer" |
| P1.2.7 | `kula explain <module\|symbol\|file>` – purpose, public surface, who depends on it, what it depends on, hot spots, related memories/notes | WORKER | P1.2.6 | Works offline with deterministic text; marked sections for optional LLM prose |
| P1.2.8 | Optional LLM summaries per module, cached in git, invalidated when the module's content hash changes; provider from `[agents]` config | WORKER | P1.2.7 | Second run costs zero calls; stale summaries flagged |
| P1.2.9 | Architecture brief: `kula brief` writes a one-page repo overview into `AGENTS.md` sync and the `context_pack` preamble | WORKER | P1.2.6 | Brief under 1,500 tokens; included by `agents sync` |
| P1.2.10 | Audit map quality: run `kula map` on 5 public repos of different shapes and judge | CRITIC | P1.2.9 | Report with at least one mis-clustering example per repo and fix list |

### P1.3 Runtime and data layers

| ID | Task | Owner | needs | Acceptance |
|---|---|---|---|---|
| P1.3.1 | Design doc: new node kinds (route, model, env var, config key, dependency, event/queue, table) and edge kinds (handles, reads, writes, publishes, subscribes, depends_on) | PLAN | P1.2.1 | `docs/design/layers.md` |
| P1.3.2 | Dependencies as nodes from manifests and lockfiles; `used_by` edges from imports | WORKER | P1.3.1 | `kula deps` lists packages with the files that import them; unused declared deps flagged |
| P1.3.3 | Env vars and config keys: `process.env.X`, `os.environ`, `std::env::var`, `.env.example`, `kula.toml`-style files | WORKER | P1.3.1 | `kula query env:` lists every reader of a variable |
| P1.3.4 | HTTP routes: Express/Fastify/Next route files, FastAPI/Flask/Django, axum/actix, Go net/http and gin | WORKER | P1.3.1 | Route → handler edges in the graph on fixtures for each framework |
| P1.3.5 | DB models and tables: SQLAlchemy/Django ORM, Prisma, Drizzle, SQL migrations | WORKER | P1.3.1 | Model → table nodes; `impact` of a table reaches handlers that use it |
| P1.3.6 | Cross-language links: client call → route by path string and OpenAPI spec | WORKER | P1.3.4 | A TS fetch of `/api/x` links to the Python handler on a two-language fixture |
| P1.3.7 | Extend SPARQL vocabulary and `kg export` with the new classes and properties; version the vocab | MAIN | P1.3.2–P1.3.5 | `docs/KNOWLEDGE-GRAPH.md` updated; export round-trips |
| P1.3.8 | Audit | CRITIC | P1.3.7 | Report triaged |

### P1.4 Active orchestration (plan, run, gate)

| ID | Task | Owner | needs | Acceptance |
|---|---|---|---|---|
| P1.4.1 | Design doc: task model (goal → plan → slices), slice = scope + workflow + agent + base ref + tests; run states; gate rules; how it fits `start_task` and teams | PLAN | P1.2.6 | `docs/design/orchestration.md` reviewed by YOU |
| P1.4.2 | `kula plan "<goal>"`: scope from the graph (query + `context_pack`), affected modules and tests, risk, then slices with dependencies; deterministic skeleton, agent fills in wording | MAIN | P1.4.1 | Plan JSON stored in `refs/kula/meta`; slices have no overlapping write scope unless ordered |
| P1.4.3 | Slice runner: one git worktree per slice, fences and scope applied, agent launched through the existing connect layer (Claude Code, Codex, Gemini CLI, Cursor where headless) | MAIN | P1.4.2 | A two-slice plan runs end to end on a fixture repo; the lock on slice A's files holds against slice B |
| P1.4.4 | Concurrency control: `max_parallel` setting (default 2), refuses to start without enough memory (calls memguard on this machine style checks via a hook) | WORKER | P1.4.3 | Third slice queues; visible in `kula run status` |
| P1.4.5 | Gate: after a slice, run `verify_edit`, the slice's tests, `graph-diff` against the plan's expected blast radius, architecture check; verdict pass / fix / reject | MAIN | P1.4.3, P1.2.5 | A slice that touches a locked symbol or breaks a caller is rejected with a report an agent can act on |
| P1.4.6 | Feedback loop: a failed gate hands the report back to the same agent (bounded retries, default 2), then escalates to a person | WORKER | P1.4.5 | Retry cap enforced; transcript of each attempt stored |
| P1.4.7 | Merge train: passing slices merge in dependency order into an integration branch; conflicts become a new slice; final gate on the integrated result | MAIN | P1.4.5 | Integration branch passes `./scripts/test.sh` on the fixture; nothing lands on main without YOU |
| P1.4.8 | Memory and suggestion flow: each slice's learned facts proposed as memories anchored to symbols; fence suggestions surfaced for review | WORKER | P1.4.7 | Memories created pinned to symbols, marked stale correctly after later edits |
| P1.4.9 | Guard hardening: attempt to bypass fences (sed, mv, git apply, symlinks, subshells, other tools) in a test matrix; every route refused | CRITIC | P1.4.5 | Report; each bypass becomes a regression test in `tests/cli.rs` |
| P1.4.10 | Extend tests: no test may launch a real agent (`KULA_NO_AGENT` guard stays) | WORKER | P1.4.3 | Test suite uses a fake agent binary |

### P1.5 Proof (benchmarks)

| ID | Task | Owner | needs | Acceptance |
|---|---|---|---|---|
| P1.5.1 | Pick 3–5 public repos and 15–25 tasks (bug fixes, small features, refactors) with objective checks (tests pass, protected files untouched) | YOU + EXPLORE | P1.4.3 | `bench/tasks.json` |
| P1.5.2 | Harness: run each task with and without kula (same agent, same budget), record success, tokens, wall time, protected-code edits | WORKER | P1.5.1 | `kula bench` reproducible with one command; results to `bench/results/` |
| P1.5.3 | Competitor comparison on retrieval quality: `context_pack` vs grep vs GitNexus vs codebase-memory-mcp on the same questions | WORKER | P1.5.1 | Table in `docs/BENCHMARKS.md` with method and caveats |
| P1.5.4 | Performance: index time, memory, incremental update time on a large repo (target a 100k-file monorepo) | WORKER | P1.5.1 | Numbers published; regressions fail CI past a threshold |
| P1.5.5 | Independent review of the benchmark methodology | CRITIC | P1.5.3 | Report; no result published that the critic can break |

Gate G1: P1.1–P1.5 done, `CRITIC` has no blockers, benchmarks show a clear win on at least one axis. If they don't, stop and rework before P2.

---

## P2 – The CLI

| ID | Task | Owner | needs | Acceptance |
|---|---|---|---|---|
| P2.1 | Design the command surface: headline verbs `map`, `explain`, `plan`, `run`, `gate`, `bench`, `check`, plus the git passthrough; naming, flags, output formats, exit codes | PLAN | G1 | `docs/design/cli.md` approved by YOU |
| P2.2 | Output layer: every command has human, `--json` and `--md` modes from the same data structure; stable JSON schemas versioned | WORKER | P2.1 | Schema files in `docs/schemas/`; snapshot tests |
| P2.3 | Config: `kula.toml` schema validation, `kula config get/set`, `kula doctor` (git, hooks, agents connected, index health, versions) | WORKER | P2.1 | `kula doctor` fixes or explains each failing check |
| P2.4 | Completions (bash, zsh, fish, PowerShell) and man pages generated at build | WORKER | P2.1 | Included in release assets, brew and deb |
| P2.5 | TUI: zoomable map, impact view, run dashboard (plan, slice states, gate results, diffs), keyboard driven | MAIN | P2.2 | Works over SSH and in a 80×24 terminal; no flicker; usable without mouse |
| P2.6 | Watch mode and incremental indexing: only reparse changed files, keep the graph live while agents edit | WORKER | P2.2 | Update under 1 s for a single-file change on kula; verified on a large repo |
| P2.7 | CI mode: `kula check --ci` with annotations for GitHub Actions and a reusable action; PR comment with `graph-diff` | WORKER | P2.2 | Example workflow in README; sample PR comment captured |
| P2.8 | Error and help text pass: every error says what to do next; `kula help <topic>` guides for the new workflows | WORKER | P2.2 | Reviewed by CRITIC for dead-end errors |
| P2.9 | Plugin points: custom workflows, custom resolvers and custom checks loaded from `.kula/` | MAIN | P2.2 | A sample plugin in `examples/` works; documented |
| P2.10 | Audit the CLI as a new user would meet it: install on a clean machine, follow README, report friction | CRITIC | P2.8 | Time-to-first-map under 5 minutes on a fresh repo |
| P2.11 | Release: version, changelog, tag, brew, apt, crates, pypi, npm, nix; update docs | MAIN, then YOU | P2.10 | All channels show the same version and install successfully |

Gate G2: CLI audit has no blockers; release published.

---

## P3 – Web UI (last)

| ID | Task | Owner | needs | Acceptance |
|---|---|---|---|---|
| P3.1 | Design brief: what the UI must show for the new features (map, plan board, run board, structural diff review, confidence overlay); keep the project's rules: never change button sizes, toggles over tabs, signal over effects, no glow, harmonograph and shader logo language | PLAN | G2 | `docs/design/ui.md` approved by YOU |
| P3.2 | API: every UI view backed by the same JSON as the CLI (`/api/map`, `/api/plan`, `/api/run`, `/api/gate`) | WORKER | P3.1 | No UI-only data paths |
| P3.3 | Architecture map view: zoomable hierarchy, cluster names, layer bands, cycle highlights, confidence toggle | MAIN | P3.2 | Loads kula and a 5k-file repo in under 2 s; readable at phone width |
| P3.4 | Explain panel on click: purpose, public surface, dependents, memories, history | WORKER | P3.3 | Parity with `kula explain` |
| P3.5 | Plan board: slices as columns with dependencies, scope overlays on the map, edit and approve plan | MAIN | P3.2 | Approve in the UI triggers `kula run` |
| P3.6 | Run board: live slice state, agent output, gate results, retry history, merge train | MAIN | P3.5 | Updates without refresh; stop and retry controls |
| P3.7 | Structural review: graph-diff centred pull request view with risk by blast radius, approve/merge | WORKER | P3.2 | Replaces line-by-line as the default review view |
| P3.8 | e2e tests on a disposable fixture (existing harness), screenshots refreshed | WORKER | P3.3–P3.7 | One Playwright run at a time, `--workers=2` |
| P3.9 | UI critique loop until score target met | UICRITIC, then MAIN | P3.8 | Target score agreed with YOU; no spills at desktop/tablet/phone |
| P3.10 | Final audit, release | CRITIC, then MAIN/YOU | P3.9 | v-next released across all channels |

---

## Attention track (runs alongside; owner is mostly YOU)

| ID | Task | Owner | needs | Acceptance |
|---|---|---|---|---|
| A.1 | Post the existing launch film and README GIF where developers are (X, a YouTube upload, r/rust, r/ClaudeAI, r/programming, Hacker News "Show HN") with a plain description, not marketing | YOU | P0.1, P0.2 | Posted; results recorded by `scripts/stats.sh` |
| A.2 | After P1.2.6: publish a `kula map` of a famous open-source repo as a one-page visual (the strongest demo of "understand any codebase") | MAIN draws, YOU posts | P1.2.6 | Page live; link in README |
| A.3 | After P1.5.3: publish the benchmark write-up | MAIN drafts, YOU posts | P1.5.3 | Post linked from README |
| A.4 | Submit to agent/MCP directories and awesome lists (MCP registry, awesome-mcp, Claude Code plugin lists) | YOU | P0.4 | Listed in at least 4 |
| A.5 | Open 5 "good first issue" local issues mirrored to GitHub to invite contributors | MAIN | P0.6 | Issues exist with clear acceptance |
| A.6 | Track weekly: stars, views, clones, downloads per channel; review at each gate | MAIN | P0.8 | Table appended to this file at G0, G1, G2 |
| A.7 | homebrew-core submission when eligible (225 stars, repo 30+ days old) | YOU | stars | Formula in `packaging/homebrew/kula-core.rb` submitted |

---

## Delegation lanes (sequential, because of the 16 GB limit)

1. **Lane A, engine:** P0.3 → P0.7 → P1.1.3 → resolvers P1.1.4–P1.1.7 one at a time → P1.2 → P1.3 → P1.4.
2. **Lane B, read-only alongside Lane A:** PLAN designs the next section while WORKER builds the current one; CRITIC audits each finished section; EXPLORE gathers repos and facts for P1.5.1.
3. **Lane C, YOU:** P0.1, P0.2, P0.4, P0.5, design approvals at each PLAN doc, all posting and merging.

Per work item, the loop is: PLAN doc approved → WORKER implements on main in small commits → `./scripts/test.sh` → CRITIC audits → fix findings → next item.

## First five moves

1. YOU: answer P0.1 (licence) and P0.2 (version).
2. MAIN: P0.3, commit the dirty tree in logical commits (after you look at the diff list).
3. CRITIC: P0.6, baseline audit.
4. WORKER: P0.7, split `main.rs`.
5. PLAN: P1.1.1, the resolution design doc.
