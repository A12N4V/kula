# Fuse 5 · X14 – UX finishing and release readiness

Wave 3, last. What changed, what was removed, the sign-off table and the
known gaps. Written by X14.

## The map gets one settings popover

`views/map/chrome.tsx` gained `MapSettings` (`export type MapSettingsState`,
`DEFAULT_MAP_SETTINGS`): a gear beside the Explorer in the map's top strip
(`map-settings-btn` → `map-settings-sheet`). It holds everything the map used
to scatter:

- **Layers** – the six-layer `LayerBar` moved here from the Explorer sheet
  (the sheet's Layers section is gone; `layers={null}` there).
- **Colour scheme** – role / section / heat / mono (`map-scheme-*`).
- **Edge density** – few / normal / full (`map-edges-*`): the value-flow
  edges are filtered by weight (top 25 % / 50 % / all) before the kit draws
  them, so the control is real, not cosmetic.
- **Card labels** – few / normal / many (`map-labels-*`): how many function
  names a block card draws (`FN_CAPS` in `flowKit.tsx`).
- **Canvas** – minimap and snap-to-grid, now controlled from the popover and
  threaded `FlowKitView → FlowCanvas` (`minimap`, `snap` props; the canvas's
  own minimap button only renders when nobody controls it).
- **Layout** – Tidy, Undo tidy, Reset layout (drops every persisted drag for
  the current key) and Clear pin.

Everything is remembered: `kula.map.settings` joins `kula.map.layers` and
`kula.map.scheme` in localStorage. The Explorer sheet keeps search, panels
and the add verbs only.

## Space audit – what was removed, and what it saved

| Removal | Where | Saved |
|---|---|---|
| The "Agents" title band in the sub-nav (merged into the tab row; the page head already names the tab) | `Agents.tsx` | 44 px vertical, every width; on a phone one of the three stacked header bands is gone (≈ 60 px of the 200 px the brief counted) |
| The 180–260 px text column – the sub-nav is a 56 px icon rail at every width (the container-query icon mode already existed; the default width now uses it) | `Agents.tsx` + `listWidth("agents", 56)` | ≈ 204 px horizontal at 1440, ≈ 330 px at 390 |
| The Layers section in the Explorer sheet (moved to the settings popover) | `map/chrome.tsx` | ≈ 200 px of sheet height |
| The `100vmax` scrim shadow on a maximised pane (design rule: no decorative shadow; the paint is not free either) | `settings.css` | paint cost, no visual loss |
| The "? shortcuts" statusbar button on a phone (keyboard-only affordance sitting under the agent grid) | `agents.css` | 28 px statusbar row that the agent grid scrolled under |

Checked and kept: the Map·Runs·Evals frames (each has content), the transport
row (run/dry-run/step are all live), the agent Overview roster (it is the
workflows page's content, not a duplicate).

## Agents sub-nav

Thin icon tab bar at every width. The icons keep `aria-label` and `title`
hints; labels exist in the DOM but are clipped by the container query below
84 px, so a widened rail (drag the grip) brings text back. Open Workspace
rides in the tab row as the last icon. On a phone the strip is horizontal
with a 40 px touch floor.

## Deep links

`parseHash` aliases `#workspace → #map` (as `syntagm`/`fmap` already were), so
a deep link keeps its target through the splash instead of landing on the
overview. Proven by `x14-finishing.spec.ts`.

## Light theme AA

- `--lt-text-3`: `#938c81` → `#6a6258` (4.9:1 on the light ground, 5.4:1 on
  panels – the brief's ≈ `#6f685e` target cleared with margin).
- Accent used as text: every `color: var(--accent)` in the styles now reads
  `var(--accent-text)` – `var(--accent)` in dark, `#a83a00` (5.2:1) in light.
  Fills keep the brighter accent.

## Settings

- Theme is a three-way **Light / Dark / System** segment (`theme-seg`,
  `theme-light|dark|system`) instead of an unlabelled sun/moon glyph that
  guessed the OS state. The old `theme-toggle`/`theme-system` testids are
  updated in `x12-menu.spec.ts`.
- Every settings row puts its control on the same side (right) – the old
  `:not(.toggle)` rule stacked plain rows' controls under the label.
- At ≤ 600 px the settings window is a full-height sheet
  (`calc(100dvh - 56px)`) and row subtitles wrap instead of cutting mid-word.
- Mount cost measured: keyboard `,` → window mounted in 72 ms, content
  painted in 83 ms at 1440 (Playwright, this build). The > 1 s report from
  the wave-2 walk did not reproduce here; the maximised-pane shadow removal
  also takes the heaviest paint out of the dialog's reach.

## Map viewport

The flow canvas persists its viewport per layout key
(`kula.flow.vp.v1.<ns>.<key>`, written on `onMoveEnd`) and restores it on
mount, so returning to the map keeps the zoom and pan the user left instead
of drilling into the landing zoom again. A tidy or layout change still
re-fits (the key changes).

## Small fixes

- `.view-loading` gets 48 px padding – a lone "loading…" line never hugs a
  corner.
- Rail tooltips hold off for 350 ms after a click, so no stale tooltip rides
  into the new view (`.rail.tip-hold`).
- The map's transport is a docked bar, not an overlay: the canvas ends above
  it (`.ws-drop` bottom padding), which cleared all six probe overlaps of the
  transport buttons and the Map·Runs·Evals frames on the flow canvas at 1440
  and 390.
- Phone touch targets on the map HUD (Explorer, settings, frames, legend,
  plain-words chip, tidy) meet the 40 px floor.

## Sign-off table

| Check | 1440 dark | 1440 light | 1100 | 390 dark | 390 light |
|---|---|---|---|---|---|
| Map | 0 problems (was 7) | walked, no drift | walked | 0 overlaps; only HUD small-target warnings, fixed | walked |
| Agents | 0 problems | walked | walked | 0 problems (was 4) | walked |
| Settings window | 83 ms to paint | light aliases verified | – | full-height sheet | – |
| Theme segment | all three states write `data-theme` | same | – | same | – |
| e2e | `x14-finishing` 11/11 | – | – | `x12-menu`, `x13-windows`, `u18/u19/u17`, ui/overflow/design green | – |

Light-mode walks were done by emulating `prefers-color-scheme: light` with
`data-theme` unset; the contrast proof is an automated assertion in the spec.

## Known gaps

- The probe's "neutral grey rgb(187,187,187)" note on the map at 390 comes
  from the React Flow dots background (`--line`), not a token drift; the dots
  read warm in dark and light. Left as is.
- The maximised-pane scrim (the old 100vmax shadow) is now a plain surface –
  maximised windows no longer dim the ground behind them. That is the flatter
  reading of the design system, but it is a change worth a look at acceptance.
- `overflow.spec`/`design.spec` baselines are regenerated only after every
  other spec was green, per plan (see the shots run at the end of the branch).
- Edge density filters `data.flows` when the payload carries them; a map
  payload without `flows` leaves the control at its default effect (no
  edges to filter), which is honest but invisible.
