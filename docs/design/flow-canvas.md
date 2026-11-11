# Flow canvas – the kula spec

R1 · Research. This is the contract F1 builds (`web/src/flow/**`) and M2/A3
mount (`views/map/**`, `views/agents/**`). It turns the n8n behaviour
reference in `BRIEF.md` into kula's design language, catalogues the visual
schematics, and pins the React Flow 12 APIs to use. No n8n source, styles or
assets were consulted or used – this is behaviour and feel only.

Design language is non-negotiable: `--bg` ground, `--line` warm borders,
cream text (`--text`), one accent (`--accent` / `--accent-ink`), JetBrains
Mono (`--font`), uppercase tracked labels, 1 px borders, radii 8/6/4
(`--radius`, `--radius-sm: 6px`, `--radius-xs: 4px` – F1 adds the two small
tokens). No glass, glow, shadow, gradient or hover scale. Every size below is
on the 16 px grid; every colour is a token name.

## 1 · Grid and canvas

| thing | value | notes |
|---|---|---|
| grid unit | 16 px | every node size, padding and step is a multiple |
| snap | 16 px | `snapToGrid` + `snapGrid={[16, 16]}` |
| background | `Background` `variant="dots"` | `color={var(--line)}`, `size=2`, `gap=16` |
| rank step (LR) | 128 px | dagre `nodesep` 32, `ranksep` 128 |
| sub-layout step (TB) | 96 px | config sub-nodes under their parent |
| canvas padding | 32 px | `fitView` padding so tiles never touch the edge |
| controls | 48 × 144 px | bottom-left `Panel`, `--panel` bg, `--line` border |
| minimap | 192 × 128 px | bottom-right `Panel`, masked to viewport |
| zoom range | 0.5 – 2 | `minZoom` / `maxZoom` |
| stroke | 2 px | zoom-compensated, see edges |

## 2 · Node anatomy

### 2.1 Shared anatomy

Every node is a React Flow custom node. Three shapes:

- **Tile** – 96 × 96, radius 8. One 32 × 32 glyph centred (map:
  `KindIcon` from `views/map/icons.tsx`; agents: `RoleMark`-style mark).
  Background `--panel`, 1 px `--line` border. Title sits **under** the tile
  (not inside): 13 px `--text`, one line, ellipsis; a subtitle line under it,
  11 px `--text-3`, one line. Status mark 16 × 16 in the tile's top-right
  corner: running `--accent` (pulsing dot, stopped under
  `prefers-reduced-motion`), success `--green`, error `--red`, pinned a
  `--accent` pin glyph, disabled = 40 % opacity + strike-through title.
- **Wide** – 256 × 96. Same tile rule but the glyph is 24 × 24 at left of a
  2-column text block (title + subtitle) inside the tile. Used for
  configurable nodes (workflow steps, research stages, memory).
- **Circle** – 80 × 80 (config sub-node). 20 × 20 glyph centred, no title
  under; a tooltip on hover carries the name. Dashed `--line-2` border.
- **Entry "D"** – the entry tile's left corners take the full 8 px radius and
  the right corners 0, so an entry reads as a D shape facing the flow.
- **Group frame** – see §4.
- **Loop node** – a tile with the group glyph and a "loop" subtitle listing
  member count; expanding it swaps the node for a `Loop`-shaped group frame.

Selected state: border becomes 1 px `--accent`, the tile background becomes
`--accent-soft`. Never a glow. Dimmed (when a chain is focused): opacity
0.25, `--node-faded` background.

### 2.2 Map node types (from `Role` in `views/map/types.ts`)

| node | shape | mark | subtitle | role colour |
|---|---|---|---|---|
| entry | tile, D-left | arrow-in glyph | path | `--accent` |
| orchestrator | wide | fan-out glyph | fan-out count | `--violet` |
| core | tile | block glyph | file path | `--text-2` |
| utility | tile | wrench glyph | fan-in count | `--green` |
| adapter | tile | plug glyph | "file / net / proc" | `--blue` |
| model | tile | shape glyph | kind | `--yellow` |
| config | tile | slider glyph | path | `--yellow` |
| test | tile | check glyph | path | `--red` |
| glue | tile | barrel glyph | re-export | `--text-3` |
| loop | tile → frame | loop glyph | `members.length` | `--text-2` |
| section (group) | frame | – | block count | – |

Rules: the `Role` field on `Block` / `Leaf` decides the type; `KindIcon`
supplies the glyph; `ROLE_COLOR` in `views/map/icons.tsx` supplies the colour
– one source, never re-invented. The block title shows `Block.name`; when
`Block.theme` exists (embedding-formed) it is the subtitle instead of the
path. A block's `cohesion` (0–1) renders as a 4-step mini bar in the
sidebar, not on the node.

### 2.3 Agent node types (from `AgentsInfo` in `web/src/api.ts`)

| node | shape | mark | subtitle | colour |
|---|---|---|---|---|
| team lead | wide | crown glyph | `Team.name` agent | `--accent` |
| member | tile | agent glyph | `member.workflow` | `--violet` |
| agent (workflow step) | wide | gear glyph | step command | `--text-2` |
| workflow step | wide | step glyph | `steps[i]` index | `--text-2` |
| research stage | wide | flask glyph | stage + experiment n | `--violet` |
| memory | circle | note glyph | scope (`scope` from `MemoryLayer`) | `--green` |
| guard fence | circle | shield glyph | level | `--red` |
| doc / rules | circle | book glyph | path | `--blue` |

A team lead hangs its members **below** it in the TB sub-layout (config
sub-node rule, §3.3); hand-offs between members are main edges. Memory nodes
attached to a lead or member are circles on the bottom edge.

## 3 · Handles and edges

### 3.1 Handles

- Main flow: input `Handle` on the left edge centre, output on the right
  edge centre. 8 × 8 px dot, `--line` fill, 2 px `--bg` ring; on hover the
  dot grows to 12 px and fills `--accent`.
- Sub-node (config) handles: 8 × 8 diamonds on the **bottom** edge of the
  parent and the **top** edge of the sub-node, `type="source"` /
  `type="target"` respectively. Non-main edges connecting to them are dashed.
- Unused output: a "+" stub – 16 px line with a 16 × 16 circle holding "+",
  rendered inside the node's right edge when the node has no outgoing main
  edge (`useOnSelectionChange` not needed; compute from edges). Click opens
  the node's detail panel.

### 3.2 Edges

- Forward (source right of target): bezier, 2 px stroke `--line-2`; hovered
  or selected edge `--accent`. On a live run, a 4 px dash overlay animates
  (`--accent`), and `prefers-reduced-motion` freezes the dash offset.
- Backward (target left of or above source – loops, `Loop` members, review
  cycles): **never** cut through the node. Route as smooth-step: drop 32 px
  below the source's bottom edge, run horizontally, rise 32 px into the
  target's bottom-left. Rounded 8 px corners. Rendered in `--text-3` at 2 px
  so it reads as an exception.
- Weight: edge stroke width 1–4 px by chain/flow weight (`Edge.weight`,
  `Chain.len`, `Family.count` – cap at 4, quantise in the data adapter, not
  the renderer). Sankey-as-stroke is the deliberate pick, see §6.
- Non-main (sub-node) edges: 1 px dashed `--line-2`, never animated.
- Labels: 11 px `--text-3` on a `--bg` pill riding the edge midpoint via
  `EdgeLabelRenderer`; only when an edge has a label, never for every edge.
- Edge hover toolbar (2 px hit area padded to 16 px): "insert step here"
  and "delete" buttons in a `--panel` popover; insert is a no-op on map
  edges (map is read-only) and a real edit on workflow edges (A3).

### 3.3 Layout rules

- Main flow: dagre `rankdir: LR`. Entry nodes are rank 0.
- Config sub-nodes: a second dagre run `rankdir: TB` over each parent's
  sub-tree, then the parent's subtree box is pinned 32 px below the parent
  with `parentId` set so React Flow keeps children in the parent's
  coordinate space.
- Group frames get their box from dagre's bounding box of members + 32 px
  padding; label is the frame title.
- Layout runs on the main thread under 30 ms, off-thread in a Worker above
  it, cached per (view, data hash) in memory. Dragged positions persist per
  repo + view in `localStorage` (try/catch) and invalidate on `layoutKey`.

## 4 · Group frames

- A titled frame **behind** members: `--panel` fill at 60 %, 1 px `--line`
  border, radius 8. Title row: 11 px uppercase tracked `--text-3`, 16 px
  padding. Frame header carries the member count and a collapse chevron.
- Collapse → the frame shrinks to a **chip**: one 256 × 48 wide node
  (title + count), members hidden, edges re-anchored to the chip. Expand
  restores members at their cached positions.
- Dragging the frame drags members (React Flow does this natively when
  members are children via `parentId`).
- Selection: clicking the frame selects the frame only; shift-click extends
  to members.

## 5 · Hover toolbar and keyboard

- Hover on a node shows a `NodeToolbar` above it: 24 px-high `--panel`
  strip, 1 px `--line` border, radius 6, buttons 24 × 24 with 16 px glyphs
  and tooltips. Buttons per view: run/open (context), disable (agents),
  pin, expand/collapse (group), delete (editable edges only), more (opens
  the sidebar detail). On touch (≤ 390 px) the toolbar is always visible on
  the selected node instead of hover.
- Keyboard (all on the canvas wrapper's single `tabIndex`): arrows walk
  connected nodes along edges (from handles, not geometry), `Enter` opens
  the detail, `F` fit, `T` tidy, `+`/`-` zoom, `Esc` clear selection,
  `Space`+drag or middle-drag pans, shift+drag marquee-selects,
  wheel zooms. Everything reachable without a mouse.

## 6 · Visual schematics catalogue

The schematics we ship, what each answers, and the exact data fields it
needs (verified against `web/src/views/map/types.ts` and `web/src/api.ts`).
`C` = canvas, `S` = sidebar, `C+S` = both.

| # | schematic | question | data | where |
|---|---|---|---|---|
| 1 | **Layered flow** (entry → orchestrator → core → adapter ranks, utilities/models/config in a lower band, sections as group frames) | "What does this repo do end to end?" | `MapData.blocks` (`Block.role`, `Block.parent`, `Block.kind`, `Block.theme`), `MapData.families` (`Family.blocks`) for edges | C (map default lens) |
| 2 | **Swimlanes by role** (one horizontal lane per entry family / role, lanes ordered by `Family.count`) | "Who owns what, and who is idle?" | `Family.source`, `Family.terminal`, `Family.count`, `Family.blocks`; `Leaf.role` | C (capabilities lens) |
| 3 | **Subway strip** for one chain (horizontal stops, interchange dots at loop nodes) | "What is the path of this execution?" | `Chain.steps`, `Chain.blocks`, `Chain.len`; step names via `MapData.leaves[id].name` | S (chain selection) + C when a chain is focused |
| 4 | **Flow weight as edge stroke** (sankey-like, but as 1–4 px stroke + a sidebar mini bar, never a separate canvas) | "Where does the traffic concentrate?" | `Family.count`, `Edge.weight` (`web/src/api.ts`), `Chain.len` | C (stroke) + S (mini bar) |
| 5 | **Sequence strip** for agent hand-offs (vertical time, member lanes, hand-off arrows) | "Who hands to whom, in what order?" | `Team.members[].reports_to`, `Team.members[].workflow`, `Workflow.steps`, `AgentsInfo.teams`, `AgentsInfo.team` | C (A3 TeamOrg) + S |
| 6 | **Sparkline / bar mini-charts** in the sidebar key/value table | "Is this block busy, cohesive, risky?" | `Block.cohesion`, `Block.files`, `Block.symbols.length`, `Family.count`, `Verify.summary` counts | S only |
| 7 | **Pipeline** for research stages (stages as wide nodes, source/tool sub-nodes below) | "Where is the research loop spending its budget?" | `ResearchRun.experiments` (`Experiment.n`, `Experiment.value`, `Experiment.kept`), `ResearchRun.baseline`, `ResearchRun.best`, `Research metric` | C (A3 ResearchFlow) |
| 8 | **Memory graph** grouped by scope | "What does the team remember, and where?" | `api.memoryLayers()` → `MemoryLayer.scope`, `MemoryLayer.scope_name`, `MemoryLayer.agent`, `Memory.target` | C (A3 MemoryGraph) |
| 9 | **Diff overlay** (added/removed/modified glyphs on nodes) | "What changed since base?" | `GraphDiff.changed/removed/modified` (`DiffNode.status`), `api.compare(base, head)` | C+S (map, compare lens) |

Confirmed picks (manager's call): layered flow = map default; swimlanes =
capabilities lens; subway strip = chain sidebar; sequence strip = A3
hand-offs; sparkline/bar = sidebar table. #4 is edge stroke + mini bar, not
a sankey canvas – the map has ~4 100 functions and ~2 600 chains, too much
for a weighted-band picture. #7–#9 are A3/M2 additions noted here so F1's
node shapes cover them; they need no new API.

Data the canvas must never mount at once: `MapData.leaves` (~4 100). Blocks
first, expand one group at a time, `onlyRenderVisibleElements` on.

## 7 · Sidebar sections per selection type

The right sidebar explains and builds on the selection; nothing selected =
the whole view. Sections, in order, per selection:

| selection | 1 line | key/value table | tinker | related |
|---|---|---|---|---|
| nothing (whole view) | view purpose | `MapData.stats` (`chains`, `exact`, `ms`, `threads`, `embed`); repo counts | lens switch, fit, tidy, reset layout | – |
| block | `Block.summary` (theme if present) | role + rule (`ROLE_RULES[role]`), `files`, `cohesion` (mini bar), `symbols.length`, in/out edge counts, `source` | role filter, hide tests, grouping depth, pin, collapse/expand, re-layout | top chains (`Family` ids), child blocks |
| chain | source → terminal one-liner | `len`, `blocks`, family `count`, `exact` | focus chain (dim others), open steps in CodePanel | subway strip, sibling families |
| family | count one-liner | `min_len` / `max_len`, `exact`, `blocks` | page chains (`mapChains(family, cursor, limit)`) | chain list |
| loop | "cycle condensed" | `members.length`, member names | expand to frame | member blocks |
| leaf (function) | `Leaf.path:line` | kind, role | open in CodePanel | callers/callees (`api.impact`) |
| team | `Team.about` | member count, lead, fences | start/stop (`agentAction("team_start" | "team_stop")`), edit `reports_to`, reorder hand-offs, set workflow (`teams_save`, `team_prompt`) | members, workflows |
| member | role one-liner | `agent`, `model`, `workflow`, `scope`, `reports_to`, `hands_off` | same edit paths as team | hand-off edges, memories |
| workflow | `Workflow.about` | step count, `scope`, `lock`/`hide`/`review`, `memory` | edit steps (`workflows_save`), rename | step nodes, guard rules |
| research stage | metric one-liner | `ResearchRun.metric`, `goal`, `budget`, `baseline`, `best`, `best_commit` | start/stop run (`research_start`/`research_stop`) | experiments table |
| memory | `Memory.target` | `scope`, `scope_name`, `agent`, `stale` | stale/forget (`memory_stale`, `forget`) | memories in same scope |
| guard fence | `GuardRule.reason` | `level`, `paths`, `symbols` | edit via `guards_save` | fenced files |

All edits go through the **existing** `api.agentAction(...)` calls and
endpoints – A3 must not invent new endpoints. Numbers render in two-column
tables (label left, value right), never tiles. At 390 px the sidebar is a
drawer over the canvas with a single scroll context.

## 8 · Tinker controls per view

Shared toolbar (every canvas view, top of the canvas column): view switch ·
search · tidy · fit · zoom %. Left-bottom `Controls`; right-bottom `MiniMap`
(toggleable).

| view | tinker controls (sidebar) | notes |
|---|---|---|
| map · flow | lens switch, role filter (multi-select chips), hide tests, grouping depth (section → block → sub), focus chain, pin node, collapse all / expand one, re-layout, reset layout | collapse depth feeds dagre |
| map · capabilities | lane filter, hide tests, re-layout, reset layout | one lane per entry family |
| map · blocks | (kept `canvas.tsx` view) | out of R1 scope |
| map · chains | (kept lists) | out of R1 scope |
| agents · teams | edit `reports_to` (drag edge), reorder hand-offs, set `workflow`, start/stop team, prompt edit | same API payloads as today |
| agents · workflows | edit `steps`, fences (`lock`/`hide`/`review`), docs, `memory` | `workflows_save` |
| agents · research | start/stop run, budget view | `research_start`/`research_stop` |
| agents · memory | scope filter (task/workflow/repo), stale/forget | `api.memoryLayers()` |
| flow-lab (dev) | node count slider, layout stress, reset | `#flow-lab` route, F1 |

Every tinker control is a labelled control in the sidebar's tinker section,
keyboard-reachable, and its effect is reversible (reset layout, clear
filters). Nothing tinker-level writes without an API round-trip or an
explicit apply.

## 9 · React Flow 12 API notes for F1

Verified against `@xyflow/react@12.12.0` type declarations in a scratch
install (`@xyflow/react@12`, `@dagrejs/dagre` – both MIT, pinned exact).
F1 should use:

- `<ReactFlow nodes edges nodeTypes edgeTypes onNodeClick onNodeDoubleClick fitView minZoom={0.5} maxZoom={2} snapToGrid snapGrid={[16,16]} onlyRenderVisibleElements selectionOnDrag panOnDrag={[1,2]} defaultEdgeOptions={{ type: 'flow-edge' }}>`
- Custom nodes: `nodeTypes={{ tile: TileNode, wide: WideNode, circle: CircleNode, group: GroupNode }}`; each receives `NodeProps<Node>`; `Handle` with `type`/`position`/`id` for the L/R dots and bottom diamonds.
- `NodeToolbar` (`additional-components`): props `nodeId?`, `isVisible?`, `position` (default `Position.Top`), `offset` (default 10), `align`. Use `isVisible` for the touch fallback.
- `useReactFlow()` → `fitView`, `getNodes`, `setNodes`, `screenToFlowPosition` (marquee), `zoomIn`/`zoomOut`. `useOnSelectionChange` to drive the sidebar. `useStore` to read zoom for stroke compensation.
- Sub-flows: `parentId` on child nodes puts them in the parent's coordinate space; give the parent node type `group` and members get dragged with it.
- `Background` `variant={BackgroundVariant.Dots}` with `gap={16}` and `color="var(--line)"`.
- `MiniMap` (192 × 128 via `style`), `Controls` (bottom-left via `Panel position="bottom-left"`).
- `onlyRenderVisibleElements` on `<ReactFlow>` is the viewport culling switch the perf rules lean on.
- Note: React Flow 12 has no built-in smooth-step-with-rounded-corners path for the backward-edge routing – F1 writes a small custom edge path (cubic segments with 8 px corner radii). Also no built-in "+ stub" – render it inside the node when the node has no outgoing main edge.

## 10 · What F1 must not do (risk notes)

- No pan, pinch or zoom on page scroll; the canvas owns its wheel events.
- Do not re-run dagre on drag; drags are user state until tidy.
- Do not animate anything under `prefers-reduced-motion` – edge dashes
  included (CSS and JS must both gate).
- Do not mount `leaves` as nodes; blocks first, expand on demand.
- Do not invent colours: only the tokens in `web/src/styles/tokens.css`.
