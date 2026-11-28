# Map view – the design contract

The Map view (`#map`) shows the codebase as a map anyone reads in five seconds:
domains as districts, flows as routes, stations as symbols, code one peek away.
Two variants compete on one shared model, shared overlays and a shared
inspector; the owner A/B tests them by hand.

## Units, top down

**domain** (a district: a group of flows, labelled in plain words from the API)
→ **flow** (one entry point and the ordered chain it runs) → **station** (a
symbol on a flow) → **code** (peek). Folders and files appear only in the
inspector and on hover.

## Variants and URLs

Two variants only:

- **Atlas** – a district map: domains as regions, flows as routes over them.
- **Metro** – a transit map: flows as lines, stations as stops.

The header toggle reads `Atlas · Metro`, Atlas first. URLs:

- `#map/atlas` · `#map/metro` – one variant.
- `#map/<variant>/<pick>` with pick `s/<id>` · `f/<id>` · `d/<id>`.
- Legacy `#map/a` and `#map/c` redirect to `#map/atlas`; `#map/b` to
  `#map/metro`. The redirect happens in the view on mount.
- A bare `#map` or `#map/test` shows the last variant the visitor chose
  (remembered in `localStorage` under `kula.map.variant`).

Compare splits the canvas `Atlas | Metro`, one pane per variant, sharing one
selection. The test drawer counterbalances the two: half the sessions start
with Atlas, half with Metro (a durable session counter in
`localStorage` `kula.map.ab.sessions`, order remembered per session).

## Header and canvas

One row at 1440 and at 1024: title, variant toggle, Compare, overlays, search.
Below 1200 px of viewport the four overlay toggles collapse into a single
`Overlays` menu so the row survives 1024. The canvas fills every pixel between
the header and the app status bar; a resize redraws in place without a reload.

## The model (`model.ts`)

Built from `GET /api/flowmap` and `GET /api/graph` into
`MapModel { domains, flows, stations, interchanges, containers }`:

- Stations are deduplicated by symbol id across flows; a station exists once no
  matter how many flows pass it.
- **Domains are recomputed on the client.** Rule: each flow joins the most
  frequent module among its steps, skipping the entry step and any step under
  `src/server` or `src/cmd`; module = path without extension, `mod.rs` → its
  folder (`src/index/mod.rs` → `src/index`). A domain left with a single flow
  merges into its nearest neighbour – the domain sharing the most stations
  with it. Labels are plain words (`src/guard.rs` → `Guard`,
  `src/index/mod.rs` → `Index`, `web/src/views/hub` → `Hub view`). On kula no
  domain holds more than 35% of flows; the spec asserts it.
- **Containment** comes from `/api/graph`'s `parent`: a node that some node
  names as parent becomes a `MapContainer { id, kind: class|interface|function,
  name, path, line, end, parent?, members }`. `MapStation.container?` points at
  it. Members include the container's other methods that are not on any flow
  (`onFlow: false`) so a class rectangle shows the whole class. Function
  containers get their variables lazily from N1 through `loadInner(ids)` in
  `model.ts`, cached per data version (stub until N1 lands).

## Test hooks

`window.__kulaMap` exposes `{ build, model, layout, layoutB, layouts: { atlas,
metro }, view, view2, variant, other, varA, varB, hooks }`; variant test hooks
live at `__kulaMap.hooks.atlas` and `__kulaMap.hooks.metro`. Old `#map/a`
`#map/b` `#map/c` URLs work through the redirect and never render a legacy id.

## Proof

`web/e2e/map-m0.spec.ts`: both URLs render; old URLs redirect; the header is
one row at 1440 and 1024; the canvas bottom equals the status bar top; the
largest domain share is under 35%; `from_json` attaches to `McpDef` as a
container member.
