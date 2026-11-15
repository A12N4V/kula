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

- **Levels only rise**: open, then review, then scope, then locked, then hidden. A verdict is the highest level any rule gives, so the order rules are listed in never changes it, and adding a rule never lowers one. Property tests over generated rule sets check both.
- **Unknown levels** (`level = "lockd"`) fail closed: the rule acts as locked, and `kula check` reports it and exits 2 until it is fixed.
- **Exact hook verdicts.** For a single-file Edit, MultiEdit or Write, the hook rebuilds the file as it would be after the edit and parses both versions. Path rules still fence the whole file. A symbol rule only refuses the edit when that symbol's source changes. Each definition under the fenced name is compared byte for byte, so these are caught:
  - wrapping the symbol in a comment;
  - deleting it;
  - adding a second definition with the same name.

  Shell calls, patches, multi-file calls and languages kula cannot parse keep the coarse whole-file verdict.
- **Bare-name warnings.** A symbol rule without a path that matches more than one definition is reported, with the `path:name` forms to pick from.
- **Explain.** `kula guard explain <path> [--symbol s] [--agent a]` and the hub's `explain` action list every rule that applies and mark the one that decides.
- **Seat overlaps.** Two scoped seats in one team that may both write the same files are reported in `kula check` (`seat_overlaps`) and in the hub. Unscoped seats are left out.

## Hub canvas (H.4)

The nine Agents tabs are gone. Agents is one view in three columns:

- **Palette** (left): agents, team templates, skills, MCP servers and memory files. Drag one onto a seat, a team or empty canvas, or click it to put it on whatever is picked. An agent on empty canvas starts a new team with a lead.
- **Canvas** (centre, xyflow): a frame per team with its category, a node per seat with a colour stripe, agent, tags, skill and MCP chips, memory and fence badges. Solid edges are `reports_to`, arrows are `hands_off`; the Link toggle picks which one a drag between seats draws. Seats that may write the same files are flagged.
- **Inspector** (right): the picked seat or team (identity, colour, tags, prompt, skills, MCP, memory, fences with the `explain` preview), or with nothing picked an overview: suggestions from agents to accept or dismiss, then fence warnings.
- **Flow map**: a toggle that draws the H.1 domains as lanes behind the teams. Dropping a seat on a flow scopes it to that flow's files.
- **Build · Live · Runs**: Build edits a draft; Live paints the event log onto the seats with a scrubber; Runs fills in with H.6.

Edits stay in a draft until Save, which shows the `kula.toml` diff first and keeps the file's comments. Positions go through `layout_save` onto `refs/kula/meta` and never touch the tree.

Still to come back to: the old per-task loop overview has no place in the hub yet, and the CSS of the removed tabs (`agents.css`, `agents-teams.css`) is pruned in H.9.

## Runs (H.5–H.8)

kula launches agents itself and reads their JSON output for tokens, cost and duration. Each run is written to `.kula/runs/<id>.json`. Scores are a weighted mix of gate verdict, tests, refusals, retries, cost and duration, and the weights are shown in the UI. The Runs view adds a synopsis, a replay and a changelog grouped by flow. Schedules run inside `kula serve`, one scheduled run at a time.
