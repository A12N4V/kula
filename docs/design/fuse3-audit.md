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
| 2 | Map legend (`div.graph-overlay.legend`) overflows its box (pinned by content) | `views/map/legend.tsx` | U11 | `overflow.spec.ts › x8/U11` |
| 3 | Map colour key and "Map in plain words" dock render over block squares | `views/map/legend.tsx`, `views/map/plain.tsx` | U11 | `overlap.spec.ts › x8/U11` |
| 4 | Transport `.tp` vs zoom row collision risk on map phone (390) | `views/MapView.tsx` transport rows | U11 | `overlap.spec.ts › x8/U11 transport` |
| 5 | Undefined tokens `--bg-3` / `--shadow` referenced but never defined | `settings.css:3`, `dock.css:14,16,37`, `workspace.css`, `graph.css:27` | U10 | lint note (no runtime overlap) |
| 6 | `sb-help` vs in-page buttons on #agents at 390 – same root cause as 1 | `App.tsx:308-309` | U13 | covered by finding 1 |

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
