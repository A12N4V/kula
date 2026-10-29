# API performance – perf/api

Debug build, kula's own repo, loopback, `curl` median of 5 warm runs.
After = with `Accept-Encoding: gzip` (what browsers send).

| endpoint | before ms | after ms | before bytes | after bytes |
|---|---|---|---|---|
| /api/map | 539 | 9 | 1 179 419 | 188 648 |
| /api/graph | 115 | 9 | 1 196 144 | 177 394 |
| /api/flows | 222 | 4 | 181 356 | 27 016 |
| /api/git/log | 53 | 4 | 98 821 | 32 504 |
| /api/git/branches | 72 | 3 | 27 485 | 8 659 |
| /api/meta | 17 | 3 | 3 633 | 1 054 |
| /api/langs | 49 | 50 | 11 196 | 1 764 |
| /api/git/status | 32 | 30 | ~ | ~ |
| /api/agents | 4 | 4 | 13 180 | 3 361 |

## Commands

    CARGO_TARGET_DIR=~/projects/kula-team/target-be cargo build
    KULA_NO_AGENT=1 KULA_NO_NET=1 KULA_TOKEN=test $CARGO_TARGET_DIR/debug/kula view --no-open --port 8091
    curl -s -o /dev/null -H 'x-kula-token: test' -H 'Accept-Encoding: gzip' \
      -w '%{time_total} %{size_download}\n' http://127.0.0.1:8091/api/map

## Kept

- `cache::cached_json`: fingerprint-keyed cache (same inputs as `cache::cached`:
  .kula, git HEAD/index/refs, config files) that stores the serialised body, so a
  hit is a refcount bump instead of a `Value` clone plus re-serialisation.
  Used by map, graph, flows, git log, git branches. Cleared on every write
  request with the existing cache.
- gzip via tower-http `CompressionLayer` at the fastest level; SSE and images
  are skipped by its default predicate. Payloads shrink ~6x.
- `[profile.dev.package.miniz_oxide] opt-level = 3`: unoptimised miniz added
  ~40 ms per MB in dev builds; release is unaffected.

## Dropped / not done

- gzip without the miniz opt-level: −85% bytes but +45 ms on map/graph in dev.
- /api/langs and /api/git/status: depend on worktree files that the
  fingerprint does not watch, so caching would serve stale data; left as is.
