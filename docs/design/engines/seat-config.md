# Seat config (B4)

A seat is a pure function of `kula.toml`. Same config → same seat folder, byte
for byte; a change anywhere in the merge chain produces a new seat id, and the
difference is reported as drift. Nothing is stored: the folder is the seat.

## The merge

`config::merge_config()` folds defaults → `[[team]]` → member, last wins:

```rust
let cfg = config::Config::load(root)?;
let seats: Vec<config::SeatSpec> = config::merge_config(&cfg);
```

`SeatSpec` carries what a seat needs to run: `agent`, `model`, `workflow`,
`scope`, `role`, `prompt` (team prompt first, then the member's), `reports_to`
and `hands_off`, `skills`, `mcp`, `memory`, `fence`, and two launch fields –
`budget` (tokens per run) and `max_parallel`. Both are linted: a seat without
them does not launch.

## Rendering

`agent_config::render_seat(&root, &spec) -> SeatDir` writes
`.kula/seats/<key>@<hash8>/` (slashes in the key become `-`):

| file | content |
|---|---|
| `skills/` | only this seat's skills, copied from `.agents/skills/` |
| `mcp.json` | only its servers, from the shared `.agents/mcp.json` |
| `memory.md` | layered notes: role → instructions → the seat's repo memory file |
| `fence.toml` | the seat's fences: `lock = [...]`, `hide = [...]`, `review = [...]` |
| `env` | `KULA_SEAT`, `KULA_TEAM`, `KULA_AGENT`, `KULA_WORKFLOW`, `KULA_BUDGET`, `KULA_MAX_PARALLEL` |

Rendered under `.kula/seats/` so a worktree reset (B2's `reset_worktree_to`
keeps untracked `.kula`) does not sweep it away. Write-once, no fsync – a timed
test holds every render under 50 ms.

**Seat id** – `agent_config::seat_hash()` is BLAKE3 over the canonical
serialisation: seat id, then for each file in sorted order its path, its length
and its bytes. Never hash a directory walk; walk order is not stable. Two
renders of the same config hash identically, so re-rendering is idempotent.

```rust
let dir = agent_config::render_seat(root, &spec)?;
dir.hash;  // 8 hex chars
dir.path;  // <root>/.kula/seats/alpha@3f9c1d0b
```

**Drift** – `agent_config::drift(root, &specs) -> Vec<DriftReport>` compares
every folder under `.kula/seats/` against a fresh render of the seat with the
same key: same hash → same seat, untouched; new hash → drift reported; a
folder whose seat no longer exists is stale.

## Lint (8 checks, all before launch)

`launch::lint(root, &cfg) -> Vec<LintError>` – every failure names the seat
and the toml field it came from:

1. `agent` – the CLI is on PATH and answers `--version` (skipped under
   `KULA_NO_AGENT=1`).
2. `skills` – every skill exists in `.agents/skills/` and its `SKILL.md`
   parses (has a name and a description).
3. `mcp` – every server is defined, and defined once, in `.agents/mcp.json`.
4. `memory` – the path stays inside the repo and the file exists.
5. `fence.*` – fence levels are the known three and names are not listed twice.
6. `reports_to` – the reports_to / hands_off graph is a DAG; a cycle is caught.
7. *overlap* – no two seats write one symbol. Stubbed with a TODO: this is B3's
   `guard::overlap()`; the pre-B3 `guard::team_overlaps()` only sees files and
   needs a built Store. To be wired when B3 lands.
8. `budget` / `max_parallel` – both set.

## Adapters

`launch::adapters::{claude_argv, codex_argv, gemini_argv}` build the argv for a
seat run: prompt, per-seat config (claude gets `--mcp-config <seat>/mcp.json
--strict-mcp-config`; gemini gets `--allowed-mcp-server-names`; codex gets
`--cd <worktree>`), stream JSON output, tool allow list, worktree.

Flags are pinned per CLI version in `launch::TABLES`, built from each CLI's
`--help`. An unpinned version refuses loudly rather than guessing flags:

```
claude is version "9.9.9", not pinned in kula's flag table (wants 2./1.…) – refusing to guess flags
```

`KULA_NO_AGENT=1` short-circuits the version probe and still returns the
would-be argv – nothing spawns, so tests stay hermetic.

```rust
let dir = agent_config::render_seat(root, &spec)?;
let argv = launch::adapters::claude_argv(&spec, &dir, "fix the gate", &wt)?;
// ["claude", "--output-format", "stream-json", "--verbose", "--model", "opus",
//  "--mcp-config", "<seat>/mcp.json", "--strict-mcp-config", "--allowedTools",
//  "mcp__demo", "--dangerously-skip-permissions", "-p", "fix the gate"]
```

## Surface

- `GET /api/seats` – every seat: merged spec, hash, folder, drift, lint
  verdicts, `ok`. `?render=0` skips re-rendering.
- MCP tool `kula_seats` – the same data for the swarm.
- Tests: `tests/fixtures/seat-lint/` holds a disposable `kula.toml` template;
  tests copy it into a tempdir and mutate it there – never the repo's own
  config.
