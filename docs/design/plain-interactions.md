# Plain interactions – X6 contract for U7 and U8

Wave 2 design-partner spec. X6 is the design partner for the two wave 2
modules: this doc decides the interaction details U7 (journeys + legend) and
U8 (square polish) build against, measured on the fixture before either lands.
X5's plain-map.md stays the vocabulary contract (`x5-*` test ids); this doc
adds the *motion, states and hit* rules on top of it. Cited short:
[ORCH] `refs/ux-map-orchestration.md`, [N8N] `refs/n8n-ui-notes.md`,
[INS] `refs/inspirations/README.md`, [PLAN] `refs/PLAN-fuse2.md`,
D1 = wave 1 design language decision (flat, no hover scale – N8N §4).

Measured on the live fixture (U6 base, merge 819c3a9), 1440×900 dark, fit
view ≈ 47 % zoom, agents layer on/off as noted. Numbers in §1 are the X6
baseline B1–B12 mid-wave measurements U7/U8 must not regress.

## 0. Baseline measured before wave 2 moves (B1–B12)

| # | what | fixture baseline | target | source |
|---|---|---|---|---|
| B1 | crossing edge pairs ÷ pairs | see §1.1 | ≤ 0.05 at rest | canvas-bench.js |
| B2 | edges through a node | see §1.1 | 0 | canvas-bench.js |
| B3 | luminance ladder label > border > edge | see §1.2 | holds, dark+light | canvas-bench.js |
| B4 | median text/node area | see §1.2 | ≥ 0.25, ≤ 0.7 | canvas-bench.js |
| B5 | ports typed/visible | n/a this wave | – | – |
| B6 | overlap / clipped text / sideways scroll | see §1.3 | 0 at 1440/1100/390 | overlap probe |
| B7 | clicks to agent+fence+run | see §1.4 | ≤ 3 / ≤ 2 / 1 | action count |
| B8 | layout stability after reload | see §1.4 | 0 | rect diff |
| B9 | timed lookup, run step → file | see §1.4 | ≤ 2 interactions | scripted path |
| B10 | PREVis 4 dimensions | critic wave 1 | ≥ 5.5 each | critic |
| B11 | non-coder 5-task time | see §1.5 | all correct, median ≤ 30 s | X7 owns final |
| B12 | chrome load on Map @1440 | see §1.6 | ≤ 18 without losing a feature | DOM count |

## 1. Baseline measurements (X6, on the live fixture, before U7/U8 land)

Recorded per probe; raw outputs in `.kula-team/scratch/x6-bench-*.txt`.

- **B12 baseline: 24 interactive controls** visible on the Map at 1440 before
  any click (5 frame buttons + rail add/search/note/panel + layer toggles +
  zoom row + summary counts). Base was ≈ 30; the base's own consolidation
  already got it to 24. U7's Journeys panel must *replace* the old flows
  controls, not add to them; target ≤ 18: fold layer toggles into one
  toggles row and keep the legend as the only new control.
- **B6 overlap probe**: X5's saved runs
  (`.kula-team/scratch/x5-map-{1440,1100,390}.txt`) show 24 hits of
  frame-switch buttons overlapping the canvas at 1100×800 and 32 small
  targets at 390 – pre-existing, still present on the U6 base. U7 (right
  column layout) and U8 (canvas chrome) both re-probe after landing; these
  must reach 0 at 1440/1100/390.
- B1/B2/B3/B4 measured with `web/scripts/canvas-bench.js` on the fixture at
  1440 (numbers in §1.1–§1.2 as run); B7–B9 via scripted Playwright counts
  (§1.4); B11 protocol dry-run recorded (§1.5) for X7.

## 2. Journeys (U7) – decisions beyond X5 §3

X5 fixed the ids and the overlay strip; X6 fixes how it behaves.

1. **The strip is one journey tall.** The overlay strip (bottom of canvas,
   `x5-journey-strip`) shows the picked journey's steps as numbered
   sentences, one row, horizontally scrollable only if steps overflow –
   never a second row. Height ≈ 2 text lines + padding so the map above
   keeps ~85 % of its height at 900 px. [N8N §2] – docked secondary info
   never covers the canvas centre; [ORCH §4] – the terrain stays the main
   object.
2. **Picking a journey is one click on its row** in the right column
   (`x5-journey-row`). Picking again (same row) unpicks and removes the
   strip. Esc also unpicks. The row keeps the hue swatch left, plain title,
   step count right; the picked row is the only one that gets the accent
   orange border (D1: accent = selection only).
3. **Camera walk rhythm:** Next/Prev and ←/→ pan to the *next step's block*
   with a ~240 ms ease; the walk may re-use the base's pan coalescer but
   must not run a second rAF loop [U7 plan risk]. While walking, the picked
   square's wires go to 100 % and everything else dims to ≤ 35 % – same
   state the base already uses for a picked flow, so the strip only adds
   the words, never a new visual state. [ORCH §3 table].
4. **Step source rules (restating X5 §3.3 with the edge cases):** steps come
   from `blocks[id].journeys[]` in flow order; a block with no journey
   sentence contributes its plain name as the step text; a flow whose
   blocks have neither shows the technical names as last fallback and the
   step is still numbered. Never render an empty strip: a flow with 0
   visible steps is not pickable (row disabled, title dimmed).
5. **Phone (≤ 720 px):** the strip becomes a bottom sheet above the summary
   bar with the same test ids; the camera walk still works (the sheet never
   covers the strip target squares – the walk centres them in the visible
   area above the sheet). [ORCH §10 responsive: content order, not a second
   layout.]
6. **Keyboard scope:** ←/→ are captured only while a journey is picked and
   the focus is not in an input; otherwise they fall through to the base's
   map keys. This is U7's plan risk 2, resolved: scope on picked-journey,
   not on canvas hover.

## 3. Legend (U7) – decisions beyond X5 §2

1. **Position: top of the right column**, above the view buttons – a key
   explains everything below it; reading order is key → views. [INS
   kuhn-cartographic] – legends lead the reading, they are never an
   afterthought at the bottom.
2. **Collapsed default is open on first visit** (X5 §2) – X6 adds: the open
   state persists per session (`sessionStorage`), the collapsed row is a
   single 24 px-high "Key" button, and the open panel is ≤ 200 px tall so
   the view buttons stay reachable without scrolling at 900 px.
3. **Rows are samples, not sentences.** Each of the five rows shows the real
   artefact it explains: a 12 px hue swatch pair (two directory hues), a
   small/large square pair (size), the actual glyphs RS/TS/PY, a 1 px ring
   arc, a dashed 1px square. Words only as the after-label ("– the area of
   the product"). A legend that must be read twice fails its job [N8N §5
   progressive disclosure: show the thing, not the description of the thing].
4. **Swatches come from `colors.ts`** (import `dirColor`/`groupDirs` – U7
   plan, never copy); the two hue swatches in the colour row are the two
   largest directory groups on the current map, so the legend is true for
   *this* map, not for a hypothetical one.

## 4. Squares, polished (U8) – decisions beyond the brief

1. **Open/fold animation ≤ 160 ms, ease-out, transform+opacity only.**
   Children fade+rise in (translateY 4 px → 0, opacity 0 → 1) staggered
   ≤ 40 ms per rank, capped at 160 ms total – the stagger must fit inside
   the budget, not extend it. Fold is the reverse, no stagger. Reduced
   motion kills it entirely (per-file guard like `flow.css:234`, not the
   global switch). [INS tufte-meyer] – animation carries the fold direction,
   so the reader keeps their place; anything slower reads as lag [N8N §3:
   interaction feedback ≤ 200 ms].
2. **Frame header = breadcrumb + fold, one line, inside the frame's top
   edge.** Breadcrumb of the open path (`src · views · map` style, hue of
   the top block), fold button at the right end. Max height 22 px; the
   breadcrumb ellipsises from the *middle* (keep both ends) because the
   top directory and the opened leaf are what the reader navigates by.
   Test id `u8-frame-header` for the probe; no x5 id needed.
3. **Camera keeps the opened square under the pointer:** after open, pan
   ≤ 160 ms so the opened square's centre stays within 15 % of where the
   pointer was. Same coalescer rule as the journey walk (one rAF, no
   second loop). If the opened frame is larger than the viewport, anchor
   top-left of the frame instead of its centre.
4. **3-step size scale in `measure`:** section squares land on S/M/L by
   symbol count with breaks at the 40th and 75th percentile of the *visible*
   node set (recomputed per layout, stable per layout key so B8 stays 0).
   Sizes must remain ordered and the ratios S:M:L stay ≥ 1 : 1.25 : 1.6 so
   "more code = bigger" is readable at fit [ORCH §4 size encodes amount].
   The opened frame's children do not re-scale mid-animation.
5. **Caption collision rule:** captions are part of the node's box in
   `measure` (U8 owns it) so the overlap probe sees them; two captions that
   would overlap swap to horizontal truncation before vertical shrink, and
   never rotate. Probe must be clean at 1440/1100/390 [B6 target].
6. **Hover = wires, nothing else.** Hover lifts the square's wires to
   100 % and dims all others to 15 %; the square itself gets no scale, no
   shadow, no glow (D1) – only its 1 px border brightens one step. [N8N §4
   hover toolbars; D1 line decision]. This is U8's stated plan, restated as
   the contract: **the hover state is a stroke-width/opacity change on
   edges plus a border colour step on the node.**
7. **"+" affordance and child count at far zoom:** at fit (≤ 50 % zoom) the
   caption shows `+ n` after the plain name when the square has unopened
   children (n = child count); the "+" is the affordance, it does not
   appear on a square whose children are open. Above 50 % zoom the "+"
   fades out (it is noise when the frame header is readable).
8. **Re-shoot visual baselines once at the end** – after all wave 2 changes,
   not per commit, so baselines track the wave, not the noise.

## 5. What X6 does not decide

Journey step copy (U9's reading layer feeds it), legend typography beyond
the row grammar, wire routing (the kit's gutter router stays off), the B10
PREVis protocol (critic) and B11 final protocol (X7).

## 6. Test-id additions by X6

Only two, both probes, both owned by X6 and wired into
`web/e2e/interaction.spec.ts` (new, X6-owned, written alongside this doc):

- `x6-canvas-strip` – asserts the strip does not cover the canvas centre
  (strip bottom edge ≤ 82 % of canvas height at 900 px).
- `x6-frame-header` – asserts the breadcrumb shows the open path's
  top + leaf directory names.

Everything else keeps X5's ids exactly.
