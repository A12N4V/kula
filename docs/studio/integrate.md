# PLAN §1.1 – integrate the backend perf branches

## What shipped

- Merged `origin/perf/index` (map rows in one transaction), `origin/perf/api` (`cache::cached_json` + gzip) and `origin/perf/recall` (work tree, git dir and `refs/kula/meta` read from the filesystem, `meta.cache`) into `studio/integrate`. No textual conflicts (`src/cache.rs` and `Cargo.toml` merged cleanly).
- Fix found by the verification: `cache::fingerprint` shared one 2000-entry budget across every watched dir, so a big `.claude`/`.kula`/`.agents` tree crowded out `refs/`. With `cached_json` now caching `/api/git/log` and `/api/git/branches`, a commit or a new branch left both stale. Each watched dir now walks with its own budget (`walk_capped`). Test: `cache::tests::big_watched_dir_does_not_hide_refs`.

## Numbers (debug builds, this repo cloned: 850 files, 3287 symbols; old = launch-prep ef8aa05)

| metric | before | after |
|---|---|---|
| cold `kula index` | 15.4 s | 9.1 s |
| `/api/map` warm | 573 ms | 2.7 ms |
| `/api/map` gzip bytes | 1 352 751 | 212 237 |
| `/api/git/log` warm | 47 ms | 2.3 ms |
| `/api/git/log` gzip bytes | 98 497 | 32 468 |
| `kula memory recall` | 0.05 s | 0.03 s |
| `kula guard check` | 0.03 s | 0.01 s |

## How verified (scratch repos under ~/projects/kula-team/scratch-guard, deleted)

- (a) Guard: locked/review/hidden rules on paths and symbols. Old vs new binary over every tracked path plus odd ones (absolute, `./`, `..`, wrong case, missing): `guard hook` for Edit/Read/Write/Bash, Grep hook, `guard check`, `guard list --json`, `query` on fenced symbols. Byte-identical in plain repo (78 verdicts, 36 blocked), subdir cwd, linked worktree, submodule, `--separate-git-dir`, `GIT_DIR`+`GIT_WORK_TREE` from outside, `GIT_DIR` alone.
- (b) Recall: memories added alternately by old and new binary, then `git pack-refs --all`, then more adds, then the ref deleted – old and new `memory recall --json` identical at every step in all the layouts above. A bare repo and `.git/` as cwd: both refuse the same way. A symbolic loose ref falls back to git.
- (c) `/api` cache on port 8093: map, graph, git log, branches all move after edit + index, commit, branch switch, commit on the new branch, switching back, and `PUT /api/file` (immediately and again once the background re-index lands). Old vs new responses identical apart from the `ms` timing field. Big `.claude` case failed before the fix, passes after.
- (d) `kill -9` of `kula index` at 1, 3, 5, 7, 8.5 s, then re-index: every table identical to a clean index (only `indexed_at`/timings differ), `integrity_check` ok.
- `cargo test cache::` and `fs_lookup` pass.

## Open

- Cached `/api/map` returns the build's `ms` from the first build, not per request (cosmetic).
