# Shell and module registry

The shell is the frame every view lives in: an icon rail, a collapsible list
pane, a centre slot and reserved right and bottom slots. Views never know
about the shell; the shell knows views only through `web/src/shell/registry.ts`.
Later modules code against this contract, not against `App.tsx`.

## Files

- `web/src/shell/registry.ts` – the single list of everything the shell hosts.
- `web/src/shell/Shell.tsx` – the layout root: slots, tiers, splitters, toggles.
- `web/src/shell/Rail.tsx` – the icon rail and the collapsible list pane.
- `web/src/shell/tiers.ts` / `useTier.ts` – `large | mid | mobile` (1100 / 700 px).

## Module contract

```ts
import type { Module } from "./shell/registry";

const myModule: Module = {
  id: "flows",              // nav View; also the hash root (#flows/…)
  label: "Map",             // list pane, palette, help sheet
  icon: Icon.map,           // () => ReactElement from ui.tsx
  slot: "centre",           // "centre" | "right" | "bottom" | "widget"
  group: "map",             // rail section – one rail icon per group
  key: "3",                 // optional ⌘-key (1–9, 0, a, q, c)
  lazy: () => import("../views/MapView"),
};
```

- `id` is a `View` from `nav.ts` and is stable – it is the URL hash root and
  the e2e selector root (`rail-item-<id>`).
- `slot` decides where the shell renders the component. Wave 1 registers
  every view `centre`; `right`, `bottom` and `widget` are reserved for later
  waves and the shape will not change.
- `group` is one of `overview | map | code | connectors | agents`; the rail
  shows one icon per group and clicking it opens the group's home view.
- `key` powers the ⌘-number shortcuts, the help sheet and the list pane kbd.
  Keys are unique across modules.
- `family` (optional) names the component bundle a view renders inside when
  several views share one component – `code` for the Code workbench tabs
  (graph, changes, history, branches, query, console), `agents` for the
  AgentsCanvas views (agents, proposals, issues, notes). It defaults to the
  module id. The centre slot renders `CENTRE[family ?? id]` (see App.tsx), so
  a new module that reuses a family needs only its registry line; a new
  family adds one entry to the `CENTRE` map in App.tsx.
- `lazy` is the only place a view chunk is imported; the shell prefetches all
  of them on idle (`prefetchModules()`), so no view file may be imported
  eagerly elsewhere.

Helpers exported from `registry.ts`:

| export | use |
|---|---|
| `MODULES` | every module, in rail order |
| `VIEWS` | `MODULES.map(m => m.id)` |
| `GROUPS` | rail groups in rail order (`id`, `label`, `icon`, `key?`) |
| `moduleOf(v)` | the `Module` for a view |
| `groupHome(g)` | the view a rail icon opens |
| `prefetchModules()` | warm every lazy chunk once |

## Shell contract

```tsx
<Shell
  rail={<Rail view={view} onGo={go} open={open} toggles={toggles} />}
  centre={<MapView … />}
  right={<Inspector … />}   // optional; reserved
  bottom={<Terminal … />}   // optional; reserved
  status={<footer>…</footer>}
/>
```

- Shell computes its own tier with `useTier()` and puts it on the root as
  `data-tier` (`large` ≥ 1100 px, `mid` ≥ 700 px, `mobile` below).
  - `large` – rail + list pane, centre, right, bottom.
  - `mid` – rail only (list pane hidden), centre; right/bottom stack below.
  - `mobile` – rail becomes a horizontal dock at the bottom; centre fills.
- Pane sizes persist through the shared `resize.tsx` store (`kula.sizes.v1`,
  `--size-<id>` CSS vars on `<html>`), via `Grip`. The list pane uses id
  `raillist` (min 180, max 480, default 240); a double-click resets.
- Pane toggles: one `aria-pressed` button per pane the current tier actually
  draws, `data-testid="pane-<id>"`. Shell owns them; Rail only renders the
  `toggles` node it is handed.
- Slots are empty-safe: passing nothing renders nothing, no placeholder.

## Rail contract

```tsx
<Rail view={view} onGo={go} open={open} toggles={<PaneToggles … />} />
```

- One button per `GROUPS` entry: `data-testid="rail-group-<id>"`,
  `aria-label` and `data-tip` carry the label, `aria-current` marks the
  active view's group.
- The list pane (large tier, when `open`) lists every module under its group
  heading: `data-testid="rail-item-<id>"`, module icon + label + `key` kbd.
- Navigation never changes the hash directly – it calls `onGo(view)`, which
  is the app's `Go`, so deep links and history stay in one place.

## What App.tsx keeps

Routing and app state stay in `App.tsx`: `parseHash`, `Go`, the 5 s poll,
`serverError` surfaces, the Opening, the palette, help, settings, keyboard
handling. The keyboard handler, palette and help sheet read the registry, so
a new module shows up everywhere with one registry entry. The old top navbar
is gone; the rail replaces it.
