# A3 · The Agents area

Scope: every tab in the Agents strip – `Agents` (workflows), `Teams`,
`Research`, `Skills`, `Memory`, `Docs`, `Settings` – plus the logo studio, the
sub-tabs inside them, and the right-docked panels they open. No code was
changed; every number below is measured, and the command that produced it is
named.

Servers: `http://localhost:8071` (kula's own repo, `KULA_TOKEN=probe`) and
`http://localhost:8072` (the e2e swarm fixture: 9 teams, `x-kula-token: test`).
Tools: `.kula-team/tools/probe.mjs` and the measurement scripts under
`.kula-team/scratch/` (`a3-teams.mjs`, `a3-drag.mjs`, `a3-persist.mjs`,
`a3-dnd.mjs`, `a3-graph.mjs`, `a3-seed.mjs`, `a3-forget.mjs`, `a3-extra.mjs`,
`a3-last.mjs`, `a3-studio3.mjs`). Raw probe
text is in `.kula-team/scratch/probes/`; screenshots cited are
`docs/ui-critique/shots/a3-*.png`.

The strip itself (`Agents.tsx:104`, `nav.ag-tabs[role=tablist]`) is **one
menu**: 7 icon tabs plus a `Workspace` jump-out at the far right of the same
row, badges on `Teams`/`Memory`/`Docs`/`Agents`/`Skills`. Measured at 1440:
`button.ag-mi` 89–112 wide × 38, all reachable by `Tab` in order
(`.kula-team/scratch/a3-extra.log`). At 390 the same 8 buttons shrink to
36–50 × 38 – under the 40 px floor on every one (probe `fx-agents-*-390.txt`).
That is the whole area's baseline defect: the strip is icon+label at 1440 and
icon+label at 390, and it neither collapses nor scrolls.

---

## 1 · Layout map (fixture, 1440×900, screenshot `a3-agents-1440.png`)

```
┌ top bar ─────────────────────────────────────────────────────────────┐  brand kula/…/Agents  branch chip  Back Search Settings
├ left rail (38px) ─┬─ Agents area ─────────────────────────────────────┤
│ Overview          │ nav.ag-tabs  [Agents][Teams][Research][Skills]     │  one row, 38 tall; badge = count or stale count
│ Graph             │              [Memory][Docs][Settings]  →  Workspace │  the strip is the section menu
│ Flows             │                                                    │
│ Workspace         ├────────────────────────────────────────────────────┤
│ Changes           │ header.page-head  h1 + hint (hidden on Teams)      │  48px
│ History           ├────────────────────────────────────────────────────┤
│ Branches & compare│ .ag-panel  – the tab's own body                    │
│ Proposals         │   · list pages: scrollable single column, 1px rows │
│ Issues            │   · Teams / Memory: full-bleed canvas (ag-full)     │
│ Notes             │   · list+inspector: 2 columns, filter top-right     │
│ Agents (on)       │                                                    │
│ Query (SPARQL)    │  ┌ right-docked panel .win.ag-side-win ┐            │  x=992, w=440, always right (a3-extra.log)
└───────────────────┴──┴────────────────────────────────────┴───────────┘
```

Per-tab shape and value function (value function = the state the user
maximises by being on that tab):

| tab | shape | value function |
|---|---|---|
| Agents | list of workflow cards, chips `all / built in / kula.toml / New agent` | **how each work mode is scoped** – I pick the steps, the files and the fences an agent gets |
| Teams | full-bleed canvas, tinted team rectangles + seats; head chips (cost/turns/autonomy/fences); right panel | **who works together and under which limits** – a team I can deploy |
| Research | form (metric, tries, timeout, editable globs, prompt) + loop list | **what number am I improving, and by how much per run** |
| Skills | index: scope segmented (This machine/GitHub/…) then `all/This repo/Yours/Plugins` + `Import a skill` | **which SKILL.md files load, and whether mine are in sync** |
| Memory | knowledge graph first, `Graph/List` segmented, filters `all/stale/agents/people`, then a number legend + inventory | **what agents know and on what anchor, and whether it is still true** |
| Docs | docs + instruction files list, sections (`CODEX`, etc.), sync state `repo/nested`, sizes | **the instructions an agent reads, and whether they are current** |
| Settings | sections: Policy / Workspace / … with `.seg` controls | **the wiring** – memory, secrets, default agent, index rules |

(Content confirmed from the fixture probes: `fx-agents-*-1440.txt`.)

---

## 2 · Value functions, features, ratings

Ratings are 1–10. "Measured" cites the probe or script.

### Agents (workflows) – 7 / 10
Features: built-in and `kula.toml` workflow cards, step counts, per-card
badges, `New agent` action, jump to the map with a fence. Clarity good (h1 +
one-line hint), density good (cards + chips), consistency good.
`V 8 · Clarity 8 · Density 8 · Consistency 8 · Interaction 6 · Robustness 6 · Polish 7`
Robustness drops for the `sb-help` overlap (below) and because the tab renders
from a 5 s poll with no error surface of its own.

**Logos sized in cards (measured).** With the token the card path actually
wants set in `sessionStorage` (see T1), the tab draws **7 `.ag-card`s** in one
row and the card's logo mark renders **22×22 px** inside a **176×149 px** card
(`a3-dnd.mjs`; `/api/agent/cards` and `/api/agent/logos` both 200). The mark is
sized by the card and never overflows it – the sizing is fine; only the fetch is
dead by default (T1).

### Teams – 5 / 10
Features: 9 tinted rectangles in one space (`TeamCanvas.tsx:198` `TeamGroup`,
`TINTS` `:196`), seats with harmonographs, lead→member edges, drag the block by
its header (`dragHandle: ".tg-head"` `:240`), drag a seat inside, drop an agent
card on a rectangle to join it (`:309-319`), zoom/fit panel, right-docked
Details panel, deploy/stop, live `at work` tag.

Measured on the fixture's 9 teams (`node .kula-team/scratch/a3-teams.mjs
http://localhost:8072 1440 900`):

- **No overlap at fit**: 0 overlapping pairs, none off-screen.
- **But the fit zoom is 0.336** (`viewport transform … scale(0.336235)`). At
  that zoom the team header is **196×11 px** and each logo mark **10×12 px**;
  seats are 50×31. Nothing on that canvas meets a 28 px (probe) or 40 px
  (touch) floor. This is the tab's central problem: the arrangement is
  legible as *shapes* and unusable as *controls*.
- **Drag works and persists.** Dragging `graph` by its header moved it 177 px
  and issued exactly one write: `POST /api/agents/team_layout
  {"name":"graph","positions":{"@team":[1748,-193]}}` → 200 (`a3-drag.mjs`).
  Across a reload the *normalized* arrangement (positions relative to the set's
  own bounding box) is identical to the post-drag one:
  `reload-matches-drag=true` (`a3-persist.mjs`). Absolute on-screen position
  changes because `fitView` re-frames the whole set – see issue T2.
- **Dragging a member works and persists.** Dragging the seat `tests` inside
  the team `ship` moved it 64 px across and 18 down and issued exactly one
  write: `POST /api/agents/team_layout
  {"name":"ship","positions":{"tests":[190,54]}}` → 200 (`a3-dnd.mjs`). The
  rectangle grows to fit the seat.
- **Dropping an agent on a rectangle joins that team.** Dispatching a
  `{kind:"agent",name:"docs"}` drop on `team-group-graph` took it from 4 to 5
  members and issued exactly `POST /api/agents/team_add_member
  {"name":"graph","workflow":"docs"}` → 200 (`a3-dnd.mjs`). Both writes were
  undone afterwards (`team_remove_member`, and the fixture's `kula.toml` layout
  restored), so the shared fixture is as it was found.
- **The logo mark does not reliably open the studio at rest.** A real mouse
  click on `[data-testid^=tc-mark-]` at fit opened no studio (`a3-extra.log`);
  dispatching the click on the same element opens it
  (`a3-studio3.mjs`: `.logo-root` present, preview 268×268, 4 sliders, `3D`,
  `Save logo`, Esc closes). At 10×12 px the mark is below the hit floor, so the
  click lands on the seat and opens Details instead.

`V 8 (the right model: one space, tinted blocks) · Clarity 7 · Density 6 ·
Consistency 8 · Interaction 5 · Robustness 5 · Polish 5`

### Research – 6 / 10
Features: create a loop from scratch or a template, metric (lower/higher),
tries, timeout, editable globs `src/**` with `×` removal, system prompt, loop
list, `.seg` for metric direction. Clarity strong (labels in mono caps:
`METRIC – THE LAST NUMBER IT PRINTS`). With no loops the tab opens the new-loop
form directly (`Research.tsx:46`) rather than an empty placeholder.
`V 7 · Clarity 8 · Density 7 · Consistency 7 · Interaction 6 · Robustness 5 · Polish 6`
Drag-and-drop/tab-order inside the form is unverified; the `sb-help` overlap
hits the "New research loop" card at 1440 (below).

### Skills – 6 / 10
Features: scope segmented control, counts `All/This repo/Yours/Plugins` from
`api.configMatrix`, `Import a skill` panel (`SKILL.md → .agents/skills`), and a
genuine empty state: *"No skills yet – Add a SKILL.md under .agents/skills"*,
plus a `Where we looked` explainer. Good information architecture.
Problems: an `sx-head` row overlaps `sb-help` at 1440 on the repo server, and
two skill descriptions render an **em dash** (`span.sx-desc`, probe
`repo-agents-skills-1440.txt`) – that copy comes from third-party `SKILL.md`
front-matter, so the fix is rendering-side (strip or replace), not authoring.
`V 7 · Clarity 8 · Density 7 · Consistency 7 · Interaction 6 · Robustness 6 · Polish 6`

### Memory – 4 / 10 (the worst tab)
The decision (plan §2.2) is *knowledge graph first, list second*, and the tab
honours it: `.m1-graph` with `Graph/List`, filters, a layer legend
(`task/workflow/repo`, memories, stale) and a DOM inventory under the canvas.
Click-through is real: clicking an inventory chip fills the right sidebar with
the full body (`a3-extra.log`: `changed=true`, sidebar `#34 … stress memory …`),
and clicking an *anchor* node navigated to the map (`#graph/1614`).

But the graph does not scale. Seeded with 30 extra memories on the fixture
(`a3-graph.mjs`, 32 memories total):

```
GRAPH label="Memory graph: 32 memories on 6 anchors" nodes=40 edges=123
      groups=1 overlaps=39 zoom=0.50
  node sizes(rendered): 40x40
  labels: ["REPO\n32\n–","◎","F","F","F","F","F","ƒ","27","5","28","29"] clipped=0
```

- **39 overlapping node pairs** among 40 nodes at rest, zoom 0.50. There is no
  measured non-overlap guarantee on this canvas.
- **25 of the 40 nodes are off-screen at rest**, the leftmost at `x = −1434` in
  a 1440 px viewport – unclickable without panning (`a3-graph.mjs`
  `a3-graph-n32.log`: `off-screen nodes=25 leftmost-left=-1434 (vw=1440)`).
- Node labels are bare integers (`27`, `5`, `28`); anchors are `F`/`ƒ`/`◎`.
  You cannot tell two memories apart, or read what they are about, without
  hovering or using the list.
- This is **not** a scale artefact of the seed. On the untouched fixture, at
  the n=2 default, the same canvas already reports **3 overlapping node pairs
  among 6 nodes** (`a3-graph.mjs` → `a3-graph-n2.log`); at n=32 it is 39 among
  40. A fresh install is not clean, it is just small.

`V 8 (a graph is the right first view) · Clarity 4 · Density 3 ·
Consistency 5 · Interaction 5 · Robustness 2 · Polish 5`

### Docs – 5 / 10
Features: docs list with section headers, sync badges (`repo`, `nested`), byte
sizes, description, inline editor. Two defects: an `sx-head` row overlaps
`sb-help` on the fixture (probe `fx-agents-docs-1440.txt`), and at **390 the
list is ~500 px wide in a 390 px viewport** – 16 elements at `x 28–528`,
off-screen (`fx-agents-docs-390.txt`, screenshot `a3-docs-390.png`).
`V 7 · Clarity 7 · Density 6 · Consistency 6 · Interaction 5 · Robustness 2 · Polish 5`

### Settings – 7 / 10
Features: Policy / Workspace sections, `.seg` controls (`none/low/medium/high`
risk ceiling), toggles, index excludes and file-size limit, default agent.
Cleanest tab of the seven: probe reports 0 problems at 1440 and 390 other than
the shared strip targets. `V 8 · Clarity 8 · Density 8 · Consistency 8 ·
Interaction 7 · Robustness 7 · Polish 8`

### Logo studio – 7 / 10
Opens in a portal (`.logo-root`, `LogoStudio.tsx:130`), not a tab: a 268×268
live preview of the name's harmonograph, `2D/3D`, `yaw`/`pitch`/`density`/
`line weight` sliders with mono value readouts, `Reset`, `reroll`, `Save logo`
(`logo_save`). Esc closes and unmounts. It is the best-built single thing in
the area; the only problem is reaching it (issue T3).
`V 8 · Clarity 8 · Density 8 · Consistency 7 · Interaction 8 · Robustness 7 · Polish 8`

---

## 3 · Cross-cutting stress results

**Panels dock right (pass).** Toggling `Details` on Teams mounts
`.win.ag-side-win` at `x=992, w=440` in a 1440 viewport – `docksRight=true`
(`a3-extra.log`). The Memory sidebar is the same `FlowSidebar`
(`data-testid=flow-sidebar`). Consistent with plan §2.3.

**Keyboard (mostly pass).** `Tab` order on Teams is well-formed: brand → branch
chip → Back/Search/Settings → 15 rail buttons → the 8 `ag-mi` tabs in order →
the first team group header (`a3-extra.log`). No element was flagged
`NOFOCUS`, so the one focus style (`tokens.css:91`) covers everything that
takes focus. The gap: `nodesFocusable={false}` (`TeamCanvas.tsx:167,326`), so
individual seats are **not** keyboard reachable – you can reach a team block
but not a member inside it without the mouse.

**1100 px (no horizontal overflow).** `#agents`, `#agents/teams`, `#agents/docs`
all report `scrollW == vw == 1100, offscreen=none` (`a3-extra.log`, screenshots
`a3-agents-1100.png`, `a3-teams-1100.png`). Horizontal overflow only starts
below ~500 px. The `sb-help` overlap is *not* width-dependent – T5 owns that
claim, and it reproduces at 1440.

**390 px (fail in five places).** All eight strip buttons are 36–50 × 38
(< 40). `#agents/docs` overflows horizontally (16 elements off-screen).
`#agents` has the card/`sb-help` collision. Teams repeats the strip targets
plus a 116×7 header. Memory adds an 11×11 `fc-group-fold`.

**Light mode (pass).** All five tabs sampled render the warm cream ground
(`body rgb(239,231,220)`, text `rgb(35,29,24)`) with no new console errors –
the only errors are the 401s of issue T1 (screenshots
`a3-agents-light-1440.png`, `a3-docs-light-390.png`; `a3-extra.log`).

**Empty states (mixed).** Present and specific on Skills ("No skills yet…"),
Agents (`.ag-empty` "No loop is measuring anything – set one up in Research"),
and Teams (`tc-empty` "… has no members yet – drag an agent onto it").
Absent on Agents' roster: with no agents configured the tab shows the card
`Pick a card` rather than an explanation of what a workflow *is*.

**Console.** Two `401 Unauthorized` per mount of the fixture `#agents` and of
`#agents/teams` (a light-mode reload of teams showed two, so read it as a
per-mount count rather than a fixed per-route one; `fx-agents-1440.txt`,
`fx-agents-teams-1440.txt`, `a3-extra.log:11`). No page errors, no crashes, no
render-loop timeouts on any of the 22 probe runs.

---

## 4 · Ranked issues

**T1 · major · two endpoints are fetched with a token nothing ever writes.**
`web/src/flow/agentMark.tsx:156` and `web/src/views/agents/AgentCard.tsx:44`
both send `x-kula-token: sessionStorage.getItem("kula.token") ?? ""`, and
`grep -rn 'kula.token' web/src` shows **no writer**. Every other caller reads
the meta tag (`api.ts:4`, `CodePanel.tsx:40`, `flowsPanel.tsx:252`). Evidence:
`GET /api/agent/logos` and `GET /api/agent/cards` return 401 in the browser on
both servers, while `curl -H 'x-kula-token: test' http://localhost:8072/api/agent/logos`
returns **200**. Effect: saved logos never load (every mark falls back to its
hashed harmonograph) and the Agents-grid cards never populate. Fix: read the
token the same way the rest of the app does, once, in one exported helper.

**T2 · major · the 9-team canvas fits to too small to use.**
Measured zoom 0.336 → headers 196×11, marks 10×12, seats 50×31. No element
meets a 40 px touch floor; the logo mark is below the mouse hit floor (a real
click opens Details, not the studio). Fix: at `teams.length > 4` fit only to a
readable zoom floor (e.g. `maxZoom` such that a seat is ≥ 90 px, letting the
canvas pan/scroll instead of shrinking), keep the fit-everything action on the
`⤢` button, and give the header a ≥ 28 px hit height (padding, not font size).

**T3 · major · the logo studio is unreachable by pointer at rest.**
A real click on `tc-mark-*` opened no studio; dispatching the click on the same
element opens a fully working one (`a3-studio3.mjs`). Same root cause as T2 –
the mark is 10×12 px. Fix with T2, and/or make the whole seat's mark area a
larger hit target (`padding` on `.tc-node-mark`, not a bigger glyph).

**T4 · major · the memory graph overlaps itself and draws off-screen.**
32 memories → 40 nodes, **39 overlapping pairs** among 40, zoom 0.50, and
**25 of 40 nodes off-screen** (leftmost `x=−1434`); the same canvas already
overlaps **3 pairs among 6 nodes** at the n=2 default. Reproduce with the seed
in §6 (`a3-seed.mjs` → `a3-graph.mjs` → `a3-forget.mjs`; logs
`a3-graph-n32.log`, `a3-graph-n2.log`). Fix: a non-overlap guarantee like the map's (F2's measured
"no overlapping blocks at rest"), a zoom floor, and labels that name the anchor
(`file:src/kg.rs`) rather than a bare `#27`.

**T5 · major · `button.sb-help` overlaps content at every width, not only 390.**
The brief and `map.md §7` record this as a 390-only collision. It is not:
`#agents` at **1440** → `div.card.ag-card "architect kula.toml" × button.sb-help`;
`#agents/research` at 1440 → `button.card.ag-card "New research loop" × button.sb-help`;
`#agents/skills` at 1440 → `button.sx-head × button.sb-help`;
`#agents/docs` on the fixture → two `sx-head × textarea.textarea`;
`#agents` at 390 → `div.card.ag-card "tests built in TESTS" × button.sb-help`.
`sb-help` is the bottom-bar dock toggle (`App.tsx:322`). Fix: reserve the
bottom bar's height in the area's scroll container (padding-bottom) instead of
letting cards scroll under it.

**T6 · major · `#agents/docs` overflows horizontally at 390.**
16 elements at `x 28–528` in a 390 px viewport (`fx-agents-docs-390.txt`);
counting every overflowing element gives 18 (`a3-verify.mjs`). The offenders are
`.section-title`, `.sx-list`, `.sx-row`, `.sx-head`, `.sx-main`, `.sx-name`,
`.sx-tags` (screenshot `a3-docs-390.png`). The row has a min width from the
name + description + `tags` + size columns that is never relaxed. Fix: at
≤ 600 px drop the `tags`/size column into a second line and let `.sx-main`
ellipsise.

**T7 · minor · strip targets are under the floor at 390.**
Eight `button.ag-mi` at 36–50 × 38 (< 40). Fix: at ≤ 600 px raise the strip's
row height to 44 and drop labels to icons only (they already have
`aria-label`), or let the strip scroll with a scroll-snap.

**T8 · minor · the expansion fold on every canvas is 11×11.**
`button.fc-group-fold.nodrag "Fold"` measures 11×11 at 390 and 8×8 at 1440 –
it is the only control for expanding a scope frame. Fix: a ≥ 24 px hit area
with the glyph centred.

**T9 · minor · one neutral grey in the palette.**
`rgb(187,187,187)` appears once in the Memory views (probe
`fx-agents-memory-1440.txt`, `-390`). The palette is warm; the design contract
requires warm lines and greys. Find and replace with a warm token.

**T10 · minor · em dashes render in skill descriptions.**
Two `span.sx-desc` on `#agents/skills` render the long-dash codepoint U+2014
(`repo-agents-skills-1440.txt`, flagged as `em dash` by the probe). The source
is third-party `SKILL.md` front-matter; normalise on render (U+2014 to the
spaced en dash U+2013) so the house rule holds for content kula does not author.

**T11 · minor · seats are not keyboard reachable.**
`nodesFocusable={false}` (`TeamCanvas.tsx:167,326`) means the only keyboard
path to a member is the Details list. Fix: make the seat's mark the focusable
element (it already has `tabIndex={0}` and an `aria-label`) and let Enter open
Details.

**T12 · nit · reload re-frames the canvas.** Because `AllCanvas` calls
`fitView` on mount (`TeamCanvas.tsx:273`), a saved arrangement is honoured in
data but appears at a different screen position after reload. Fix: fit once
per session, then restore the saved pan/zoom, or fit only when no
`positions` exist for any team.

---

## 5 · What is fine and should not be touched

- The **one-menu strip** (`Agents.tsx:104`) with a `Workspace` jump-out is the
  right shape; do not split it into a sidebar.
- **Teams as tinted rectangles in one space** delivers exactly what the plan
  asked: measured 0 overlap at fit, drag by header, one debounced write, honest
  persistence.
- **Memory graph-first with a DOM inventory** is the correct decision, and its
  click-through and anchor→map navigation both work.
- **Right-docked panels** (`ag-side-win`) are consistent across Teams and
  Memory.
- **Settings**, **Research** and **Logo studio** are the quality bar for the
  rest of the area.

---

## 6 · Method (so D1 can re-probe)

```
node .kula-team/tools/probe.mjs --hash <route> --url http://localhost:8072 --viewport 1440x900
node .kula-team/tools/probe.mjs --hash <route> --url http://localhost:8071 --viewport 390x844
node .kula-team/scratch/a3-teams.mjs    http://localhost:8072 1440 900   # rects, overlap, drag
node .kula-team/scratch/a3-drag.mjs     http://localhost:8072            # the team_layout write
node .kula-team/scratch/a3-persist.mjs  http://localhost:8072            # reload, normalized
node .kula-team/scratch/a3-dnd.mjs      http://localhost:8072            # member drag, agent drop, card logos
node .kula-team/scratch/a3-extra.mjs    http://localhost:8072            # dock, light, keyboard, 1100
node .kula-team/scratch/a3-studio3.mjs  http://localhost:8072            # logo studio
```

**The memory graph needs a seeded state** – both running servers ship 2
memories, so any graph claim must seed first and forget after:

```
node .kula-team/scratch/a3-seed.mjs   http://localhost:8072 30   # POST /api/agents/remember, 30 x, token from the page meta tag
node .kula-team/scratch/a3-graph.mjs  http://localhost:8072 1440 900   # -> 40 nodes, 39 overlaps, 25 off-screen   (n=32)
node .kula-team/scratch/a3-forget.mjs http://localhost:8072      # restores /api/agents to 2 memories (ids [4,5])
```

The seeder sends the header the API expects (`x-kula-token`), read from the
page's own `<meta name="kula-token">` – a bare `fetch` without it is a 401 and
seeds nothing. Run `a3-graph.mjs` **before** seeding for the n=2 baseline (6
nodes, 3 overlaps, `a3-graph-n2.log`). `a3-dnd.mjs` writes to `team_layout` and
`team_add_member`; undo the member with
`POST /api/agents/team_remove_member {"name":"graph","workflow":"docs"}` and
restore the fixture `kula.toml` from a copy taken before the run.

Independent reproduction of the headline numbers
(`node .kula-team/scratch/a3-verify.mjs`):

```
T2 zoom=translate(74px, 301.349px) scale(0.336235) head=196x11 mark=10x12 seat=50x31
T5 agents@1440: overlaps sb-help -> card ag-card
T5 agents@390:  overlaps sb-help -> card ag-card
T5 agents/research@1440: overlaps sb-help -> card ag-card ag-card-add r
T5 agents/skills@1440:   overlaps sb-help -> sx-row , sx-head
T6 docs@390 offscreen=18 section-title right=528 | sx-list right=528 | sx-row right=527
```

Screenshots cited (all under `docs/ui-critique/shots/`): `a3-agents-1440.png`,
`a3-agents-390.png`, `a3-teams-1440.png`, `a3-teams-390.png`,
`a3-memory-1440.png`, `a3-docs-390.png`, `a3-research-1440.png`,
`a3-skills-1440.png`, `a3-settings-1440.png`, plus the width/mode shots the
brief asks for: `a3-agents-1100.png`, `a3-teams-1100.png`,
`a3-agents-light-1440.png`, `a3-docs-light-390.png`.

All probe screenshots not cited here were deleted. The 30 stress memories seeded
on the fixture for T4 were forgotten again (`a3-seed.mjs` / `a3-forget.mjs`;
`/api/agents` back to 2 memories, ids [4,5]), the member `a3-dnd.mjs` dropped on
team `graph` was removed, and every `kula.toml` layout write (the team drags and
the seat drag) was reverted from a copy taken before the run, so the shared
fixture is back to its seed state.
