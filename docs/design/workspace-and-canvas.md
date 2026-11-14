# Workspace layout and the agent canvas

Status: plan, 2026-11-13. Two pieces of work, in order:

- **A. Workspace:** fewer, clearer views. One unified **Git** view, split away from **Overview**. Both are fixed-height widget boards with no page scroll.
- **B. Agent canvas:** a place to *architect* agent teams (draw them) and to *paint* them at work (watch them run). It covers agent nodes, memory, scope and hand-offs.

Rules that still hold:
- glass panels with rounded corners (8/6/4) and smooth gradients;
- toggles over tabs;
- never change button sizes;
- icon-only controls with tooltips;
- UI copy without dashes, one line at most.

---

## A. Workspace

### A1. Where things are today

| rail group | views |
|---|---|
| understand | Overview, Graph, Flows |
| git | Changes, History, Branches & compare |
| collaborate | Proposals, Issues, Notes |
| agents | Agents (with 9 tabs of its own: Overview, Workflows, Research, Teams, Skills, Fences, Memory, Docs, Connect) |
| tools | Query (SPARQL), Console |

The problems:
- **Too many views.** There are 12 rail entries plus 9 agent tabs, and Git work is spread over three views and Overview.
- **Overview repeats Git.** Overview already holds Git cards (Needs review, Branches, Recent commits), so it repeats Git work instead of summing up the repository.
- **Pages scroll.** Every page scrolls as a whole. Long lists push the useful parts below the fold.

### A2. Target rail: six views, keys 1–6

| key | view | what it holds | toggles inside the view |
|---|---|---|---|
| 1 | **Overview** | health of the repository at a glance; no Git workflows | none: one board |
| 2 | **Git** | everything Git, one board | none: one board, with linked widgets |
| 3 | **Map** | today's Graph, Flows and Query | `Graph · Flows · Query` |
| 4 | **Work** | Proposals, Issues, Notes | `Proposals · Issues · Notes` |
| 5 | **Agents** | today's agent tabs, regrouped (A5) | `Canvas · Setup · Memory · Research` |
| 6 | **Settings** stays in the toolbar; **Console** becomes a bottom tool window (IntelliJ terminal style, `ctrl+backtick`) | | |

Old hashes (`#changes`, `#history`, `#branches`, `#flows`, `#query`, `#issues` …) redirect to the new view with the right widget or toggle in focus. That keeps links, palette entries and the e2e tests working. The palette keeps a `Go to …` entry for every old name.

### A3. The board system (shared by Overview and Git)

- **Fixed height.** A `Board` fills the editor area exactly: `height: 100%` and `display: grid` on a 12-column grid, with rows set as fractions (`minmax(0, 1fr)`). The page never scrolls.
- **Widgets.** A `Widget` has a glass frame, a 32px head (title, count, icon actions), an optional toolbar row and a body. Only the body scrolls (`min-height: 0; overflow: auto`), with slim scrollbars and sticky list headers.
- **Linked selection.** Widgets on a board share one selection store: a branch, a commit, a file or a range. Picking in one widget filters or fills the others, for example a commit in History opens its diff in Detail.
- **No dead space.** Every widget has a designed empty state: one line plus the action that fills it. A board never shows a blank cell.
- **Breakpoints:**

  | width | layout |
  |---|---|
  | ≥ 1280 | full grid |
  | 1024–1279 | 8 columns; secondary widgets fold into tabs-as-toggles inside one cell |
  | 761–1023 | 2 columns |
  | ≤ 760 | one column. Here the page may scroll, since a phone cannot hold a fixed board. This is the one exception and needs YOUR sign-off. |
- **Later:** drag to rearrange, collapse a widget to its head, layout saved in settings. This is not in the first cut.
- **Test:** at 1440×900 and 1280×800, the view root has `scrollHeight <= clientHeight`, and every widget body that overflows has `overflow-y: auto`.

### A4. Git board (1440×900, 12 columns × 3 rows)

```
┌ Working tree ──────────┬ History ──────────────────────────┬ Branches ─────────┐
│ staged / unstaged      │ lanes + commits, filter, search   │ local · remote    │
│ per file +/-, stage    │ (filtered by selected branch)     │ ahead / behind    │
│ commit box at foot     │                                   │ switch · new · rm │
│ (4 col, rows 1–2)      │ (5 col, row 1)                    │ (3 col, row 1)    │
│                        ├ Detail ───────────────────────────┼ Sync ─────────────┤
│                        │ diff of selected file / commit,   │ fetch · pull ·    │
│                        │ structural summary on top         │ push, kula share/ │
│                        │ (5 col, rows 2–3)                 │ sync of meta refs │
├ Stash ─────────────────┤                                   ├ Review queue ─────┤
│ list, apply, drop      │                                   │ proposals waiting │
│ (4 col, row 3)         │                                   │ + Compare picker  │
└────────────────────────┴───────────────────────────────────┴───────────────────┘
```

| widget | from today's | notes |
|---|---|---|
| Working tree | Changes | the commit box is pinned to the widget foot, never scrolled away |
| History | History | lane graph; selected branch filters it; selection drives Detail |
| Branches | Branches & compare | create, switch, delete, merge, ahead/behind vs default |
| Detail | Changes / History diff | file diff or commit; structural summary (symbols touched, blast radius) on top |
| Sync | new | remote state, fetch/pull/push, `refs/kula/meta` share and sync |
| Review queue | Overview "Needs review" and the Compare picker | a base and head pick opens the full Compare report in Detail |
| Stash | new | list, apply, pop, drop |
| Conflicts | `resolution.md` | appears in place of Stash only while a merge or rebase is in progress |

### A5. Overview board, now repository health only

It holds:
- **KPI strip:** files, symbols, edges, languages, commits in the last 30 days, agents active, stale memories.
- **Hotspots:** churn × centrality.
- **Map thumbnail:** clicks through to Map.
- **Open issues:** top 5.
- **Agents now:** active team, its members' state and the last gate verdicts.
- **Fences hit:** the latest verdicts that blocked or asked for review.
- **Memory health:** fresh vs stale, by scope.

Each widget's head links to its full view. It holds no commit lists, branch lists or review queue; those live in Git.

The Agents view's own tab strip shrinks to four toggles:
- **Canvas** (B);
- **Setup** (Workflows, Skills, Fences, Docs, Connect as sections of one board);
- **Memory**;
- **Research**.

The Agents Overview tab folds into the canvas, which is the overview.

### A6. Build order

1. `Board` and `Widget` components, the selection store, the overflow e2e test.
2. Git board from existing `GitViews.tsx` parts (pull lists and detail out of the page components into widgets), plus the new Sync and Stash widgets. Stash and Sync need endpoints: check `src/` for existing ones first.
3. Overview board recut to health widgets.
4. Rail to six, redirects, palette, Console as a bottom tool window.
5. Map and Work toggles.
6. Update e2e tests for the new homes; screenshots; ui-critic pass.

---

## B. Agent canvas

### B1. What it is for

The canvas has two jobs, set with one toggle: `Architect · Live`.

- **Architect:** draw a team. Place agents, give them workflows, draw who reports to whom and who hands off to whom, paint the code each one may touch, and attach memory and skills. Saving writes the same `kula.toml` `[[team]]` and `[[workflow]]` entries the CLI and the current Teams editor write. Before writing, it shows a TOML diff.
- **Live:** the same drawing, now painted with the run:
  - who is working, blocked or waiting for review;
  - hand-offs flowing along their edges;
  - gate verdicts on slices;
  - memories landing in their stores;
  - a timeline scrubber to replay a run.

The canvas replaces the Agents Overview and the Teams org chart and society views. Those drawings become the canvas at fit-to-view zoom.

### B2. Nodes

| node | drawn as | carries | source |
|---|---|---|---|
| **Agent** | rounded glass card, provider glyph (✻ ◆ > ✦) | name, model, workflow chip (coloured), role, fence level badge, memory pocket (counts), skill ports; in Live, a state ring (idle, working, blocked, review) and the current slice | `Team.members[]`, `AGENT_IDS`, `MODELS` |
| **Team** | a frame around its members, title bar with prompt summary; the lead sits at the top of the frame | name, about, prompt; teams `under` another team nest inside it | `[[team]]` |
| **Workflow** | not a node: a lens. Its colour tints the agents in it, and selecting it shows its fences as an overlay on territories | scope, lock, hide, review, steps, memory policy | `[[workflow]]` |
| **Territory** | a soft region drawn from the code map (directory clusters), tinted by fence level | paths, symbols count, fence level per workflow | knowledge graph, fences |
| **Memory store** | a shelf, one per scope: **repo** (a base band along the canvas foot), **workflow** (attached to its lens), **task** (attached to a slice) | fresh / stale counts, latest entries, anchor targets | `MemoryLayer.scope` |
| **Human** | an outline card | review gates, approvals | `review` paths, proposals |
| **Gate** | a small diamond on the path from slice to merge | verdict, reasons, retries | `orch/gate.rs` |
| **Slice** (Live only) | a chip that rides on its agent | scope, deps, attempts, state | `orch/task.rs` `Slice` |

### B3. Edges

| edge | style | meaning | rule checked on save |
|---|---|---|---|
| `reports_to` | solid, vertical, toward the lead | hierarchy | no cycles; one lead per team |
| `hands_off` | arrow, accent when live | who passes work to whom | targets exist in the team or a parent team |
| `under` | containment, not a line | team nesting | no cycles (kula already refuses) |
| memory **write** | solid into a store | agent may `remember` | workflow `memory = "write"` |
| memory **read** | dashed from a store | agent may `recall` | `"read"` or `"write"`; none for `"off"` |
| **scope** | a brush stroke from agent to territory | the code it may change | a member's scope must sit inside its workflow's |
| **lock / hide** | hatched or blanked territory | fenced code | from the workflow lens |

### B4. Representing memory

Memory in kula has three properties the canvas should keep:
- **It is anchored to code.** Each memory hashes the symbol or file it is about.
- **It is ranked by the graph.** A recall walks self, then file, then callers and callees, then repo.
- **It goes stale** when the code it is about changes.

Drawn as follows:

1. **Shelves by scope.** The repo shelf runs along the foot of the canvas, shared by everyone. Each workflow shelf sits on its lens, and each task shelf on its slice. A shelf shows its fresh count in cream and its stale count hatched.
2. **A pocket on each agent.** It shows the memories that agent wrote, plus what it can read under its policy. When the pocket is open, it lists entries with their anchor (`file:symbol`).
3. **Anchors on territories.** A memory is a pin on the territory it targets, which turns hatched when stale. That way you can see where knowledge sits in the code, and which areas have none.
4. **Recall preview.** Hover an agent, pick a symbol, and the canvas lights what a recall would return, in rank order (self → file → neighbours → repo). This is the existing `kula memory recall` ranking made visible.
5. **Live.** A `remember` drops a pin onto its territory and ticks the shelf. A `recall` pulses the read edges it used.

The detail view is the existing **MemoryGraph** (memories over the code map), opened from any shelf or pocket.

### B5. Painting scope

In Architect mode, select an agent and pick the brush:
- Painting over territories on the canvas, or over the Map's code graph, adds those paths to the member's `scope`.
- Alt-painting removes them.
- The brush snaps to directory clusters, then to files when zoomed in.

Fences from the agent's workflow show under the brush: locked areas refuse paint and say why in a tooltip. This is the visual form of `scope` narrowing and is checked by the same rule as the CLI.

### B6. Layout and stored positions

- **Auto layout.** Teams are laid out top-down by `reports_to`, with nested teams inside their parent frame, and territories in a band beneath.
- **Manual moves are kept.** Positions are stored separately from `kula.toml`, so the config stays clean. They need a home; see open question 2.

### B7. Live data

- **Today the UI polls `api.agents` every 5 s.** That is too slow for painting hand-offs.
- **Server-sent events.** Add `GET /api/agents/events` as SSE: team started or stopped, member state, slice state, gate verdict, memory written or recalled, hand-off. `run-plan` and the hook already know these moments; they emit to an in-process channel the view server streams.
- **Replay.** Persist the events per run (in `.kula/runs/<id>.jsonl` or the orchestration log), so the timeline can replay a past run. Writing that path is a server-side change; the UI only reads it.
- **Fallback.** If SSE drops, fall back to the 5 s poll.

### B8. Technology

| need | choice | why |
|---|---|---|
| node editing, edges, zoom, minimap | `@xyflow/react` (MIT) | mature drag, connect and selection; custom React nodes take the glass cards as they are |
| auto layout | `elkjs`, lazy-loaded | layered layout with nested frames (teams in teams) |
| territories | reuse sigma's graph positions, clustered to hulls | the same geography as Map, so the code looks the same everywhere |
| live stream | `EventSource` | no extra dependency |

The canvas is code-split, so the rest of the app does not pay for it. The Map stays on sigma: it is a large WebGL graph, while the canvas holds tens of nodes.

### B9. Validation, the save path and undo

- **Validation runs as you draw:**
  - a cycle in `reports_to`;
  - a team with no lead;
  - scope outside the workflow;
  - a hand-off to an agent that does not exist;
  - memory edges against the workflow's policy.

  Problems show as a mark on the node and a line in a problems strip. Save is disabled while any error stands.
- **Save path:** the canvas builds the same `Team` and `Workflow` JSON the Teams editor posts through `agentAction`. The server writes `kula.toml` (people may; agents may not, under the repo's fences). The TOML diff is shown first.
- **Undo and redo:** in memory until saved; `kula.toml` history covers the rest.

### B10. Build order

1. Read-only canvas: teams, members, edges, workflow lenses, auto layout, fit to view. This replaces the Agents Overview, the Teams org chart and the society view.
2. Architect editing: add or remove agents and teams, draw `reports_to` and `hands_off` edges, the inspector panel (reuse the Teams editor forms), validation, TOML diff, save.
3. Territories and the scope brush, with fence overlays.
4. Memory shelves, pockets, anchor pins, recall preview.
5. The SSE endpoint and Live mode: state rings, hand-off pulses, gate diamonds, memory drops.
6. Run replay with the timeline scrubber.
7. Templates: start from a saved team shape (for example "lead + tester + reviewer", or an autoresearch loop) using `templates.ts`.

Each step: e2e tests on the fixture repo, one Playwright run at a time with `--workers=2`, and a ui-critic pass.

---

## Open questions (need YOUR call)

1. **Phone width.** Allow page scroll at ≤ 760 px only, since a fixed board does not fit a phone? (Recommended: yes.)
2. **Canvas positions.** Share them with the repo on `refs/kula/meta`, so the team sees the same drawing (recommended), or keep them per machine in local settings?
3. **Query.** Keep it as a toggle inside Map (recommended), or as its own rail entry?
4. **Dependencies.** OK to add `@xyflow/react` and `elkjs` (both MIT, lazy-loaded)?
5. **"Painting" the team.** Read here as both the live view and the scope brush. Is there a third meaning you want, such as free-form sketching on the canvas?
