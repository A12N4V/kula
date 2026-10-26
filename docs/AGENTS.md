# How kula's agent setup stacks – the five layers

kula reads one `kula.toml` at the repo root and builds a control plane from
it: what agents may touch, how kinds of work are done, and who does it. The
file has five layers. They stack from outer to inner, and the **outer layer
wins** wherever two say different things about the same file or symbol.

1. `[agents]` – repo-wide settings: `hide_secrets`, `memory`, `docs` (what
   every agent reads first), the `default` service, `allow_solo`.
2. `[[guard]]` – fences. `level = "locked"` (never edit), `"hidden"` (never
   even read), `"review"` (a person reviews the change). Fences may name
   `paths`, `symbols` or both, each with a `reason`. This layer belongs to
   the repository; no team or agent can loosen it.
3. `[[scope]]` – a named subsystem: a `select` of globs or symbols, the
   `paths` they resolve to, and an `about`. A workflow that says
   `scope = ["@graph"]` inherits the whole subsystem in one word.
4. `[[workflow]]` – how a kind of work is done: `about`, `scope`, `lock`
   (extra fences on top of the repo's), `review`, `hide`, `docs`, `memory`
   (read/write/off), ordered `steps` and a `prompt`. Three workflows carry
   `research = { metric, goal, budget }` and run as metric loops.
5. `[[team]]` – who does it: `members` (seats), an optional `under` (the
   parent team), plus team-level `domains`, `fences`, `limits` and `prompt`.

A seat is a member in a team. It is keyed by its `name`, else its
`workflow` – never its `service` – so two seats on `claude` are fine.
`agent` is the legacy spelling and still reads. `reports_to` must name a
seat in the same team; `hands_off` may name a seat in any team. Seats
without a name take their workflow's name at load.

## The team tree

```
kula (steward · architect)
├── core (rust-core · indexer · graph-perf)
│   └── research (index-speed · bundle-size · test-time)
├── frontend (web-ui · canvas · e2e-tester)
├── quality (ux-critic · a11y · security-review)
└── ship (release · docs-writer)
```

- **kula** steers: it turns an issue into a brief and assigns each file to
  exactly one team.
- **core** owns `src/**` and `tests/**`; its `research` child runs the three
  metric loops under it, fenced away from the goalposts (`web/e2e/**` and
  `tests/**` are locked so a loop cannot change what "better" means).
- **frontend** owns `web/**` and builds against typed mocks in
  `web/src/api.ts`; `web/src/api.ts` is under review because it is the
  contract with core.
- **quality** reads everything and changes almost nothing – locked away from
  code, it files findings with a file:line and an owner team.
- **ship** documents and releases; nothing ships without a person.
- Cross-team hand-offs are explicit: `rust-core` hands off to quality's
  `security-review`, `web-ui` to `ux-critic` and `e2e-tester`.

## Running a team on an issue

```sh
kula team show core          # seats, fences, limits as loaded
kula run team core --issue 42   # the steward's brief in the issue drives it
```

Or from the web UI: Agents tab → Teams → pick a team → run. A team's lead
receives the brief, members work inside the union of repo fences, team
fences and their workflow's lock, and the board carries the hand-offs.

## Adding an agent or a loop

Add a workflow first (it is the unit of scope and steps), then a seat:

```toml
[[workflow]]
name = "release-notes"
about = "Drafts changelog entries from merged commits."
scope = ["CHANGELOG.md", "docs/**"]
memory = "write"
steps = ["Read the merges", "Draft", "Check every claim against the diff"]

[[team]]
name = "kula"
# existing members stay; add one seat
members = [ { name = "changelog", service = "codex", workflow = "release-notes", reports_to = "steward" } ]
```

Add a research loop by giving a workflow a `research` table with a `metric`
command, a `goal` of `min` or `max` and a run `budget`; kula then runs the
loop, keeps a change only when the number improves, and reverts it if not.
