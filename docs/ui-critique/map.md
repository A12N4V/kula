# Map and graph pages – measured critique (A2)

Scope: MapView and `web/src/views/map/*`, GraphView, MiniGraph, NotesGraph,
Contrast, Query, Overview – on kula's own repository (`http://localhost:8071`,
branch `launch`, 3,609–3,621 symbols) and on the e2e swarm fixture
(`http://localhost:8072`, branch `main`). Wave 1: read-only, no code changes,
no builds; every number below comes from a probe run against those two servers.

Every claim is tagged with its evidence: `E<n>` keys resolve in
*Evidence index* at the end, and screenshots live in `shots/`.

## Headline

The map is the strongest surface in this set: it is quiet at rest (0 rAF/s),
its blocks do not overlap, dragging works and persists, and the lock genuinely
prevents node drags. Its weakest points are reach and legibility – at the
default 85% fit, 78 of 95 cards sit off-screen on kula's own repo, and the six
layer chips are effectively dead (five of six change nothing measurable).
The graph is the weakest: a 4.2 s first paint, 112 overlapping node pairs, and
a HUD that disagrees with itself between samples. Contrast, Query and Overview
are solid but under-explained.

## Evidence index

| key | what it is | where |
|---|---|---|
| E1 | map 8071 @1440×900: 95 `.fc-node` (14 `fc-group`), 0 leaf-vs-leaf overlaps, zoom 85%, graph bbox 6407×1300, 78 nodes off-screen, 37 edges, 0 idle rAF/s | `scratch/m-8071-map-1440x900.json`, `scratch/m2-8071-map-1440.json` |
| E2 | map 8071 @390×844: 95 nodes, 0 leaf overlaps, 90 off-screen, wrap 390×680 | `scratch/m-8071-map-390x844.json` |
| E3 | map 8072 @1440×900: 81 nodes, 0 leaf overlaps, bbox 6440×1129, 61 off-screen, 25 edges, zoom 85% | `scratch/m-8072-map-1440x900.json` |
| E4 | naive `.fc-node`×`.fc-node` overlap: 66–67 pairs, all container(`zone-N`)/child | `scratch/m-8071-map-1440.json` |
| E5 | drag: node `b91` moved dx 227.8 / dy 130.9; `kula.flow.pos.v1.*` key appeared; position survived `page.reload()` | `scratch/a2-drag.mjs` |
| E6 | lock (`fc-lock` aria-pressed=true): dragging `b92` moved `b92` **and** unrelated `b36` by the same delta (dx 200) → canvas panned, node did not move; no new persisted key | `scratch/a2-drag.mjs` |
| E7 | zoom: out → 71%, in ×2 → 89%, fit → 16%; at fit, 0 overlapping leaf pairs among 81 visible nodes | `scratch/m-8071-map-1440x900.json` |
| E8 | graph 8071: 3,621 nodes / 13,869 edges, tPaint 4,192 ms, 112 overlap pairs, maxDegree 1,384, avgDegree 7.66, camera ratio 1, canvas 1384×826 | `scratch/graph-1440.json` |
| E9 | graph 8071 level switch to Files: 372 nodes / 2,229 edges, 0 overlaps; back to Symbols: 3,621 nodes | `scratch/a2-graph.mjs` |
| E10 | graph inspector docks right: x 1048, y 60, w 380, h 802 on a 1440×900 viewport | `scratch/a2-graph.mjs` |
| E11 | map settings sheet testids: `u2-layers`, `u2-layer-{blocks,flows,chains,fences,agents,runs}`, `map-scheme*`, `map-edges*`, `map-labels*`, `map-minimap`, `map-snap`, `u2-tidy`, `map-reset-layout`, `map-clear-pin` | `scratch/a2/final.json` |
| E12 | layer toggles on map 8071: `blocks`/`flows`/`chains`/`fences`/`runs` off → nodes 95, edges 37, band 1 (unchanged); `agents` off → nodes 80, edges 36, band 0 | `scratch/a2/final.json` |
| E13 | minimap: checkbox toggles `.react-flow__minimap`, rect 192×128 at (1233, 587) | `scratch/a2/final.json` |
| E14 | map inspector docks right: `map-inspector`/`#map-sidebar` rect x 1028, y 60, w 400, h 802 | `scratch/a2/final.json` |
| E15 | map route/headline text at rest: `src · compare → src · build_with → map · name_tokens → …`; deep link `#map/zone-0` left route, headline, node count (95) unchanged | `scratch/a2/map3.json` |
| E16 | contrast: overlay 1 canvas; split 2 canvases (`main` 935 nodes → `WORKTREE` 3,546 nodes, +2427); report 0 canvases (text only); panel 360×826 at x 1080 | `scratch/a2/final.json` |
| E17 | fences 8071: HUD `… Fences 164 3,609 symbols 10,540 edges 12 dirs 175 hubs`; panel `FOR AGENTS now · LOCKED 17 read only · REVIEW 147 may change; a person reviews it · DIRECTORIES 12` | `scratch/a2/final.json` |
| E18 | probe PROBLEMS – map: 8071@1440 → 1 (neutral grey `rgb(187,187,187)` ×14); 8071@390 and 8072@390 → 6 (five <40 px targets + grey); 8072@1440 → 1 (grey) | `scratch/a2/map-8071-1440.txt`, `…-390.txt`, `…8072-…` |
| E19 | probe PROBLEMS – graph @1440: 0; notes: 1 (`button.tgl.on` 90×26); query: 1 (`div.grip.grip-right` 8×826); overview: 0 | `scratch/a2/8071-{graph,notes,overview,query}-1440x900.txt` |
| E20 | console: 8071 `Failed to load resource: 401 (Unauthorized)` on map/graph/notes; 8072 console clean; both emit `GPU stall due to ReadPixels` WebGL warnings | probe output, `scratch/a2/final.json` |

## Map (`#map`) – the codebase map

**Value function.** Answer "where does this code live, and what touches what".
A repository's blocks, the flows between them, the agent fences over them and
the last run's state – one canvas, one inspector.

**Layout map (1440×900).** Left-to-right: the top strip (`map-view` header with
`map-headline` and `map-route`); the flow canvas `map-flow` → `map-flow-canvas`
filling the region right of the nav rail; a top-right HUD cluster at x 976→1430
(`map-key-dock`,
`x5-legend` 82×30, `u9-plain-chip`, `map-hud` 93×30, `map-explorer-btn`);
the right-docked inspector `map-inspector` / `#map-sidebar` 400×802 at x 1028.
Inside the canvas: `fc-group` zone containers holding `fc-node` cards, the
whole-codebase square with `x5-agent-band` above the zone row, dashed agent
wires, and `edge-road:zone-N>zone-M` edges between zones.

**Features present.**

- Signals: blocks, flows, chains, fences, agents, runs as six layer chips
  (`u2-layer-*`, E11).
- Settings sheet (`map-settings-btn` → `map-settings-sheet`): colour scheme
  (role/section/heat/mono), edge density (Few/Normal/Full), card labels
  (Few/Normal/Many), minimap, snap-to-grid, Tidy, Reset layout, Clear pin.
- Canvas verbs: zoom in/out, fit, tidy, reset, lock (`aria-pressed`), zoom
  readout (`fc-zoom`); sidebar toggle.
- Agent fence hull: `x5-agent-band` sits above the zone row with an
  agent-square per fenced agent and dashed gradient wires into each fenced
  square; unfenced agents sit left of the whole-codebase square.
- Legend key dock (role hues / flow hue), plain-words toggle.

**Ratings (1–10).**

| axis | score | why |
|---|---|---|
| Value | 8 | It is the only surface that answers "where does this code live" at repo scale. |
| Clarity | 7 | Cards read well and the zone hierarchy is legible; the dead layer chips cost a point. |
| Density / hierarchy | 8 | Four levels of nesting drawn without collisions (E1); 78/95 cards off-screen at 85% is the cost. |
| Consistency | 8 | Same chrome, same control shapes as the rest of the app; the six-layer vocabulary is the one inconsistency (E12). |
| Interaction | 6 | Drag + persist + lock all work (E5, E6); but 4 of 6 layer chips are inert and the deep link does not drill (E12, E15). |
| Robustness | 8 | 0 crashes, 0 console errors on 8072; one console 401 on 8071 (E20). |
| Polish | 8 | 0 rAF/s at rest, no running animations, no horizontal overflow (E1). |

**Ranked issues.**

1. **Five of six layer chips change nothing measurable** – `u2-layer-blocks`,
   `-flows`, `-chains`, `-fences`, `-runs`: toggling each left `.fc-node` at 95,
   `.react-flow__edge` at 37 and the agent band at 1. Only `-agents` moved the
   canvas (95→80 nodes, 37→36 edges, band 1→0) (E12). *Element*: `chrome.tsx:33`
   `LayerBar` mounted at `chrome.tsx:244` inside the settings sheet.
   *Fix*: have `MapView` actually consume `layers.chains/fences/blocks/flows/runs`
   in the node/edge builders (the same way `agents` already gates the agent
   marks in `flowKit.tsx:510-556`), or shrink the vocabulary to the layers that
   exist so the control tells the truth.

2. **78 of 95 cards are off-screen at the default fit** – at 85% zoom the graph
   bbox is 6407×1300 px against a 1384×826 canvas; 78 cards are fully outside
   the viewport, and `fit` drops to 16%, where they are legible but tiny (E1,
   E7). *Element*: `fc-zoom` readout + `fc-fit`. *Fix*: fit on load with a
   minimum zoom floor (e.g. never below 45%) and let the canvas scroll instead
   of shrinking; or default to fitting the largest zone rather than the whole
   graph.

3. **Neutral grey `rgb(187,187,187)` is used 14 times on a colour-contrast
   check that flags it** – the only real PROBLEM the probe raises on the map at
   1440 (E18). *Element*: `--text-3`-class labels inside the canvas.
   *Fix*: re-map that grey to the design contract's text-2/text-3 tokens so the
   contrast check passes.

4. **390 px loses 5 controls to sub-40 px hit targets** – `button.strip-menu-btn`
   198×30, `button.u7-legend-head` 34×40, `button.u9-chip` 34×30, `button.ex-btn`
   40×30 ×2 (E18). *Fix*: raise the mobile min-height to 44 px for
   `strip-menu-btn`, `u7-legend-head`, `u9-chip`, `ex-btn`.

5. **A deep link to a block does not drill** – opening `#map/zone-0` left the
   route text, the headline and the node count (95) identical to `#map` (E15).
   `zone-0` is a live block id (it appears in `rf__edge-road:zone-0>zone-1`).
   *Element*: `parseHash` route `#map/<blockId>` at `App.tsx:84-99` vs the drill
   callback at `MapView.tsx:232`. *Fix*: honour the block segment in the initial
   route the way the in-canvas drill does, or drop `#map/<blockId>` from the
   route table so nothing promises it.

6. **The map's "breadcrumb" is a flow route, not a trail** – what renders at the
   top is `map-route` (`src · compare → src · build_with → …`), and
   `map-breadcrumb` from `views/map/canvas.tsx:137` is not mounted on this map
   at all (the map uses `map-flow-canvas`, E15). Deep-linkable path state is
   therefore invisible. *Fix*: mount the block-path trail next to `map-headline`
   and keep `map-route` for the chain, or rename so the two are distinguishable.

## Graph (`#graph`) – the symbol graph

**Value function.** Explore the whole graph at three levels (Files, Symbols,
Packages), find hubs, isolate a neighbourhood, fence it, and contrast two
revisions.

**Layout map (1440×900).** Canvas `graph-canvas` x 56→1440, y 48→874
(1384×826). HUD `.graph-overlay` across the top: level strip
(`Files ƒ Symbols Files Packages 57`), then `Contrast`, `Isolate`, `Fences`,
then live counts (`3,609 symbols 10,540 edges 12 dirs 175 hubs`). Inspector
docks right at x 1048, w 380, h 802 when a node is picked (E10), with tabs
Impact / Trace / History / Blame / Remember / Fence this / Copy path:line /
Copy id / Context.

**Ratings.**

| axis | score | why |
|---|---|---|
| Value | 8 | The only whole-repo structural view; the level switch is the best idea here. |
| Clarity | 5 | 3,621 nodes with 112 overlaps and a HUD that changes its own numbers between samples. |
| Density / hierarchy | 5 | Sigma's normalised display coords give no sense of scale; counts drift (3,621 vs 3,609 symbols; 13,869 vs 10,540 edges) (E8, E17). |
| Consistency | 6 | Same chrome as the map, but it is the one surface with no minimap and no lock. |
| Interaction | 6 | Level switch, isolate, contrast, fences all work; first paint is 4.2 s. |
| Robustness | 7 | No crashes; `GPU stall due to ReadPixels` warnings on every sample (E20). |
| Polish | 5 | Overlapping nodes at hub clusters; the HUD sentence is a run-on. |

**Ranked issues.**

1. **112 overlapping node pairs in the rendered graph** – measured in
   viewport-normalised space after converting sigma's display data; examples
   `892`/`875` at 8.2 px separation vs an 8.6 px combined radius, `910`/`786` at
   8.2 vs 8.4 (E8). *Caveat*: sigma display coords are normalised, so this is a
   rendered-space approximation, not a layout-space overlap count. *Element*:
   `graph-canvas` node program. *Fix*: re-run a noverlap pass on the display data
   (or raise `labelRenderedSizeThreshold` and shrink hub node size) at the
   settled layout, then re-measure.

2. **First paint on kula's own repo is 4,192 ms** (E8) – more than two seconds
   past the point a user stops waiting. *Element*: `#graph` mount.
   *Fix*: paint the level strip and HUD immediately, defer the ForceAtlas2/WebGL
   pass, and show the existing loader until `graph-canvas` has nodes.

3. **The HUD contradicts itself between samples** – one sample read
   `… 57 Contrast Isolate Fences settling`, a later one
   `… Fences 164 3,609 symbols 10,540 edges 12 dirs 175 hubs`, while the graph
   object held 3,621 nodes / 13,869 edges (E8, E17). Numbers must be quoted with
   their sample moment, and a user sees the same flicker. *Fix*: drive the HUD
   from one settled snapshot (freeze the count when `settling` clears) and render
   counts as separate labelled values, not one sentence.

4. **Hub nodes collapse into each other** – maxDegree 1,384 against avgDegree
   7.66 (E8): one node carries ~180× the average degree, so at camera ratio 1
   its neighbours pile up. *Fix*: scale node radius sub-linearly with degree
   (e.g. `sqrt(deg)`) and give hub nodes a minimum separation in the layout.

5. **The graph has no minimap and no drag lock**, where the map has both (E13,
   E6). *Fix*: reuse `FlowCanvas`'s `fc-minimap-toggle` / `fc-lock` controls in
   the graph HUD; the readout already exists as a pattern.

## MiniGraph and NotesGraph

**MiniGraph** (`views/MiniGraph.tsx:126`) is the shared small renderer: same
sigma + ForceAtlas2 + noverlap kernel as the map, seeded x/y, hover fades
everything but the neighbourhood, pointer-based picking within 24 px, and an
overlay that draws territories and travelling flow dots. It is honest about
failure: if WebGL cannot start it prints "This browser could not start WebGL,
which the graph needs." Rated **Value 6 / Clarity 8 / Density 8 / Consistency 9
/ Interaction 7 / Robustness 7 / Polish 8** – it is clean and reusable, but at
default size its labels only appear above `labelRenderedSizeThreshold: 7.5`, so
small graphs show dots with no names until hover.

**NotesGraph** (`views/NotesGraph.tsx:64`) composes MiniGraph into a repo hub
star: repo centre, kind hubs (file/symbol/commit/cluster) in territories, each
note a node beside its target, `[[links]]` as accent-coloured flow edges.
**The pane is behind a toggle.** On `#notes` (22 notes) the only way in is the
`button.tgl.on` "Show notes as a graph beside the notes" chip, measured at
90×26 – under the 28 px minimum and the single PROBLEM the probe raises on that
page (E19). *Fix*: raise the toggle to the shared 28 px control height and
consider defaulting the graph pane on, since the notes list alone does not show
the link structure. Rated **Value 7 / Clarity 7 / Density 7 / Consistency 8 /
Interaction 6 / Robustness 7 / Polish 7**.

## Contrast (`#graph/contrast/<base>/<head>[/overlay|split|report]`)

Three modes over the same camera: `overlay` draws one canvas, `split` draws two
(`.split-canvas` with `graph-canvas` per pane and Before/After tags), `report`
draws none and renders the textual analysis. Panel `contrast-panel` docks right,
360×826 at x 1080 (E16). Measured on `main` → `WORKTREE`: Before 935 nodes,
After 3,546 nodes, +2427 (E16) – a legible summary of a large working tree.

Rated **Value 8 / Clarity 8 / Density 8 / Consistency 8 / Interaction 7 /
Robustness 8 / Polish 8**.

Issues: (a) the Report mode silently degrades to an explanation when either
revision is uncommitted – the empty state says "The textual report compares
committed revisions…", which is correct but leaves the reader without the
report they asked for; (b) the revision pickers are two `select` elements plus a
`⇄` swap inside a HUD that already carries a three-way mode segment, so the
control row is dense. *Fix*: in Report mode with an uncommitted head, render the
changed-symbol list as the report body instead of prose.

## Query (`#query`)

SPARQL 1.1 against the same knowledge graph the agents get. Two-pane split with
a resizable examples/vocabulary list (`listWidth("query", 320)`), an editor with
predeclared prefixes, Run (⌘↵) and four export formats, and results that link
back into the map (`kq-iri`, `kq-path`, `kq-term`).

Rated **Value 7 / Clarity 8 / Density 8 / Consistency 8 / Interaction 7 /
Robustness 8 / Polish 7**.

Issue: the only PROBLEM the probe raises is the resize grip `div.grip.grip-right`
(8×826) being reported as a small target (E19) – a false positive produced by
measuring a full-height 8 px grip against a 28 px minimum, but it is still a
hard 8 px target for a pointer. *Fix*: give `Grip` a transparent 12–16 px hit
area (padding or `::before`) while keeping the 1 px visual line.

## Overview (`#overview`)

The review queue, not a graph: repo header, a six-row `StatTable`
(Proposals / Issues / Uncommitted / Branches / Hotspots / Notes), the `Coupling`
panel, then Needs review, Branches, Recent commits, Open issues and Hotspots.
Zero probe PROBLEMS (E19); console clean (E20). Rated **Value 9 / Clarity 9 /
Density 9 / Consistency 8 / Interaction 8 / Robustness 9 / Polish 9** – the best
surface in this module.

One consistency note to carry into the component critique: A1 found `.card`
defined twice (`overview.css:13` vs `system.css:14`); Overview uses `card` and
`card-head` heavily, so any fix there changes this page's chrome – A2 does not
claim a fix, only the dependency.

## Cross-cutting

- **Design contract**: flat, square panels with 1 px warm lines and an
  absolute-black ground hold across all five pages; no glow, no glass, no hover
  scale was observed. Colour use is token-driven (counts of
  `rgb(134,125,115)`, `rgb(194,185,172)`, `rgb(240,235,227)`,
  `rgb(249,127,58)` dominate every page).
- **Quiet at rest**: 0 rAF calls/second and no running animations on `#map`
  (E1); the graph's only motion is the `settling` pass (E8).
- **The 401 on 8071** (`Failed to load resource: 401`) appears on map, graph and
  notes but not on 8072, and never on overview or query – it is a token/config
  difference between the two servers, not a view defect (E20).
- **Same five small targets at 390 px** on both servers (E18): this is one
  layout bug in the shared strip/legend, not four.

## Limits of this pass

- The 112-pair graph overlap figure is rendered-space, derived from sigma's
  normalised display data (E8) – treat it as a strong signal, not an exact
  count.
- `.fc-node` counts on the map include 14 `fc-group` containers; leaf-vs-leaf
  overlap is 0 (E1, E4). The naive 66-pair number is container/child and is
  **not** a defect.
- Layer chips: only DOM-visible mark counts were compared (E12). A purely
  visual change (opacity/tint) would not register, so the finding is "no change
  in rendered mark counts", and it is ranked first because five inert controls
  are worse than five visual ones.
- MiniGraph ratings are source-level (its own pages were not in A2's probe
  set); NotesGraph was probed only through the `#notes` toggle.
- 1100 px was probed on the graph (`a2-graph-8071-1100-dark.png`); the map was
  probed at 1440 and 390.

## Screenshots

27 cited captures in `docs/ui-critique/shots/` – dark and light, 1440 / 1100 /
390, both servers. Every one is referenced above; two probe frames that carried
no finding (a duplicate rest frame and a deep-link frame identical to rest in
content) were deleted rather than shipped.

| page | 8071 (kula repo) | 8072 (swarm fixture) |
|---|---|---|
| Map | `a2-map-8071-1440-{dark,light,inspector}.png`, `a2-map-8071-390-light.png` | `a2-map-8072-1440-dark.png` |
| Graph | `a2-graph-8071-1440-{dark,light}.png`, `a2-graph-8071-1100-dark.png`, `a2-graph-8071-390x844-dark.png`, `a2-graph-8071-390-light.png` | `a2-graph-8072-1440-dark.png` |
| Notes | `a2-notes-8071-1440-{dark,light}.png`, `a2-notes-8071-390-light.png` | `a2-notes-8072-1440-dark.png` |
| Overview | `a2-overview-8071-1440-{dark,light}.png`, `a2-overview-8071-390-light.png` | `a2-overview-8072-1440-dark.png` |
| Query | `a2-query-8071-1440-{dark,light}.png`, `a2-query-8071-390-light.png` | `a2-query-8072-1440-dark.png` |
| Contrast | `a2-contrast-{overlay,split,report}-8071-1440.png` | – |
| Fences | `a2-fences-8071-1440.png` | – |