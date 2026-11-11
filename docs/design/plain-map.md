# The plain-language map – X5 contract

Wave 1 spec. Decisions for five parts of the Map's reading layer, each citing
its evidence. U6 builds §5; U7 builds §2/§3; U9 builds §1/§4; X7 measures the
result (PLAN-fuse2 §B11/B10). Tests live in `web/e2e/plain.spec.ts`,
`test.fixme` until the owning U module lands them (X6 un-fixmes). Every test id
named here is part of the contract – U modules attach exactly these
`data-testid` values.

Sources cited short: [ORCH] `.kula-team/refs/ux-map-orchestration.md`,
[N8N] `.kula-team/refs/n8n-ui-notes.md`, [INS] `inspirations/README.md`,
[PLAN] `refs/PLAN-fuse2.md`, BRIEF = `.kula-team/BRIEF.md`.

## 0. The one-line goal

A non-coder reads the Map the way a pilot reads a weather map: labels they
understand, a key in the corner, the routes drawn, and a question box that
lights the answer. [ORCH §1] – the map must answer *what does this software
do, where, and who works here* without opening a file. [INS kuhn-codemap]
– participants read a map's value almost entirely through search and flows,
not free navigation, so words and search are the product.

## 1. The reading layer (U9 builds; measured on the fixture)

Decisions (all measured against the live fixture at 1440×900 and 390×844,
fit view ≈ 47 % zoom):

1. **Default caption is the plain name, ≤ 4 words.** Today captions show
   `dir · name` (`src · compare`) – a directory plus a technical name. [N8N §2]
   – n8n keeps the identity in the icon and the name in a caption under the
   tile; the caption is the non-coder's only entry point. The backend already
   returns `plain` per block (`GET /api/map/explain` →
   `blocks[id].plain`, verified on the fixture, `source: model|theme|name`),
   and the brief caps it at four words; longer plain names ellipsize and the
   full text stays in the hover sentence. Directory still shows as the hue
   (colour = area, §2), so `dir ·` is dropped from the caption, not from the
   map. Test id **`x5-plain-caption`** on the caption element, keyed by block
   id (`data-block`).
2. **Code name returns in exactly two situations:** (a) the toggle
   **"Show code names"** in the right column; (b) near zoom – scale ≥ 2.2× –
   where the reader is looking for the code. [ORCH §4 semantic zoom] – far =
   tile + caption, near = code facts; the switch must be by zoom level, not
   by click. Toggle test id **`x5-plain-toggle`**, `aria-pressed` semantics;
   near-zoom swap is tested by zooming (no separate id).
3. **Hover shows the one sentence.** `blocks[id].sentence`, one line, in a
   tooltip anchored to the square (not the pointer). [N8N §4] – hover toolbars
   float above nodes, nothing appears on the node face. Test id
   **`x5-plain-sentence`**; asserted on the fixture block whose plain name is
   "Router" (fixture has it, verified via `/api/search/semantic`).
4. **Fallback is graceful.** Until named (`source: "name"` or missing entry),
   caption falls back to the EmbeddingGemma theme word, then the technical
   name – the base behaviour. [BRIEF] – "until named, words fall back to
   themes"; [INS kuhn-cartographic] – a stable map beats a perfect one; the
   map must not blank while words are missing. No new id – the fallback path
   reuses `x5-plain-caption`.
5. **"Map in plain words" run control** (progress `status.named / total`,
   re-map with another model via `POST /api/map/explain/run { all: true }`)
   is specified in U9's plan; X5 only fixes its test ids:
   **`x5-plain-run`** (button), **`x5-plain-progress`** (named/total readout).
   Payload validated on the fixture: `{ blocks, stale, status: {named,total},
   agent }`.

## 2. The legend (U7 builds)

One compact, always-available key, **collapsible in the right column – never a
modal** (manager's decision, BRIEF §Modules X5): a modal hides the very thing
it explains, and the one-navigation-column invariant holds [BRIEF base].

Collapsed state: a single "Key" row button. Open state: five fixed rows,
each one line – **colour = area of the product** (the directory hue swatches,
from `colors.ts dirColor/groupDirs` – import, never copy [U7 plan]);
**size = amount of code** (bigger square = more symbols);
**glyph = language** (RS/TS/PY… from `views/map/icons.tsx`);
**ring = value flow** (a picked journey rings its squares in its hue);
**dashed square = an agent works here** (§5).

Test ids: **`x5-legend`** (toggle button, collapsible via
`aria-expanded`), **`x5-legend-panel`** (the open key), rows
**`x5-legend-colour`**, **`x5-legend-size`**, **`x5-legend-glyph`**,
**`x5-legend-ring`**, **`x5-legend-agent`**. Default open state on first
visit for a non-coder's first minute is **open** (B11 task 1 needs it);
collapses on click and stays collapsed for the session.

## 3. Journeys – value flows as sentences (U7 builds)

A journey is a value flow told as **numbered sentence steps** over the map:
"1. You press Save → 2. the file is checked → 3. it is written to disk."
[ORCH §3] – "runs are journeys"; [ORCH §3 table] – a flow is a highlighted
path pickable from a list; [INS huang] – for path tasks what matters is the
crossings *on the path*, so while a journey is picked, everything not on it
dims (base behaviour: ring + wire tint, rest dimmed).

Decisions:

1. **Overlay strip, not a side panel** (manager's decision): numbered steps
   render as a horizontal strip docked to the bottom of the canvas while a
   journey is picked, so the map stays visible beside the words the reader
   needs to follow. Test id **`x5-journey-strip`**; steps
   **`x5-journey-step-<n>`** (1-based).
2. **Camera walk:** Next/Prev buttons (**`x5-journey-next`** /
   **`x5-journey-prev`**) and keys ←/→ (scoped to when a journey is picked
   [U7 plan]) pan the camera square to square; the picked step is highlighted
   (`aria-current="step"`). [ORCH §4] – layout must be stable; the walk moves
   the camera, never the layout.
3. **Word source:** journey sentences come from `blocks[id].journeys[]`
   (verified in the live `/api/map/explain` payload); a flow without plain
   sentences falls back to the block plain names as its steps. Never show a
   technical name in the strip while plain words exist.

## 4. The question box (U9 builds)

"Where does … happen?" – the rail search gains an **"Ask in plain words"**
mode. [INS sourcetrail] – "the search must drive the map, not the other way
round"; [ORCH §5] – search filters and moves the camera, never re-lays-out.

Decisions:

1. The existing rail search gets a mode toggle **`x5-question-mode`**
   ("Ask in plain words"). In this mode the query is sent to
   `GET /api/search/semantic?q=&limit=5` (verified payload:
   `{ hits: [{ id, score, plain }], mode: "semantic"|"words" }`).
2. **Squares light up:** the top 5 hits get the accent treatment (ring +
   their plain caption brightens); the **top hit gets the full ring and a
   label** [ORCH §8 dry-run pattern: outline for intent, filled for the
   picked answer]. Test ids: **`x5-question-hit`** on each lit square,
   **`x5-question-top`** on the first (sorted by score, ties broken by list
   order from the API – never by fixture counts).
3. **Fallback:** when `mode` comes back `"words"` (no embeddings), the same
   lighting runs on the word-overlap hits and the answer is not
   distinguished – the words returned are already plain. [BRIEF] – graceful
   when the backend has no model.
4. Results list under the box shows each hit's `plain` name and score
   (**`x5-question-result`**), clicking one pans to its square; the list is
   the [INS sourcetrail] graph + snippet pairing, at map scale.

## 5. Agents on the terrain – rules for U6

The Agents layer turns agents from a left-column list into **actors on the
terrain** [ORCH §3: "code is terrain, agents are actors"]. X5 fixes the
placement rules; U6 builds them (`views/agents/actors.tsx`,
`flowKit.tsx` agent nodes only, `styles/agents-terrain.css`).

1. **Fenced agent → agent square beside its first fenced square.** Same row,
   one grid-cell gap, harmonograph mark + agent name + dashed hue border.
   Why beside, not above: [ORCH §4] – actor edges should be roughly vertical
   and block edges roughly horizontal so capability never crosses data; with
   the agent *in* the row its dashed wires drop into its fenced squares
   without threading the terrain. Test: agent box within 1 grid cell of its
   first fenced square [U6 plan].
2. **Dashed wires agent → each fenced square.** Dashed 1px, coloured by the
   agent's hue. [N8N §4] – capability edges are the same grey, only dashed;
   dash = "may touch", not "data flows". Test id **`x5-agent-dashed`** on the
   wire; agent node **`x5-agent-node`**.
3. **Unfenced agent → one "whole codebase" block.** The entire map collapses
   into a single solid, colour-banded square (bands = directory shares) left
   of the agent, wired into it – "deployed on everything" reads in one glance.
   [ORCH §3] – selecting an agent projects its reach; for an everywhere-agent
   the projection *is* the whole map, so a collapsed band-square is the honest
   drawing (drawing the full reach would repaint the map, [INS agentgui] –
   observability must not cost the overview). Test id **`x5-agent-whole`**;
   agent box sits to its left.
4. **Agents toggle off ⇒ zero agent marks in the DOM** (not hidden, removed):
   the layer is the switch [ORCH §5 layers instead of tabs]; a non-coder
   running B11 task 3 must not see dashed marks that invite a question the
   layer answers. Test asserts count 0 with the toggle off.
5. **The left actor column survives on phone only** – canvas hidden space
   there is too small for adjacency; the list is the fallback [ORCH §10].
6. U3 interactions are kept: fence hull + dim ≤ 35 %, drop-a-square = add to
   fence, autonomy/caps in the inspector [U6 plan].

## 6. Acceptance tests (`web/e2e/plain.spec.ts`, failing-first)

~10 tests, `test.fixme`, keyed to the ids above, asserted **by name** (the
fixture is per worker; never counts of blocks). Owner column = the U module
that must make the test pass; X6 un-fixmes as each lands.

| # | test | owner | id(s) |
|---|---|---|---|
| T1 | captions show plain names ≤ 4 words by default | U9 | `x5-plain-caption` |
| T2 | "Show code names" toggle swaps caption to the technical name and back | U9 | `x5-plain-toggle` |
| T3 | hover on a square shows its one-sentence summary | U9 | `x5-plain-sentence` |
| T4 | explain run control renders named/total progress and handles `{started:false}` | U9 | `x5-plain-run`, `x5-plain-progress` |
| T5 | legend exists, is collapsible, shows the five rows | U7 | `x5-legend*` |
| T6 | picking a journey shows the numbered sentence strip | U7 | `x5-journey-strip`, `x5-journey-step-1` |
| T7 | Next/Prev walk the camera square to square (position changes per step) | U7 | `x5-journey-next` |
| T8 | question mode queries semantic search and lights the top hit distinctly | U9 | `x5-question-*` |
| T9 | fenced agent square sits within 1 grid cell of its first fenced square, dashed wires present | U6 | `x5-agent-node`, `x5-agent-dashed` |
| T10 | unfenced agent gets the whole-codebase band block to its left; Agents off ⇒ 0 agent marks | U6 | `x5-agent-whole` |

## 7. What X5 will not decide

Visual styling of plain captions, animation timings, wire routing – U8.
Panel typography – U7. B11 protocol and the final record – X7.

## 8. The record – readability for non-coders (X7, wave 3)

Final record for the plain-language map, run per [PLAN] §B11 and §B10 on the
fixture repo (`web/e2e/fixture.sh`), one run per viewport × colour scheme:
1440×900 and 390×844, dark and light. Probe: `.kula-team/scratch/x7-probe.mjs`
(+ `x7-bench.mjs` for the canvas numbers), raw logs, screenshots and the bench
JSON in `.kula-team/scratch/x7-{1440d,1440l,390d,390l}.log/.png` and
`x7-bench-1440.json`. Scores are evidence-based: the evaluator read only the
words and controls on screen (DOM dump + screenshots), as the non-coder rule
requires – no code names in the reasoning.

### 8.1 State at recording

The record was taken on the wave-2 exit state (U7 rework `3ae6bfe` merged,
`7321ed0`): **U9's reading layer had not landed yet** – `views/map/plain.tsx`
did not exist, no `x5-plain-*` or `x5-question-*` id was in the DOM. This
section therefore serves double duty: it is the *before* column U9 is building
against, and the protocol U9 (or the critic) re-runs on the end state. Rows
marked **pending-U9** must be re-measured after the reading layer lands; the
table below is not acceptance of §1/§4.

### 8.2 B11 – five non-coder tasks (target: all correct, median ≤ 30 s)

| # | task | result | on-screen evidence |
|---|---|---|---|
| 1 | What are the 3 main things this software does? | **fail** | Captions are technical (`src · compare`, `web · flow`, `json · begin`); the legend (1440, visible on landing – 3 ms probe) explains colour and size but names no capability. A non-coder cannot name three things the software does. |
| 2 | Where is the part that saves files? | **fail** | No question box (`x5-question-mode` absent); typing "saves files" into the rail search lit 0 squares and returned code names only. |
| 3 | Which agent can change the settings code? | **fail** | Agents toggle on ⇒ 0 agent squares on the terrain (agent marks stay a list off-map at this state); no dashed squares to read capability from. |
| 4 | Follow what happens when a user runs a search – name the steps. | **fail** | No journey rows reachable without first clicking a square (rows live in the inspector aside); the strip never opened, so there were no numbered steps to follow. |
| 5 | What did the last run change? | **partial** | The Changes view answers *count* honestly (3 changed files listed) but in jargon: `STAGED`, `M`, `Stage all`, raw diff hunk text. A non-coder can say "3 files", not what changed in plain words. |

**Score: 0 of 5 correct** (task 5 partial). Median task time is not
meaningful against the target while tasks 1–4 fail at the first screen.
Scripted interaction times (probe): T1 72 ms, T2 2.2 s, T3 1.0 s, T4 0.1 s
(no rows), T5 1.6 s – the failures are comprehension failures, not
navigation-cost failures.

### 8.3 B10 – PREVis, 4 dimensions, 7-point (target ≥ 5.5 each)

Dimensions per the PREVis protocol: Understandability, Relevance,
Readability, Legibility.

| viewport | Understandability | Relevance | Readability | Legibility |
|---|---|---|---|---|
| 1440 dark | 2.5 | 4.0 | 4.0 | 4.5 |
| 1440 light | 2.5 | 4.0 | 4.0 | 4.5 |
| 390 dark | 2.0 | 3.0 | 3.5 | 3.5 |
| 390 light | 2.0 | 3.0 | 3.5 | 3.5 |

Every dimension is below 5.5. Posted to U9 with the fix each implies:

- **Understandability (2.0–2.5)** – plain names missing everywhere. Fix:
  build §1 – plain caption as default, sentence on hover, code names only on
  toggle or near zoom.
- **Relevance (3.0–4.0)** – the legend decodes the visual grammar but no
  journey rows or question box are reachable from the landing state; at 390
  the legend is not on landing at all (`legendVisibleOnLanding=false`). Fix:
  surface journeys + question mode without a click-first path, and keep the
  key on the phone landing (the docked key hides on phone where the panel
  legend serves – but the panel is not on the landing state either).
- **Readability (3.5–4.0)** – captions read `dir · name` with symbol-count
  prefixes (`RS76+` in the raw dump) that mean nothing to a non-coder; the
  Changes view mixes stage jargon with diffs. Fix: §1 reading layer for
  squares; plain-word run summary is a U9/lead follow-up (run diff wording).
- **Legibility (3.5–4.5)** – no horizontal scroll at 390 (good), but the
  fit-view caption size at 390 is far under comfortable reading size. Fix:
  U8's 3-step size scale already landed for squares; captions on phone need
  the same floor at fit zoom (re-measure B4 at 390 after U9).

### 8.4 Final benchmark table (baseline → end of run)

Baseline column = X6's mid-wave numbers on the U6 base (§1 of
`plain-interactions.md`); end column = this record, same fixture, 1440×900
dark, fit view.

| id | metric | baseline (wave 2 mid) | end (this record) | target |
|---|---|---|---|---|
| B1 | crossing ratio | 0.358 | 0.365 (808 pairs / 57 nodes, 67 edges) | ≤ 0.05 at rest |
| B2 | edges through nodes | 62 | 62 | 0 |
| B3 | border/label vs edge contrast (dark) | holds (.835 vs .418) | holds (.835 vs .418) | holds |
| B4 | median text density per node | 0.171 | **0.123** (U8 captions in `measure`) | – |
| B5 | port count / size | 176 × 10.2 px (wave 2 exit) | 114 × 10.2 px | – |
| B6 | overlap problems 1440 / 390 | 23 / 19 | not re-run (X7 docs-only; U7's final probe reported baseline values) | 0 |
| B11 | non-coder 5 tasks | not measured (no protocol) | 0/5 correct | 5/5, median ≤ 30 s |
| B10 | PREVis min dimension | not measured | 2.0 (390 Understandability) | ≥ 5.5 each |
| B12 | chrome controls @1440 | 24 | not re-run (X7 docs-only) | ≤ 18 |

Notes on the table: B1/B2 remain the open wires-cross gap (recorded since
X6, no wave-2 work targeted it); B4 improved 0.171 → 0.123 with U8's
captions-in-`measure`; B5 fell 176 → 114 ports on the current node set (the
3-step size scale). B6/B12 need a UI module's probe re-run and are marked as
such rather than guessed.

### 8.5 What the record asks of the remaining work

1. U9 lands §1/§4; this section's B11/B10 numbers are re-measured and the
   pending rows replaced – the protocol is exactly §8.2/§8.3, the probe
   script is in `.kula-team/scratch/x7-probe.mjs`.
2. Journey rows and the question box must be reachable from the landing
   state with no click-first path (X6's always-available rule, now measured
   in B11 task 4 and Relevance at 390).
3. The phone needs its own pass: legend off landing at 390 is the reason
   Relevance drops 1.0 between viewports.
4. Plain-word wording for the Changes view (task 5) is outside §1/§4 scope;
   recorded as a request to the lead in `handoff-x7.md`.

