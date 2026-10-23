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
