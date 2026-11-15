# Agent hub

The Agents area is one node canvas. Each node is one agent seat and each group is one team. The canvas sits on top of a flow map of the codebase, so teams are built around how the code actually runs. Teams can be launched or scheduled from the canvas, and every run is recorded with its stats, a score and a synopsis.

Tracked as H.1–H.9 in [TODO](../TODO.md).

## Flow map (H.1)

`graph::flowmap(store, limit)` turns entry points into ordered execution flows.

- **Entries**, each with a kind:
  - `route`: the handler a `HANDLES` edge points to (the route pattern is kept);
  - `main`: a function named `main`;
  - `test`: an uncalled caller under a test path;
  - `entry`: any other function or method that nothing calls and that makes at least two calls.
- **Steps**: a depth-first walk over `CALLS` edges, 4 levels deep and at most 40 steps, never visiting a symbol twice.
- **Order**: each callee is placed at the first line of the caller's body that calls it. Callees with no matching line go last.
- **Branch flag**: walk up from the call line to the nearest less-indented line inside the caller. If that line opens a block, the step is flagged `if`, `loop`, `match` or `try`. Indentation is used because it works the same in Rust, TS, Go and Python without new tree-sitter queries.
- **Domains**: flows are grouped by their entry's community, labelled with the community name or, failing that, the files' common directory.

The order and flags are read from the source at query time, so existing indexes need no schema change or reindex. Branch flags are a heuristic: a call written on the same line as its `if` counts as part of the condition, not as a branch.

Surfaces:
- `GET /api/flowmap?limit=`
- MCP `flowmap`
- `kula flows --ordered [--json]`

## Node schema (H.2)

Seats and teams stay in `kula.toml`. A seat gains `color`, `tags`, `skills`, `mcp`, `memory` and `fence`. A team gains `color` and `category`. Canvas positions live on `refs/kula/meta`, so moving nodes around never dirties the tree.

## Fences (H.3)

Fence levels only ever rise: open, then review, then scope, then locked, then hidden. The order rules are listed in never changes the result. An unknown level is an error, not a quiet lock. Hook-time verdicts are made against the exact lines an edit changes. `explain` gives the chain of rules that decided a verdict.

## Runs (H.5–H.8)

kula launches agents itself and reads their JSON output for tokens, cost and duration. Each run is written to `.kula/runs/<id>.json`. Scores are a weighted mix of gate verdict, tests, refusals, retries, cost and duration, and the weights are shown in the UI. The Runs view adds a synopsis, a replay and a changelog grouped by flow. Schedules run inside `kula serve`, one scheduled run at a time.
