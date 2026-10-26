# Agents in kula – how the five layers stack

kula turns a repository into a place agents can work in safely. Everything an
agent sees and may touch is written down in `kula.toml`, in five layers that
stack from outermost to innermost. A rule in an outer layer always wins: an
inner layer may narrow, never widen.

```
1. [agents]      what every agent reads first and may never see
2. [[guard]]     repository fences: hidden · locked · review, by path or symbol
3. [[scope]]     named slices of the graph agents and teams reuse as @name
4. [[workflow]]  the agents: a job, a scope, their own fences, steps, memory
5. [[team]]      seats wired by who-answers-to-whom and hand-offs, a domain,
                 team fences stacked on top, and hard limits on spend and turns
```

Read the actual layers of this repository in the committed `kula.toml` – it is
kula's own setup, and a working example of all five.

## How the layers meet at run time

When a run starts from a team seat, kula builds one guard stack for it:

- the repository's `[[guard]]` rules (source `repo`) apply to everything;
- the seat's team adds its own `fences` on top (source `team`), and its
  `domains` narrow everything else – paths outside the domain are locked;
- the seat's `[[workflow]]` adds its `lock`, `hide` and `review` rules
  (source `agent`), and the seat may carry its own narrower `scope`.

`GET /api/agents/effective_fences?team=<name>&seat=<name>` returns that stack
for any seat, outer first, so the UI can show exactly what an agent works
under. `GET /api/agents` carries `scopes: [{name, about, paths}]` – one entry
per workflow.

Seats are keyed by their `name`; a seat without one takes its workflow's name.
Never the service: two seats on `claude` are two different people. A seat may
`reports_to` a seat of its own team (that is the team's hierarchy) and hand its
work to any seat of any team (`hands_off`), which is how core hands a change to
quality's security-review seat.

## The team tree of this repository

```
kula (steering: steward → architect)
├── core (rust-core → indexer → graph-perf)
│   └── research (index-speed → bundle-size, test-time)
├── frontend (web-ui → canvas, e2e-tester)
├── quality (ux-critic → a11y, security-review)
└── ship (release → docs-writer)
```

Research loops (`[[workflow]]` rows with a `metric`) run inside a team's
domain: kula measures, keeps the change only if the number improved and every
test still passes, and reverts otherwise. The `research` team holds the loops;
its fences keep a loop from moving its own goalposts.

## Running a team on an issue

```sh
kula team start ship "Fix the release notes generator"
```

or from the UI: Teams → pick the team → Deploy to Workspace. The run is
stamped `by = team:<name>`, so the team's fences, domain and limits apply for
its whole life. A bare agent (no team) is refused unless `allow_solo = true`
in `[agents]`.

## Adding an agent or a loop

- **A seat**: add a member to a `[[team]]` – `{ name = "atlas", service = "claude",
  workflow = "fix", role = "…" }`. The service is chosen on the seat, not on
  the agent. Or in the UI: Teams → + add → pick a workflow and a service.
- **A workflow**: add a `[[workflow]]` row (or `kula workflow save`), with
  `about`, `scope`, `lock`/`hide`/`review` fences and `steps`.
- **A research loop**: a workflow with `metric` (a command that prints a
  number) and `direction` (`up` or `down`); give it a `budget` and start it
  with `kula research start <name>`.
- **A scope**: add `[[scope]]` and use it as `@name` in any workflow or seat
  `scope` list.
