# The fused canvas – contract for the UI builders (U1–U5)

X1, wave 1. This document settles the open questions in
`refs/ux-map-orchestration.md` §12 and fixes the numbers U1–U5 build against.
Evidence is cited per decision as (refs: section) – `n8n` = n8n-ui-notes.md,
`ux` = ux-map-orchestration.md, `PLAN` = PLAN-fuse.md, `paper` = inspirations.

## 0. Baseline (measured this session, 2026-10-21, `canvas-bench.js`)

Repo Workspace `#map`, dark, after load, default zoom:

| viewport | nodes | edges | B1 crossings (ratio) | B2 through-node | B3 ladder | B4 text density | B5 ports |
|---|---|---|---|---|---|---|---|
| 1440×900 | 8 | 24 | 140 (0.507) | 11 | broken (edge 0.44×0.55 > border 0.015) | 0.045 | 16 × 5.1px, untyped |
| 1100×800 | 6 | 22 | 107 (0.463) | 9 | broken | 0.048 | 12 × 5.1px |
| 390×844  | 4 | 22 | 107 (0.463) | 5 | broken | 0.045 | 8 × 5.1px |

Matches PLAN §0's numbers (B1 0.45→0.51, B2 4→11 at the wider viewport count).
Targets stay as PLAN §1: B1 ≤ 0.05, B2 = 0, B3 holds, B4 ≥ 0.25, B5 12–16px
typed. Raw output: `.kula-team/scratch/bench-baseline.json`.

## 1. Actor band: top, measured (ux §4, §12)

P1.3 asked for both placements measured on the fixture. Layout simulated from
the real `/api/map` data (194 blocks → 10 section columns by dependency layer,
blocks stacked per section) with one agent per of 4 sections, dashed reach
edges routed orthogonally. Script: `.kula-team/scratch/band_ab.py`.

| viewport | top band: reach×data / reach×reach | left band: reach×data / reach×reach |
|---|---|---|
| 1440 | 67 / 0 | 54 / 87 |
| 1100 | 90 / 0 | 84 / 102 |

**Decision: the actor band sits on top.** Total crossings 67 vs 141 (1440) and
90 vs 186 (1100). A top band keeps the axis rule perfect (n8n §3): capability
edges drop vertically, data edges run horizontally, so reach edges never cross
each other; a left band's horizontal reach runs cross other agents' drops.
This also matches ux §4's own reasoning (roughly-vertical reach edges) and
frees the right side for the inspector. Band height: one row of actors,
144px tall (actor card 128 + 16 gutter), full canvas width; it scrolls
horizontally if actors exceed the width, it never wraps (a second row would
make reach edges cross again).

## 2. Node kinds, shapes, sizes, icons (n8n §2, ux §3, §9)

Seven kinds. Shape carries kind; colour is state + the one accent only (n8n
§6). Sizes at far zoom; mid/near keep the footprint and grow the card body
under the same border.

| kind | shape | size (far) | radius | icon | notes |
|---|---|---|---|---|---|
| section | sticky frame behind its blocks | wraps content + 24px pad | 4px | sectionLogo (icons.tsx) | heading + one-line purpose, `--line` fill, z under nodes (n8n §5) |
| block | square tile | 96×96 | `--radius` 8px | kind glyph (colors.ts) / lang glyph | caption under at far; card at mid/near |
| agent | circle-ish (squircle) | 96×96 | 48px | harmonograph mark (harmonograph.tsx) | typed ports on bottom edge |
| team | hull around agents | wraps | 12px | team glyph + harmonograph | section-like hull, not a lane (plan §Resolved 2) |
| gate | diamond | 112×96 | none (rotated square) | shield | pass/fail labelled ports, right and bottom |
| trigger | rounded leading edge | 96×96 | `36px 8px 8px 36px` | stopwatch/play | entry of a pipeline; small accent tick left of it (n8n §2) |
| note | sticky call-out | 200×140 | 4px | doc | accent-tinted only for warnings; default neutral (n8n §5) |

Fill `--bg`-raised grey (n8n: node fill on near-black canvas), border 1.5px
solid `--text-3` at 55% alpha; selected = full-strength border + fill shift
(kula rule: selection is a fill). One icon per node, centred, ~40px (n8n §2).

## 3. Ports (n8n §3, PLAN B5)

- Every node: visible 14px circular ports (12–16px range), fill = node fill,
  1px `--text-3` border, inputs left, main outputs right, `data-testid=
  "port-<kind>"`.
- Agent nodes: four typed ports on the bottom edge, each with a 12px label –
  **Model** (required, `*`), **Tools**, **Fence**, **Memory**. Blocks connect
  to **Fence** and **Tools** from below; Model/Memory take sub-nodes (n8n §3).
- Gate nodes: outputs labelled **pass** (right) and **fail** (bottom); the
  label sits at the port, not on the node face.
- Unconnected output shows a **"+" stub** (70×26 hit area) that opens the R1
  inspector add form (ux §6; acceptance 6).
- Required-but-missing input renders a small red mark on the node (n8n §8.3).
- Hit target ≥ 24px at default zoom even though the visible dot is 14px.

## 4. Edges (n8n §4, ux §9, PLAN P3)

- Ladder: label (brightest) > node border > resting edge > grid. Resting edge
  `--text-3`-level grey, 1.5–2px, opacity 1, solid; effective luminance below
  border luminance in dark **and** light (B3; computed-style test).
- Dashed `5px 6px`, same grey: agent→block reach, block→fence membership.
  Only the dash differs – never colour (n8n §4).
- Aggregated block-pair edges: one edge per block pair, width 1–3px by call
  weight, count shown on hover; symbol-level edges only inside a focused or
  resized block (ux §4).
- Routing: orthogonal with rounded corners, edges layer under nodes, never
  through a node (B2 = 0); loops go around, under the node (n8n §4).
- Hit path 40px wide, invisible. Hover: edge brightens to ≥ border luminance
  and shows a midpoint toolbar (**+** insert gate here · remove · make
  conditional) (ux §5).
- Focus mode (flow, chain, agent reach): focused path at `--text`, everything
  else ≤ 25% opacity; crossings on the focused path = 0 (ux §2.1, Ware).

## 5. Layers, defaults, operators (ux §5, §12)

Layers (one compact toggle, no sub-tabs – acceptance 1):
**Blocks · Flows · Chains · Fences · Agents · Runs.**
Defaults: Blocks + Agents + Runs on; Flows and Chains off until picked from a
list; Fences on when an agent is selected. Turning a layer off hides its
marks and never navigates.

**Decision on §12 "merge chains and flows":** keep both as layer concepts but
one mental model, **"paths"** – the picker offers *Show flows through…* and
*Focus chain…* with the same visual treatment (lit path, rest dimmed). They
differ only in scope: flows = named data paths, chains = the full dependency
walk. Users see one thing: a highlighted path.

**Decision on §12 "autonomy default per role":** by role, not per agent:
read-only roles (reviewer, explorer, docs) default **Auto**; roles that write
code default **Ask on risky**; anything with a gate-fail trigger defaults
**Ask**. "Risky" = writes outside the fence, deletes, network access,
dependency changes (ux §6.5).

Verb list – exact names, identical in hover toolbar, right-click menu and ⌘K
palette (ux §5; checklist "every verb I added has the same name…"):

- On blocks: `Open code` · `Pin` / `Unpin` · `Group into section` · `Show
  flows through` · `Focus chain` · `Assign to agent` · `Exclude from fence` ·
  `Add gate after` · `Watch` · `Compare with last run`.
- On agents/teams: `Run` · `Run on selection` · `Dry-run` · `Pause` · `Step` ·
  `Stop` · `Edit script` · `Set model` · `Set autonomy` · `Duplicate` · `Add
  to team` · `Show memory` · `Show last run`.
- On edges: `Insert gate here` · `Remove` · `Make conditional`.
- On the canvas: `Add agent` · `Add team` · `Add gate` · `Add note` ·
  `Search` · `Fit` · `Tidy` · `Minimap` · `Toggle layers`.
- Hover toolbar above a node: `Run` · `Open code` · `Pin` · `More` (More opens
  the full list). Nothing on the node face (n8n §4).

## 6. Semantic-zoom thresholds (ux §4, §12; PLAN P1.5)

Measured, not guessed. Thresholds are on the **rendered scale** of a block
tile (96px source size), transitions apply per node, not per canvas:

| level | condition | shows |
|---|---|---|
| far | scale < 0.55 | tile + icon + caption under (name, 13px min) |
| mid | 0.55 ≤ scale < 1.0, or card height < 220px | card: role glyph + word, files count, symbols count, in/out, flow badges, fence badge, last-run dot |
| near | scale ≥ 1.0 or node resized (corner handle) | card + function list (top N by degree), owners, recent commits, agents that may touch it |

- The far→mid threshold is the zoom at which a 13px caption would render
  below 11px (0.55 × 13 ≈ 7.2px is unreadable, so captions switch to in-card
  text at scale 0.55 where 13px renders ≥ 11px readable size after grid
  snapping – measured against the baseline bench at 1440 and 1100).
- The mid→near threshold is **card height, not a constant** (ux §12): N
  function names fit while `N × 22px ≤ cardBodyHeight − 64px` chrome; at the
  default 220px body that is N = 7. Below 220px body the list is dropped even
  at near scale (B4 stays in the 0.25–0.7 band).
- Resize (corner handle) forces the node to near regardless of scale (ux §4).
- Captions reserve layout space (node height + 2 caption lines ≈ +44px) – the
  overlap probe enforces this (n8n §5).

## 7. Failure and empty states (n8n §8.5)

- Every empty state teaches: an empty Workspace shows one "Start from a
  template" tile; an agent with no fence shows the fence port with a "+"
  stub; a gate with no fail branch shows the fail port unconnected with a
  hint label.
- Missing required input (agent with no Model): red mark on the node + the
  inspector Setup tab opens with that field focused.

## 8. Acceptance tests this contract implies (in `web/e2e/fused.spec.ts`)

All `test.fixme` until the owning U module lands the behaviour; X2 un-fixmes
them in wave 3. Assert by name, never by fixture counts.

1. B3 ladder holds at 1440 in dark and light (label > border > resting edge,
   effective luminance) – U1.
2. Port count and size per kind; agent ports typed Model/Tools/Fence/Memory,
   gate ports pass/fail – U1.
3. Semantic zoom: at default zoom every block shows name + role + counts;
   resizing shows the function list – U1.
4. B1 ≤ 0.05 and B2 = 0 on the Workspace at 1440 and 1100 – engine + U1.
5. Agent selection draws the fence hull and dims non-fenced blocks ≤ 0.35 –
   U3.
6. Add flow: rail "+" and output-port "+" open the R1 inspector form; no
   global Add block button – U2.
7. Layer toggle present with the six layers, Blocks/Agents/Runs default on;
   centred Map · Runs · Evals segmented control – U2.
8. Search moves the camera and never re-lays-out – U2.
9. B8: reload with no code change moves nodes 0px – U2 (engine persist).
10. Hover toolbar verbs exist with the exact names of §5; the leftover
    "re-layout · pin · roles · Role" row and "EXECUTES" crumb are gone – U1.
11. Ask gate is docked above the transport with Allow once · Allow for run ·
    Deny and keys 1/2/3; not a modal – U4.
12. Overlap probe clean at 1440/1100/390 including the new crossing count –
    U5.
