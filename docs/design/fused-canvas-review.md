# The fused canvas – review and re-decide (wave 3)

X2, 2026-10-22. Re-probe of the built UI (branch `team/fuse`, HEAD `d3bc728`,
waves 1–2 merged) against `docs/design/fused-canvas.md` (X1 contract) and
`docs/design/fused-interactions.md` (X3 specs), at 1440×900, 1100×900 and
390×844, dark and light. Raw probes: `.kula-team/scratch/x2-probe-map-*.txt`
(six files). Server: `serve.sh` on port 7850. This document ranks the
findings, answers every U push-back, and states what U4 must fix.

## Method

`node .kula-team/tools/probe.mjs --hash map --viewport WxH` per viewport and
theme (light via a settings-seeded variant, `scratch/probe-light.mjs`). Each
probe reports visible text, controls, hover/focus, colours, problems and
console. Overlap findings below are the probe's text-collision set, filtered
for intent: docked chrome riding above the canvas is by design (U2 gate fix
"docked chrome"); text colliding with text is not.

## Ranked findings

### Blocking

None. The wave-1 blockers (suite red, ladder assertion, Roles unreachable)
are closed by the gate-fix commits (`2c5328d`, `5978522`) and verified by the
probes: console clean at every viewport and theme, no text–text collisions.

### Major (U4 scope)

1. **The run transport floats over the canvas** – MapView.tsx:831–835 renders
   `Run / Pause / Step / Rerun / Stop` (`tp-btn`) as an overlay that pairs
   with `div.fc-canvas` in the overlap probe at 1440, 1100 and 390, dark and
   light (identical at all six). X1 contract §8.11 and X3 §2 put the ask gate
   docked above the transport; the transport itself must be docked chrome
   (opaque panel on a warm line) the way the zoom bar now is
   (`workspace.css`, U2's pattern). Until then every probe flags two
   overlaps. **Owner: U4**, which owns the transport for run supervision.
2. **The "executes …" crumb renders on landing** – flowKit.tsx:454
   (`fm-headline` → "executes" + path) shows on `#map` before any chain
   focus. Test 10 in fused.spec dodges it only because the DOM string is
   lowercase under a `text-transform: uppercase`. **Decision (re-decide):**
   the crumb belongs to chain focus only; landing shows the repo/section
   framing instead. U4 restyles or removes it; fused.spec test 10 asserts
   case-insensitively once landed.
3. **The "+" port stub is a 16×16 target** – nodes.tsx:76 (`fc-stub-btn`)
   renders a 16px button; contract §3 requires ≥24px hit targets at default
   zoom. The probe flags it at every viewport. **Owner: U4/U1** – enlarge the
   hit area without growing the glyph (padding + hit-path pattern already in
   the kit).

### Minor

4. **Phone target sizes** – at 390 the layer buttons are 28px tall
   (workspace.css:461), the rail buttons 36×36 (workspace.css:423) and the
   tidy button 28px, all under the 44px phone minimum from
   fused-interactions §5. Interactions doc assigns phone to U5; recorded
   here so U5 inherits the measured list, not a re-probe. The `Back` ×
   `Evals` collision at 390 belongs to the same pass.
5. **Eleven elements sample a neutral grey `rgb(187,187,187)`** – the probe's
   palette check (warm palette, `--text-3` is warm) fires on 11 elements at
   every viewport. They are unthemed kit defaults (React Flow's own handles /
   edge ends), not kula tokens. Cosmetic; U4/U5 sweep with the tokens.
6. **Layer bar and rail ride the canvas** – every overlap between
   `u2-layer*` / `u2-rail-btn` / `u2-tidy-btn` and `fc-canvas` is intentional
   docked chrome (opaque panels, no text under text). Not a defect; listed so
   the overlap probe can whitelist docked chrome instead of re-flagging it.

## Light theme

No light-specific defects found: the six probes produce byte-identical
problem sets (same 15 at desktop, same 34 at 390). Tokens re-alias cleanly
(tokens.css:61–73). Verified, not assumed – this was X3's open question.

## Answers to U push-backs

- **U1, scheme-toggle removal – signed off.** n8n §6 (grey nodes, colour is
  state + accent) wins; the lost schemes' capabilities have better homes
  (roles → `map-hud`/`map-hud-side`, pin → node toolbar + inspector, tidy →
  `u2-tidy` with undo, heat/quiet → nothing that survived contact with the
  ladder). Do not rebuild them. This ratifies X3 §1 retroactively and is
  final.
- **U1, lint waivers (`.fc-agent-in` radius 20, `.fc-port-label` pill) –
  signed off** (X3 approved them in fused-interactions §1; confirmed here:
  radius 20 is the squircle anatomy, the pill keeps 10px port labels
  legible). Report-mode stays; no restyle.
- **U1, semantic-zoom thresholds** – reconciled: the tree ships far < 0.55 /
  near ≥ 1.0 (FlowCanvas.tsx:454), matching the contract and the board
  decision (18:10). u1.spec drives zoom, not constants, so no test churn.
  Closed.
- **U1, Run on the block hover toolbar** – landed (`fn-run-<id>` per the
  18:34 board note); U4 inherits its in-flight Run→Stop state (X3 §2).
  Closed.
- **U2, add-form testids** – re-decide: the shipped ids win. fused.spec
  un-fixme uses `ag-add-form` / `ag-add-create` inside `map-inspector` (the
  ids u2.spec/u3.spec already prove); the contract's `add-form` alias is
  dropped, not built. Recorded as a contract amendment, not U4 work.
- **U2, Fences auto-on when an agent is selected** – the merged MapView
  turns Chains/Fences on with selection (u3.spec proves hull + dim on
  selection). Accepted as-is; no follow-up left.
- **U2, tidy snapshots via a U1 hook instead of the localStorage mirror** –
  agreed in principle, rejected for wave 3: the mirror works and is proven
  (u2.spec tidy test); a hook would touch flow/* under U4's feet. Re-file
  against U5 if it ever bites.
- **U3, drag-block-onto-agent needs `onNodeDragStop` in FlowCanvas** – the
  synthetic ITEM_DRAG drop path is what u3.spec proves and what the B7 test
  uses; the physical gesture stays a U4/U1 nicety, not a wave-3 blocker.
- **U3, emit `data-kind` on nodes** – rejected: fused.spec now selects real
  DOM (`.fc-node`, `at-agent-*`, `fence-hull`), same as u3.spec. Adding
  attributes for tests only is backwards.
- **X3, missing-model tooltip copy** – align to fused-interactions §4
  ("Model is required before this agent can run."); currently
  actors.tsx:65 says "No model connected – open Setup to set one". U4 copy
  pass item.
- **X3, test 5 hull+dim on selection** – landed; un-fixed in fused.spec
  against `fc-node` opacities (this wave).

## Contract amendments (X2 re-decides)

1. Add-form testids: `ag-add-form` / `ag-add-create` (see U2 answer).
2. fused.spec selectors are the real DOM: `.fc-node` / `[data-testid^=fc-node-]`
   for canvas nodes, `at-agent-<name>` for actors, `fence-hull` for hulls.
   `canvas-node` / `data-kind` are removed from the spec, not built.
3. Test 10 asserts `executes` case-insensitively and stays fixme until the
   crumb leaves landing (U4).
4. Keys 1/2/3 remain reserved for U4's ask gate; nothing may bind them.

## What U4 must fix (hand-off list)

1. Dock the run transport as opaque chrome (MapView.tsx:831–835 + its
   container) – clears 2 overlaps × 6 probes.
2. Remove or restyle the landing "executes" crumb (flowKit.tsx:454); then
   un-fixme fused.spec test 10's case-insensitive assertion.
3. ≥24px hit target on the port "+" stub (nodes.tsx:76).
4. Ask gate docked above the transport, Allow once / Allow for run / Deny,
   keys 1/2/3, not a modal – fused.spec test 16 (still fixme) is its
   acceptance test.
5. B1/B2 stay over target (X3 mid-wave: 0.366 / 58) – the crossing test
   (fused.spec test 4, fixme) un-fixmes when the engine lands section
   columns; that is engine + U4 joint work, not UI-only.
6. Copy: missing-model tooltip (actors.tsx:65).
7. B7's run step: once the transport is docked and the gate exists, un-fixme
   fused.spec test 11 (b7 scripted path).

## Benchmarks (unchanged owners; X2 moved none)

|  | B1 | B2 | B3 | B4 | B5 | B6 | B7 | B8 | B9 | B10 |
|---|---|---|---|---|---|---|---|---|---|---|
| wave-2 exit | 0.366 | 58 | broken (label < border) | 0.08 | 176 × 10.2px | – | – | – | – | – |
| X2 re-probe | same (no engine/UI changes this wave) | | | | | overlap set above | – | – | – | – |

B3/B5 are U1-owned and still over target on the live tree (X3 21:26 board
note); test 1 and test 2 in fused.spec therefore stay fixme until U1's fix,
not because the tests are wrong.
