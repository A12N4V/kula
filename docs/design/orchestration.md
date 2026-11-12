# Orchestration: plan, gate, slice runner

kula splits a goal into slices, hands each slice to an agent in its own git
worktree, and gates the result against the graph before it is kept. Planning and
gating are deterministic: the same repository and goal give the same plan, and the
same tree gives the same verdict. Only the agent is non-deterministic.

## Commands

| command | does |
|---|---|
| `kula plan "<goal>"` | builds a plan from the graph, writes `.kula/plan.json` (or `--out`) |
| `kula gate <slice>` | gates one slice's tree (`--dir`, default its worktree, else the repo) |
| `kula run-plan [plan.json]` | runs every slice: worktree, agent, gate, retries |

`kula run -- <cmd>` already runs one agent under fences, so the runner is
`run-plan`. Each agent launch in a slice goes through `kula run --agent <id> --`
inside the slice's worktree, so the same fences hold there.

## Task model (`src/orch/task.rs`)

`Plan { schema, id, goal, risk, base_ref, max_parallel, max_retries, test_cmd,
baseline_cycles, agents, slices }`. `Slice { id, module, scope, tests, agent,
base_ref, deps, state, attempts, escalate, reasons }`.

- `scope`: paths (directories or files) the slice may change. Its tests are in scope too.
- `deps`: slice ids that must pass first.
- `baseline_cycles`: module cycles that existed when the plan was made, so a gate
  only blames a slice for cycles it adds.
- `agents`: optional command per agent id, `{prompt}` replaced by the prompt.
  Built in: `claude -p`, `codex exec`, `gemini -p`; anything else runs as
  `<agent> {prompt}`.

## Planning (`plan.rs`)

1. Every word of the goal is searched in the graph (each word on its own; the
   full-text index ANDs terms). Hits are symbols and files.
2. Each hit's file maps to its module (the module tree from `kula map`). One slice
   per module; root-level files become a slice scoped to those files.
3. A slice depends on another when its module calls or imports into the other's
   module. Mutual dependencies (an existing cycle) are dropped rather than
   deadlocking. Slices are ordered dependencies first, then by id.
4. Tests attach by path convention: test files (`tests/`, `test_*`, `*_test.*`,
   `*.test.*`, `*.spec.*`) inside the module or named after it.
5. Risk: `high` when any scoped file is fenced or there are more than four slices,
   `medium` for more than one slice, else `low`.

## Run states

```
Queued ─▶ Running ─▶ Gating ─▶ Passed
                      │  ▲  └──▶ Rejected        (scope or fence breach)
                      │  └ fix, attempts left
                      └──────▶ Failed (escalate)  (fix after the last retry, or a dependency did not pass)
```

At most `max_parallel` slices (default 2) are Running or Gating; the rest stay
Queued. A slice starts only when all its deps have Passed. A slice whose
dependency failed or was rejected is marked Failed without running.
The state of every slice is written to `.kula/runs/<plan>/state.json` on every change.

## Gate rules (`gate.rs`)

The gate returns `Verdict { verdict: pass | fix | reject, reasons }`. The worst
rule wins.

| check | outcome |
|---|---|
| a changed or new file outside `scope` and the slice's tests | reject |
| a changed file kula's fences forbid (`verify_edit`) | reject |
| a caller left calling a removed symbol (`verify_edit` dangling) | fix |
| `test_cmd` exits non-zero (`{tests}` replaced by the slice's tests; skipped when it needs tests and there are none) | fix |
| a module cycle not in `baseline_cycles` | fix |

Changed files are the tree against the slice's `base_ref`, plus untracked files
git does not ignore. Exit codes for `kula gate`: 0 pass, 1 fix, 2 reject.

## Retries (`retry.rs`)

`fix` hands the gate's reasons back to the same agent, at most `max_retries`
times (default 2, so three attempts in all). After the last, the slice is Failed
with `escalate: true` for a person to look at. `reject` stops at once: a scope or
fence breach is a planning problem, not something to retry. Every attempt writes
`.kula/runs/<plan>/<slice>/attempt-N.md`: the prompt, the agent's exit code and
output tail, and the verdict.

## Worktrees and branches

Each slice works in `.kula/worktrees/<plan>/<slice>` on branch
`kula/<plan>/<slice>`, cut from `base_ref`. A passing slice is committed on its
branch and its worktree removed; a failed or rejected one keeps its worktree for
inspection. Merging slice branches (the merge train) is out of scope here.

## Safety

Tests use `tests/fixtures/fake-agent.sh` only, with a PATH that holds no real
agent. With `KULA_NO_AGENT` set, the runner refuses to launch claude, codex,
gemini, cursor-agent, aider, opencode or goose.
