# Engine: Changes (T5) – who wrote every line, in dollars and in flows

Module B7. Files: `src/attribution.rs` (the whole engine), routes in
`src/server.rs`, MCP tools in `src/mcp.rs`.

## Procedure

1. **Save ops are the only source of truth.** B2's op log (`refs/kula/ops`)
   is append-ordered and each save op records the saving seat's commit in its
   view. `save_ops()` reads the log, keeps `kind == "save"` ops that have the
   saving seat's view entry, and flips to oldest first – the walk order
   ownership is decided in. Nothing is re-parsed from event streams, and no
   timestamp is trusted for ordering (ids and parents only).
2. **Ownership is decided once, walking forward.** `build()` starts from
   repository `HEAD` (the base everyone's first save edits) and, per tracked
   path (the union of `git ls-tree` over HEAD and every save commit), diffs
   each save's tree against the previous state of that path with
   `similar`'s patience diff. The rules:
   - A hunk an op introduces is owned by that op's seat, run and op id,
     forever.
   - A deleted line whose exact text (trimmed, FNV-1a `LineHash`) reappears
     later in the same file diff keeps its original owner: moved code stays
     with its author. This is line-hash based, deliberately not
     `identity::relink` symbol matching – a move must not reattach a whole
     symbol to a new author just because it looks related.
   - Two guards make moves conservative. A candidate line must be at least
     `MOVE_MIN_LEN = 12` trimmed characters (braces, `use …` and other
     boilerplate never transfer ownership), and its hash must match exactly
     one pending deletion – ambiguous duplicated or boilerplate lines keep
     their previous owner instead of being guessed to the mover.
   - A line rewritten into different text takes the rewriter's owner; the
     previous owner's claim on it ends there.
   - Pending deletions survive across hunks within one file diff, so a line
     deleted early and re-inserted inside a later replace hunk is still
     matched (this is how a move that patience renders as
     `Delete … Equal … Replace` stays attributed).
3. **Cost share = the seat's spend, on the lines that survive.** For each
   owning save op, the seat's cost for the run comes from B6's
   `runs::usage_detail(kula_dir, run, seat)` – the ledger is read once per
   seat, never re-parsed raw. That spend is spread evenly over the op's lines
   that still exist at the newest state, so each seat's surviving shares sum
   to exactly its spend, and the run's total lands somewhere on every line.
   Lines a later rewrite took over stop carrying the earlier seat's dollars;
   the rewriter's own save bills them instead. A seat with usage but no
   surviving lines (everything it wrote was rewritten) shows no shares – its
   money is recorded in the changelog via the other seats' takeovers, and
   `spent` stays visible in B6's own views.
4. **Flows.** `flow_of()` maps a change to a flow by calling
   `graph::flowmap` and taking the shortest flow path containing the changed
   file (smallest flow id breaks ties), so a changelog groups by the flow the
   work actually happened in.
5. **Symbols.** `symbol_at()` resolves the owning save's symbol for a line by
   asking the store for definitions covering the line span and picking the
   tightest one; the body hash is computed from the worktree slice, so a
   symbol id matches what B1 would index today.

## Surfaces

- `GET /api/blame/agents?path=<rel>` → `{ path, lines: [ { line, seat, run,
  op, cost_share, flow, symbol, symbol_name } ] }` – one entry per worktree
  line. Lines whose text drifted from the newest save (edited without a save
  op) have empty provenance: attribution is decided by save ops, not guesses.
- `GET /api/runs/{id}/changelog` → `{ run, changes: [ { path, start_line,
  end_line, kind, seat, run, op, cost_share, flow } ] }` – consecutive lines
  owned by the same op are grouped into one change; `kind` is `move`, `add`
  or `edit` (edit = lines that entered via rewrite).
- MCP: `kula_blame_agents` (params `path`) and `kula_changelog` (params `run`)
  return the same payloads as the routes; `tests/b7.rs` asserts byte-equality
  of both doors over real binaries.

## State required

Blame and changelog read only save ops (`refs/kula/ops`), the trees they
point at, B6's per-run usage ledger (`.kula/runs/<run>.usage.jsonl`) and the
flowmap. They do **not** read the event log, so B5's lazy compaction cannot
change their output; the state they need is never compacted away.

## Proof

- Unit tests in `src/attribution.rs`: move keeps owner, duplicated lines do
  not transfer ownership, rewrite takes the rewriter, the full three-seat
  fixture (moves + rewrites + seeded dollars, sums per seat, determinism),
  changelog grouping.
- `tests/b7.rs`: the fixture repo in `tests/fixtures/attribution/` hand-builds
  the save ops in the exact `append_op_seat` shape, seeds the ledger, and
  checks the story through MCP and route-vs-MCP equality.
