# Map view – the design contract

The Map view (`#map`) shows the codebase as a map anyone reads in five seconds:
domains as districts, flows as routes, stations as symbols, code one peek away.
Three drawings compete on one shared model, shared overlays and a shared
inspector; the owner A/B tests them by hand.

## Units, top down

**domain** (a district: a group of flows, labelled in plain words from the API)
→ **flow** (one entry point and the ordered chain it runs) → **station** (a
symbol on a flow) → **code** (peek). Folders and files appear only in the
inspector and on hover.

## The model (`model.ts`)

Built from `GET /api/flowmap` and `GET /api/graph` into
`MapModel { domains, flows, stations, interchanges }`:

- Stations are deduplicated by symbol id across flows; a station exists once no
  matter how many flows call it or how often.
- `degree` = number of distinct flows through the station. `degree ≥ 2` makes it
  an interchange; `interchanges` is sorted busiest first, id as tiebreak.
- Each step keeps call order (`order`), `depth`, the `branch` flag from the
  backend (`if` · `loop` · `match` · `try`) and a `layer`.
- Domain size = number of distinct files. `/api/graph` node counts can refine
  this later (`fileSize` helper is here for wave 2).
- Flow labels are verb–object: `Serve <route>` for routed flows, else the entry
  name in plain words (`foo_bar` → `Foo bar`).

### Layer heuristic

| layer   | when |
|---------|------|
| `test`  | the flow is a test: `kind === "test"` or the entry sits on a test path (`tests/`, `*.test.*`, `*_test.*`, …) |
| `entry` | depth 0 – the flow's own entry point, wherever it lives |
| `io`    | step path under `store/` or `server/`, or the name serves, writes, reads, fetches, saves, loads, inserts, sends or listens |
| `handler` | depth 1 – a direct callee of an entry |
| `data`  | the name mentions store, query, db, repo or persist |
| `logic` | everything else |

Precedence is top to bottom: a test flow is one `test` layer; the entry always
stays `entry`; a depth-1 callee that does io is `io`, otherwise `handler`.

## The shell (`Map.tsx`)

Header: variant toggle **A · B · C**, **Compare**, the four overlay toggles
(**Fences · Live · Churn · Owners**), find on map (⌘K, capture phase so the
global palette does not take it on the map), **Test** (the drawer).

Variants plug in through one interface:

```ts
type Variant = {
  id;                                    // "a" | "b" | "c"
  draw(ctx, model, view, overlays, sel); // canvas 2D
  hit(x, y, view): Pick | null;          // must match the drawn geometry
  fit(pick, view, set);                  // fly to a pick
};
```

`view` is the transform `{ w, h, scale, ox, oy }`: world → screen is
`(x·scale + ox, y·scale + oy)`. The stub variant (districts grid, flow rows of
station dots) fills the slot until wave 2; wave 2 replaces it per variant
folder. Layouts are deterministic: seeded by ids, never `Math.random`.

`window.__kulaMap = { build, model, layout }` is exposed for tests and probes.

## URL state

`#map/<variant>/<pick>` with pick `s/<symbol id>` · `f/<flow id>` · `d/<domain
id>`, and `#map/test` for the drawer. The last variant is in the URL, so a
reload keeps it.

## Overlays (`overlays.ts`)

Per-station numbers, so every variant just reads them:

- **Fences** – lock/review guard rules matched by symbol name or path.
- **Live** – heat = Σ e^(−Δt / 60 s) over recent `useEvents` events, per station
  file, window capped at 10 minutes. Drawn as a soft ring, never a CSS glow.
- **Churn** – per-path churn counts from `/api/graph` (`graph.churn`).
- **Owners** – the first seat whose scope covers the station's file.

## Inspector and find

Click any domain, flow or station → the shared inspector (`Inspector.tsx`):
what it is, the plain sentence, layer, branch, overlays, flows through, an
ordered step list, and a short code excerpt of the station's file. Hover gives
a one-line card. ⌘K find flies to a symbol, flow or district and updates the
URL pick.

## A/B harness (`ab.ts`, `Test.tsx`)

Six tasks generated deterministically from the repo's own flowmap, so it works
on any repo: (1) entry that serves route X, (2) flows through symbol Y, (3) the
busiest interchange, (4) a fenced station, (5) what domain Z does, (6) where a
live agent works – seeded from a recorded fixture when nothing is live. The
variant order is counterbalanced once per session (`sessionOrder`). Each task:
timer, answer by clicking the thing on the map, then ratings 1–5 for clarity,
speed and look, and a free note. Results live in `localStorage`
(`kula.map.ab`); **Copy results** gives JSON; a summary table shows median time
and mean ratings per variant.

## House style

Absolute black canvas, warm lines, cream ink, one orange accent for selected
and live. No glass, no blur, radii 8/6/4. Toggles over tabs. Hover is a quiet
background/border shift – never shadow, glow or scale. Canvas colours are hex
twins of the `--map-*` tokens (canvas cannot read `var()`); `map.css` uses the
tokens directly.
