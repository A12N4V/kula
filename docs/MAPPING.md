# Mapping – the codebase as a flowchart anyone can read

Objective: **anyone opens the map and knows exactly what the code does.**

The map is a flowchart of what the program *achieves*, not of its files:

    entry points → flows → sections → functions

- **Entry point** – a symbol nothing in the repo calls that calls into the repo
  (main, route handlers, CLI commands, exported API surfaces). The engine
  already classifies these as the `entry` role (`map.rs::classify_role`).
- **Flow** – a chain of functions that together deliver one outcome, named as a
  value proposition: "Decode a pedigree file", "Verify an agent's edits".
  Flows are first-class top-level entities; sections are derived by grouping
  each flow's members, not the other way round.
- **Section** – the implementing module region (the existing `Block` at
  depth 0), shown as the map's middle layer.
- **Function** – the leaf, reachable on demand in the inspector.

Files and folders are an implementation detail, shown only in the inspector.

## Edges

Two kinds, drawn differently:

- **calls** – the call graph edge, already in the store;
- **data hand-offs** – a chain hands data to the next stage: entry → flow →
  section edges in the payload are hand-offs, function→function edges inside a
  flow are calls.

## Benchmark (`kula map --bench`)

Three gold repos, each with hand-written expected flows:

1. **kula itself** – the working repository.
2. **homonin-scripts** – copied to `/tmp` at bench time; source looked up from
   `KULA_BENCH_HOMONIN`, falling back to `~/Desktop/projects/homonin/homonin-scripts`.
3. **miniserde** – vendored MIT fixture under `bench/mapping/gold/miniserde/`
   (recorded commit in `bench/mapping/gold/MANIFEST.toml`), staged into a
   scratch git repo in `/tmp` at bench time.

Each gold set is a TOML file: per flow, the expected `name`, `outcome`,
`members` (qualified names, `path::fn`, tail-matched) and `keywords` for the
name rubric. Gold members are hand-written from the repo's README outcomes
(what the program achieves) and the source files that implement them – full
member lists, no cap – and then checked for producibility against engine
output (`KULA_BENCH_DEBUG=1 kula map --bench`), never copied from it.

### Metrics (printed as JSON by `kula map --bench`)

- **flow recall / precision** – a produced flow matches a gold flow when the
  Jaccard similarity of their member sets is ≥ 0.6. Recall = matched gold /
  all gold; precision = matched produced / all produced. Members are compared
  as qualified names, tail-matched (the last `path::fn` component) so
  repo-root-relative path drift does not punish a correct match.
- **name quality** – rubric score + keyword overlap (see below), averaged over
  produced flow names that matched a gold flow.
- **section purity** – for each gold flow, the share of its members that fall
  inside the single block holding the most of them, averaged over gold flows.
  1.0 = every flow lives cleanly inside one section.
- **edge crossings after layout** – block-pair flow edges drawn in the
  deterministic baseline order (blocks sorted by id); crossings counted
  pairwise. Lower is better; the layout work (wave 3) reduces this number.
- **build time / memory** – wall ms and peak RSS of the full map build per
  repo.

The bench is offline: no network in the bench path. Output is byte-stable
across runs – sort everything, no wall-clock in fields other than the timing
fields, and hash-free names only.

## Name-quality rubric

A good flow name:

1. **Verb–object** – starts with a verb ("Decode", "Verify", "Index").
2. **≤ 12 words.**
3. **No code identifiers** – no snake_case, no `::`, no raw function names.
4. **Names an outcome** – what the user gets, not what the code does
   internally ("Index the repository", not "index_repo chain").

Scored 0–1: 0.25 per satisfied clause, plus keyword overlap with the gold
flow's `keywords` list scaled to the remaining 0.25 (clamped). The keyword
list is the rubric made concrete per repo: the domain words a correct name
should contain.

## Baseline and wave-2 hook

In wave 1 the bench evaluates the engine's current output shape: chain
families become candidate flows (members = the union of their chains' steps,
baseline names from source/terminal identifiers). Wave 2 (`src/map/flows.rs`)
replaces that adapter with real extracted and named flows; every number then
improves against the same gold, which is the point of benchmark-first.
