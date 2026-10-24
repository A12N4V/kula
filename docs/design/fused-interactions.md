# Fused interactions – exact specs for U2 and U3 (wave 2)

X3, wave 2. Companion to the X1 contract (`docs/design/fused-canvas.md`,
settled input – this wave's tree carries it, verified on `team/fuse` HEAD
`3779d4a`). Where the contract fixes *what exists*, this document fixes *how
it behaves*: control states, the keyboard map, empty/error/loading copy, the
phone variants, and the shared B7 scripted path. Evidence is cited as
(refs: section) – `n8n` = n8n-ui-notes.md, `ux` = ux-map-orchestration.md,
`PLAN` = PLAN-fuse.md, `contract` = fused-canvas.md.

Standing decisions this doc assumes (plan §Wave 2): zoom thresholds
far < 0.55 / near ≥ 1.0 (contract §6, U1 adopted); actor band TOP 144px
(contract §1); teams are hulls, not lanes; autonomy defaults by role
(contract §5); keys 1/2/3 reserved for the U4 ask gate.

## 1. Decisions X3 owes from wave 1 (recorded here so X2 signs off against them)

- **Lint waiver 1 – `.fc-agent-in { border-radius: 20px }`: APPROVED.**
  n8n §2 uses a 224×96 "configurable" node whose width/height ratio forces a
  radius away from the default tile radius so the labelled bottom ports read
  as one row. U1's agent node is the same kind (wide, typed bottom ports
  Model/Tools/Fence/Memory). The radius is anatomy, not decoration; it stays.
- **Lint waiver 2 – `.fc-port-label` pill: APPROVED as a pill.** n8n §3 puts
  12px grey labels at typed ports on a near-black canvas; on kula's canvas a
  bare 10px mono string sits inside the edge-dash zone and fails B6 contrast
  against passing edges. The pill (fill = node fill, 1px `--line` border)
  gives the label a local background at the same luminance as the node – no
  new colour, no glow, one rule for all labelled ports.
- **Scheme toggle removal: RATIFIED.** U1 deleted the Role/Section/Heat/Quiet
  colour cycle; nodes are neutral grey with colour reserved for state and the
  one accent (n8n §6: "No per-category node colour"). The capabilities the
  old schemes approximated all have better homes now: Role is a per-node
  glyph + word on the mid card (contract §2) and the Roles filter stays on
  the canvas HUD; Heat/last-run state is the Runs layer + last-run dots;
  Quiet-focus is the flow/chain focus mode (contract §4). Nothing is lost;
  do not rebuild it as a scheme. If a lens-like need reappears, it must come
  through the board as a layer, never as a colour scheme.
- **Roles button reachability (`map-hud-side`):** the dock-left-of-inspector
  fix is accepted as the interaction (the button must never be covered by the
  inspector); U2's right rail must be built so the rail and the docked
  Roles button never overlap – see §2.1 (verified live at 1100 before U2
  builds the rail: probe `x3-probe-map-1440.txt`, roles reachable, no
  overlap reported by the probe at 1440; 1100 re-checked each U2 review).

## 2. Control states (rest · hover · active/on · disabled · loading)

All controls use the shared primitives (`styles/system.css`): selection is a
fill, hover is a border shift, never a transform; `--dur 0.12s`; one orange
accent. `aria-pressed` is the state contract – tests read it, not classes.

### 2.1 Right rail (U2) – vertical, right edge, 48px wide, buttons 44×44

| control | rest | hover | active/on | disabled | loading |
|---|---|---|---|---|---|
| `map-rail-add` (+) | `--line` border, `--text-2` glyph | border `--text`, glyph `--text` | opens inspector add form (momentary – never stays on) | never disabled | – |
| `map-rail-search` | same as add | same | fill `--sel-bg`, border `--sel-line`, search input shown beneath | never | spinner replaces glyph while `/api/search` is in flight |
| `map-rail-note` | same as add | same | toggles note-sticky mode: cursor becomes a crosshair, next canvas click places a sticky | same as rest + border `--accent` while armed | – |
| `map-rail-panel` | same as add | same | fill `--sel-bg` while the inspector is open; reflects state, also closes it | never | – |

The rail occupies a reserved 48px column on the right of the canvas – cards
must never render under it (wave-1 debt: the zoom bar overlapped cards; the
same reserved-space rule applies here). The docked Roles button
(`map-hud-side`) sits left of the inspector when the inspector is open; the
rail is further right, outside it. Order left→right: canvas · roles-dock ·
inspector · rail.

### 2.2 Zoom bar (U2) – bottom-left, one row: Fit · In · Out · Tidy · Minimap

| control | rest | hover | active/on | disabled | loading |
|---|---|---|---|---|---|
| Fit | 32px square, `--line` border | border `--text` | momentary (fits, never stays on) | never | – |
| In / Out | same | same | momentary | at the zoom limit (`disabled` + 40% opacity), i.e. Out at fit-min, In at near-max | – |
| Tidy | same | same | momentary; animates the re-layout (`--dur 0.12s` per step, never instant); then **Undo** appears in its place for one step (contract: Tidy explicit and undoable) | when the layout is unmodified since last Tidy | – |
| Minimap | same | same | toggles the minimap; `aria-pressed=true` + fill `--sel-bg` when shown | never | – |

Reserved space: the bar sits in a 56px-tall strip that is part of the canvas
padding, not floating over it (wave-1 debt). Nothing interactive renders in
that strip except the bar.

### 2.3 Layer toggle (U2) – `map-layers`, one compact control, six chips

Chips: Blocks · Flows · Chains · Fences · Agents · Runs (contract §5).
Rest = chip with `--line` border; on = fill `--sel-bg` + `aria-pressed=true`;
hover = border `--text`. Disabled never occurs; a layer that has nothing to
show (e.g. no fences yet) still toggles and shows the empty-state copy of
§5. Defaults Blocks + Agents + Runs on; Flows and Chains off until picked
from a list; Fences auto-on when an agent is selected (standing decision) –
the auto-on is visible: the chip lights the moment the selection lands.

### 2.4 Map · Runs · Evals segmented control (U2) – `workspace-modes`, centred top

Segment = the system `.seg` pattern; active segment is a fill
(`aria-pressed=true`), hover on inactive is a border shift. Loading: switching
to Runs or Evals shows the existing skeleton (`skel` keyframe) inside the
segment's own area – never a full-canvas loader. Map is default.

### 2.5 Node hover toolbar (U1/U3, extended) – `node-toolbar`, floats above the node

States per verb: rest `--text-2`, hover `--text` + border, active pressed
fill. Verb-specific:

- `Run` (`fn-run-<id>`) while a run is in flight on that node: label becomes
  **Stop**, gets `.on` + `aria-pressed=true`, and the last-run dot pulses
  (`fc-pulse`). It never disables – a run in flight is stoppable.
- `Open code` / `Pin` unchanged from U1 (`fn-open-<id>`, `fn-pin-<id>` with
  `.on` while pinned).
- `More` opens the full verb list (contract §5) as a menu above the toolbar;
  `Escape` closes, focus returns to the node.
- The toolbar must not appear while the inspector covers the node's top edge;
  it flips below the node instead (same rule as n8n §4).

### 2.6 Fence-dim mode (U3)

Three states, all on the map canvas, all tied to a selected agent:

1. **Selected, not editing:** fence hull drawn (`fence-hull`, dashed
   `5px 6px` `--accent` at rest luminance per contract §4 dash rule);
   non-fenced blocks opacity ≤ 0.35, fenced blocks 1.0 (B target, test 5).
2. **Edit on canvas (armed):** same hull + non-fenced blocks remain clickable
   and get a hover hint (border `--text`); clicking a block toggles it
   in/out of the fence; the hull redraws immediately (animated width/height,
   `--dur 0.12s`); the inspector's fence list updates live (ux §6.3). An
   "editing" chip with **Done** sits on the hull.
3. **Multi-select (⇧click, fence editing only):** block borders `--accent`
   on each selected block; the hull wraps the union preview. Escape cancels
   the multi-select first, then the selection.

### 2.7 Inspector (U3) – tabs Setup · Script · Runs · Memory (ux §6.6)

Tab states follow the segmented pattern. Per tab: fields render before any
raw view (ux §6.2 "structured first, raw second"); the raw-file toggle is
two-way and persists per agent; switching tabs never re-fetches unless the
tab's data is stale (poll-refresh 5s as today). Save is explicit; a dirty
field shows a dot on the tab; leaving with unsaved changes asks (inline, not
a modal): "Discard changes?" · Keep editing · Discard.

## 3. Keyboard map

One map, all surfaces, same names as the palette. Keys 1/2/3 are **reserved**
for the U4 ask gate (ux §8) – nothing else may bind them, at any focus.

| key | action | owner |
|---|---|---|
| `f` | Fit | U2 |
| `+` / `−` (and `=`) | Zoom in / out | U2 |
| `t` | Tidy (then `u` = undo) | U2 |
| `/` | Focus search input (rail) | U2 |
| `l` | Toggle the layers popover | U2 |
| `m` | Toggle minimap | U2 |
| `e` | Edit fence on canvas (agent selected) | U3 |
| `n` | Add note (armed mode, §2.1) | U2 |
| `Escape` | Close menu/multi-select/selection, in that order | U2/U3 |
| `1/2/3` | **Reserved – ask gate (U4). Do not spend.** | – |
| `⌘K` | Palette (existing, `ui.spec.ts` N1 reachability holds) | shell |

Existing G1/N1 patterns in `ui.spec.ts` continue to hold: roster keyboard
navigation, palette reachability of every view, visible focus (one global
focus rule, `system.css:8–49`). Every focusable new control must be reachable
by tab and show the focus style – the probe's `--focus` mode checks this.

## 4. Empty, error and loading copy

Exact strings; en dashes; every empty state teaches (n8n §8.5, contract §7).
Buttons/links in brackets are actions inside the state, not separate chrome.

| surface | empty | error | loading |
|---|---|---|---|
| Empty Workspace (no blocks) | Tile, centred: **"Start from a template"** – "Pick a pipeline template or add your first agent." [Browse templates] [Add agent] (ties to contract §7, U4 template tile in wave 3/4) | n/a (nothing to fail) | skeleton while `/api/map` is in flight |
| Search with no hits (U2) | In the search popover: **"No matches for "query""** – "Search names, roles and file paths." [Search code instead] | server error: "Search failed – the index is unreachable." [Retry] | spinner on the rail glyph (§2.1) |
| Search pans to nothing (hit off-canvas) | The camera fits the nearest cluster and a transient toast (3s): **"Match is outside this view – showing nearby."** | – | – |
| Flow/chain focus with no path (U2/U3) | Inline banner above the canvas: **"No path found between these blocks."** – "They are not connected. [Clear focus]" | – | – |
| Agent with no fence (U3) | The Fence port shows its "+" stub (contract §3) and the Setup tab shows: **"No fence yet – this agent can read anything."** [Draw fence on canvas] [Add blocks by list] | – | – |
| Missing Model (agent, required) | Red mark on the node (contract §3) + inspector opens on Setup with the field focused: **"Model is required before this agent can run."** | – | – |
| Layer toggled off with hidden content (U2) | Toast once per layer (3s): **"Blocks hidden – toggle them back in Layers."** (never navigates) | – | – |
| Runs tab, no runs (U2) | **"No runs yet."** – "Run an agent from its hover toolbar or the transport." [Run last agent] | fetch error: "Run history is unavailable." [Retry] | skeleton rows |
| Evals tab, no gates (U2) | **"No gate results yet."** – "Gates appear here after their first run." | fetch error: same pattern | skeleton rows |
| Inspector, agent deleted elsewhere | **"This agent no longer exists."** [Close inspector] | – | – |
| Ask gate (U4, wave 3 – spec fixed now) | – | prompt: "**<agent> wants to <action> <target>.** Allow once · Allow for run · Deny · keys 1/2/3" | – |

## 5. Phone variants (390×844) – spec now, built by U5 in wave 4

The phone is a **viewer and supervisor, not a builder** (ux §10). U2/U3 must
build desktop structure that these rules can restyle without rework:

- **Rail → bottom bar.** The four rail buttons become a fixed bottom bar
  (height 56px, above the dock) with the same four actions, 44×44 targets.
  Search opens as a full-width sheet; note-add is hidden on phone (building)
  – the bar shows Fit · Search · Layers · Panel.
- **Zoom bar → pinch + fit.** Pinch zooms, two-finger pan; the bar reduces to
  Fit + Minimap as a floating pair bottom-right, 44px each, inside the
  reserved strip (still never overlapping cards).
- **Layer toggle → sheet.** The six-chip toggle opens as a full-width sheet
  from the bottom bar's Layers button; state identical (`aria-pressed`).
- **Inspector → bottom sheet.** Selecting a node opens the inspector as a
  bottom sheet (half-height, drag handle, full-height on pull); tabs
  Setup · Script · Runs · Memory scroll horizontally, 44px targets (ux §10,
  PLAN warns "phone targets below 44px in the dense inspector" – this is the
  rule that prevents it).
- **Fence editing on phone = list, not canvas** (ux §10): the Setup tab's
  fence section becomes a searchable list of blocks with toggles ("Add
  blocks by list", §4). Canvas click-editing is desktop-only.
- **Ask gate on phone:** a sheet above the dock (still keys 1/2/3 when a
  keyboard exists; buttons 44px).
- Everything interactive ≥ 44×44 on phone (PLAN B-rules). Desktop targets
  stay as §2 (44px rail, 32px zoom bar with ≥ 24px hit area per contract §3).

## 6. Wave-1 debt specs (U2/U3 build items from board 21:02)

1. **Landing framing (U2):** on first open, land centred on the **busiest
   section** (most blocks under fit) with ≥ 24px margin on all sides at the
   *readable* zoom (U1's landing zoom, not the 10% union-fit the lead
   reverted). The zoom bar and rail live in reserved strips (§2.1, §2.2) and
   must report zero overlaps in the probe. Test: overlap probe + a new
   framing test (§8) asserting the busiest section's cards are fully inside
   the viewport with margin on first load.
2. **Mid-stage card sizing (U3):** at mid zoom a block card's body is sized
   to its content: role glyph + word, files/symbols counts, in/out, flow
   badges, fence badge, last-run dot (contract §6). Minimum card 176px wide;
   if the content is one meta line, the card is 96px (the tile) + caption –
   a 176px card with an empty body is a defect. B4 target ≥ 0.25.
3. **Resize neighbour rule (U3):** resizing a card must never overlap the
   neighbour below: the resize stops at the neighbour's top edge (clamp) –
   chosen over reflow, because reflow moves persisted positions and risks
   B8. If the clamp would make the card smaller than its minimum (96px), the
   resize is refused and the handle does not move. Test asserts
   `card.bottom <= neighbour.top` after any resize.
4. **Function-list dedupe (U3):** duplicate function names collapse to one
   row with a ×N count chip ("begin ×8"), sorted by count then degree,
   keeping the N-by-height rule (contract §6). If the API sends duplicates,
   that is a backend request – U3 asks via `ask-backend.sh`; the UI dedupes
   regardless (it must never show the same name twice).

## 7. B7 – the one scripted path (both modules build to this)

Scripted, timed, in `fused.spec.ts` when both halves land. Fixture: the
agents fixture server (`fixture.sh`), `#map`, 1440×900.

1. Rail `+` → add form → create agent **"reviewer-2"** (1st of ≤ 3 clicks
   for the add phase: rail, form focus counts as typing, create = 1 more).
2. Drag block **"session.rs"** onto the agent → fence membership (≤ 2
   actions: drag = 1, confirm if any = 1).
3. Click `Run` on the agent's hover toolbar (exactly 1).
Target: ≤ 3 / ≤ 2 / 1. U2 owns step 1 (rail + form); U3 owns steps 2–3 (drag,
hull, run wiring). Test id: `b7 scripted path`. Counted actions, not
fixtures: assert by name.

## 8. Test plan (which fused.spec.ts tests un-fixme when)

X1's 11 `test.fixme` map to owners: tests 1–4, 10 → U1 (landed wave 1 –
un-fixme **now** if the live run proves them); 5 → U3 (fence dim); 6, 7, 8,
9 → U2 (rail, layers, search, B8); 11 → U4 (wave 3). New tests X3 adds as
behaviour lands: the B7 scripted path (§7), landing framing + resize clamp +
dedupe (§6), keyboard map (§3), and copy states (§4, one representative
assertion each). Discipline: a test goes real only when the behaviour exists
in the live UI on this branch – verified by probing before un-fixme.

## 9. Amendment log

- 2026-10-21 (X3): lint waivers approved, scheme-toggle removal ratified,
  roles-dock interaction accepted, B7 path fixed, phone rules set. No
  amendments to the contract numbers; thresholds cited as-is from
  fused-canvas.md §6.
