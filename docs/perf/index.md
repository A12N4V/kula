# `kula index` performance

Measured on this repo (848 files, 308 parsed, 3278 symbols, 11148 edges), release build,
`CARGO_TARGET_DIR=~/projects/kula-team/target-be cargo build --release`, macOS, shared machine (load ~6–8).

Cold: `rm -f .kula/graph.db .kula/parse-cache-v2.json .kula/map-embed-hash-v1.bin && /usr/bin/time -l target/release/kula index`
Warm: the same command again with nothing changed.

| run  | metric        | before  | after  |
|------|---------------|---------|--------|
| cold | wall          | 6.5–7.2 s | 1.9–2.6 s |
| cold | sys           | 4.3 s   | 0.27 s |
| cold | instructions  | 52.7 G  | 22.7 G |
| cold | peak RSS      | 290–332 MB | 280–326 MB |
| warm | wall          | 0.44 s  | 0.45–0.69 s (noise; same instruction count) |
| warm | instructions  | 6.86 G  | 6.86 G |

## Kept

- `map::store_stored` writes the map (blocks, chains, families, loops, roles) inside one
  transaction. Under autocommit with `journal_mode = DELETE` every row created, fsynced and
  unlinked a journal; `sample` showed fsync/open/pwrite/unlink as the top of stack. The graph
  phase alone (`--no-map`) was already 0.56 s; the map write was ~6 s of the cold run. Same rows,
  same schema, now also atomic.

## Looked at and dropped

- Graph parse: already parallel (scoped threads) with a hash-keyed parse cache; `--no-map` cold
  is 0.56 s, so little left to win against the noise floor of a loaded machine.
- Warm path (6.9 G instructions, ~0.45 s): dominated by malloc/free in the map rebuild; release
  binary is stripped so no symbol-level profile, and each release rebuild costs ~6 min on the
  shared target. Not attempted.

Tests: `KULA_NO_AGENT=1 KULA_NO_NET=1 cargo test` – 150 pass; `config::b3_tests::committed_kula_toml_loads`
fails on the base branch too (committed kula.toml names the project "c1"), unrelated.
