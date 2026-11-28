# Swarm saves: the op log and autosave

The swarm records what a team of agents did as a chain of **ops** on
`refs/kula/ops` – one git commit per operation. Nothing is ever deleted or
rewritten: undo is a new op, so history stays whole.

## Ops

Each op is a commit whose tree holds one `op.json` document:

- `id` – the op commit's own oid (content addressed, unique, ordered by the log)
- `kind` – `launch | save | commit | handoff | gate | merge | undo`
- `run` – the run id the op belongs to
- `parent` – the previous op's id (the first op has none)
- `view` – the head of every seat in the run at that moment: seat id → commit
- `seat`, `message`, `time` – what it concerns, what it says, when

The launch op opens a run with every seat at its base commit; each kept slice
appends a commit op that advances its seat's entry in the view.

## Autosave

While an agent works, kula snapshots its seat's worktree between attempts
without touching the seat's branch or HEAD: a temporary `GIT_INDEX_FILE` gets
`add -A`, `write-tree` produces a content-addressed tree, and `commit-tree`
stores it under `refs/kula/saves/<seat>/<n>`. Saves dedupe on the tree id
(no change, no save) and throttle to one per seat per 30 s
(`KULA_SAVE_MIN_SECS` overrides it).

## Undo, restore, fork

- `undo to <op>` appends an undo op whose view equals the target's view and
  resets every seat's worktree to its entry in that view (`read-tree -u
  --reset` plus `clean` – branches never move). A seat that is running or
  gating is refused: an in-flight agent keeps its floor.
- `restore <save>` does the same for one seat from a save ref.
- `fork from <commit>` grows a new branch and worktree from any op view entry
  or save, leaving the original branch alone.

Undo of undo is legal and restores the same view – the property test
`ops::property_tests::undo_of_undo_restores_the_view` proves it.

## Surface

- `GET /api/ops?limit=` – the log, newest first
- `GET /api/ops/{id}` – one op with its view
- `POST /api/ops/undo {"op": "<id|save ref>", "run": "..."}` – undo
- `GET /api/saves?seat=<seat>` – a seat's autosaves, newest first
- MCP tool `kula_ops` – the log, or one op in full

## Testing

- Unit: `ops::tests` – ids unique and ordered, view read-back, dedupe,
  throttle, restore and fork leave branches alone.
- Property: `ops::property_tests` – 24 pseudo-random ops with interleaved
  undos; undo of undo restores the view, ids stay unique and chained.
- Fixture: `tests/fixtures/team3` – a 3-seat team; `tests/ops.rs` runs a real
  `run-plan` with the fake agent and checks the launch view names all three
  seats and each seat appends a chained commit op.
- `orch::run::view_tests` – `apply_view` resets worktrees, refuses active
  seats, never moves branches.
