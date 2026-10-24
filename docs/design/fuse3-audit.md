# Fuse 3 – consistency and overlap audit (X8, wave 1)

Every view (Map, Graph, Flows, Changes, History, Branches, Issues, Notes,
Agents, Settings, code panel) walked at 1440×900, 1100×720 and 390×844, dark
and light. Findings carry the owning module and are enforced as failing tests
in `web/e2e/overlap.spec.ts` and `web/e2e/overflow.spec.ts` until the owner
fixes them. X9 re-runs this audit after wave 2 and signs off.

## Findings

| # | Finding | Where | Owner | Test |
|---|---|---|---|---|
| 1 | `sb-help` buttons ("panel", "? shortcuts") collide with in-page `btn sm` buttons ("Still true" memory confirm, "team") at 1440 and 390 | `App.tsx:308-309` vs `views/agents/Memory.tsx:82`, `Overview.tsx:170` | U13 | `overlap.spec.ts › x8/U13` |
| 2 | Map legend (`div.graph-overlay.legend`) overflows its box (pinned by content) | `views/map/legend.tsx` | U11 | `overflow.spec.ts › x8/U11` (passes on base after the probe fix – kept as regression guard) |
| 3 | Map colour key and "Map in plain words" dock render over block squares | `views/map/legend.tsx`, `views/map/plain.tsx` | U11 | `overlap.spec.ts › x8/U11` |
| 4 | Transport `.tp` vs zoom row collision risk on map phone (390) | `views/MapView.tsx` transport rows | U11 | `overlap.spec.ts › x8/U11 transport` (passes on base – kept as regression guard) |
| 5 | Undefined tokens `--bg-3` / `--shadow` referenced but never defined | `settings.css:3`, `dock.css:14,16,37`, `workspace.css`, `graph.css:27` | U10 | lint note (no runtime overlap) – fixed on U10's branch (25c1581) |
| 6 | `sb-help` vs in-page buttons on #agents at 390 – same root cause as 1 | `App.tsx:308-309` | U13 | covered by finding 1 |
| 7 | Workspace + inspector at 1100: `span "Explore"` × `span.fm-headline-v` headline collision | `views/map/chrome.tsx`, `views/MapView.tsx` headline | U11 | `overlap.spec.ts › no text overlap at 1100px` (fixed on U11's branch: icon-only Explore ≤1280) |

## Pane wiring (U10 scope, checked)

Every popable surface was walked for `data-pane` + `PaneControls` (`.pane-ctl`)
+ a `Grip` (`.grip`):

| Surface | data-pane | PaneControls | Grip |
|---|---|---|---|
| Help sheet (`App.tsx:427`) | yes | yes | n/a (centred dialog) |
| Settings dialog (`SettingsPanel.tsx:298`) | yes | yes | yes |
| Code panel (`CodePanel.tsx:198`) | yes | yes | yes |
| Contrast panel (`Contrast.tsx:311`) | yes | yes | yes |
| Graph inspector (`GraphView.tsx:944`) | yes | yes | yes |
| Map inspector (`MapView.tsx:784`) | yes | yes | yes |
| Block palette `np` (`pipeline.tsx:386`) | yes | yes | yes |
| Step details `ndv` (`pipeline.tsx:550`) | yes | yes | yes |
| Dock (`Dock.tsx:29`) | by design own controls (max + close, `dock-max`), grip present | own, same icon order | yes |

No laggards found in wave 1. Re-check after U12 lands: panels opened by deep
links (`#map/<block>` drill, inspector tabs) must keep the chrome.

## Method

- Probes: `node .kula-team/tools/probe.mjs` per view per viewport (dark),
  outputs in `.kula-team/scratch/x8-probe-*.txt`.
- Sweep: `node .kula-team/scratch/x8-sweep.mjs` – all views × {1440, 1100,
  390} × {dark, light}, text-run overlap + clipped-text + overflow checks.
- Pane audit: static walk of `data-pane` usage plus runtime
  `.kula-team/scratch/x8-pane-audit.mjs`.

## Sign-off

Signed off by X9 after wave 2 lands (before/after table at 1440 and 390 to be
appended there).

# Final record (X9, wave 2)

X9 re-ran the audit after wave 2 (U12 agents outside the boxes, U13 toggles
and lists, U14 notes in the editor) at 1440×900, 1100×720 and 390×844, dark
and light, across every view in `nav.ts` (overview, graph, map, changes,
history, branches, proposals, issues, notes, flows, agents, query) – 72
probes per tree via `node .kula-team/scratch/x9-sweep.mjs`.

## Before/after table

Findings from X8's wave-1 audit plus X9's own baseline sweep (before =
wave-1 integration tree d39e25c, after = the wave-2 merge tree):

| # | Finding | Owner | Before (wave 1) | After (wave 2) | Proof |
|---|---|---|---|---|---|
| 1 | `sb-help` × in-page `btn sm` on #agents, 1440 + 390 | U13 | OVERLAP (probe: 12 hits) | (pending) | sweep `agents 1440/390` |
| 2 | Map legend overflows its box | U11 | fixed on U11 branch; guard test passes | (pending) | `overflow.spec › legend` |
| 3 | Colour key / plain-words dock over squares | U11 | fixed (chips, 0 square hits) | (pending) | `overlap.spec › x8/U11` |
| 4 | Transport vs zoom row on map phone | U11 | guard test passes | (pending) | `overlap.spec › transport` |
| 5 | 1100px Explore × headline | U11 | fixed (icon-only ≤1280) | (pending) | `overlap.spec › 1100` |
| 6 | `--bg-3` / `--shadow` undefined tokens | U10 | fixed (25c1581) | (pending) | grep |
| 7 | Panes: data-pane + PaneControls + Grip everywhere | U10 | all 9 wired | (pending) | `u10-panels.spec` |
| 8 | Agent square vs zone frames/labels/squares | U12 | present on base | (pending) | `u12-agents.spec` |
| 9 | Small-target drift at 390: `u2-frame` 36×32, `u7-legend-head` 34×40, `u9-chip`/`ex-btn` 34×30, `strip-menu-btn` 250×30 (map) / 50×28 (graph), `legend-head` 262×27 (graph) | U11/U13 | FOUND by X9 baseline | (pending) | sweep `x9-sweep-out.txt` |

## Design-lint

(pending)

## Sign-off

(pending)
