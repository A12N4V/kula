# Recall, query and guard latency

Branch `perf/recall`. Release build, this repository indexed (`kula index`), best of 3 × 20 runs per command, wall clock per call.

| command | before | after |
|---|---|---|
| `kula guard check src/main.rs` | 16.5 ms | 5.5 ms |
| `kula guard hook` (Edit on stdin – runs on every agent edit) | 26.3 ms | 6.2 ms |
| `kula memory recall src/graph.rs` | 28.8 ms | 7.1 ms |
| `kula memory recall -q index` | 27.7 ms | 6.7 ms |
| `kula query 'fence check'` | 15.4 ms | 5.9 ms |
| `kula --version` (process floor) | 4.6 ms | 4.6 ms |

All five commands now sit within ~1–2.5 ms of the process floor.

## Where the time went

Not the graph, RDF store or SQLite: each call spawned `git` one to three times at ~5–13 ms each.

- `Repo::discover` – `git rev-parse --show-toplevel` on every command.
- `meta::load` – `git show refs/kula/meta:kula.json` (~13 ms) on every recall.
- `guard::session_path` – `git rev-parse --git-path kula` on every hook call.

## Kept

1. **Filesystem discover.** Walk up from the canonicalised start for a `.git` dir (with `HEAD`) or a `gitdir:` file. Falls back to git when any of `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_CEILING_DIRECTORIES`, `GIT_DISCOVERY_ACROSS_FILESYSTEM` is set, when the start is inside a `.git` dir, or when nothing is found (so error messages are unchanged).
2. **Meta cache per ref id.** `refs/kula/meta` is read from the ref store (loose, then `packed-refs`, via `commondir` for worktrees). The parsed document is cached in `<git dir>/kula/meta.cache` as `<commit id>\n<json>`; a different id means a miss, then `git show <id>:kula.json` refreshes it (atomic rename). Not under `.kula/`, so `kula clean` sizes are unchanged.
3. **Session marker path without git.** `kula` is a per-worktree git path, so it is `<git dir>/kula`.

A test (`git::fs_lookup_tests`) pins all three lookups to git's own answers.

## Checked

- `kula --json guard check <400 tracked files>`, `guard check` from `src/` with relative paths, and `memory recall --json` are byte-identical before and after.
- `KULA_NO_AGENT=1 KULA_NO_NET=1 cargo test`: 151 pass; `config::b3_tests::committed_kula_toml_loads` fails before and after (the committed `kula.toml` has `name = "c1"`) – pre-existing.

## Dropped / not pursued

- Caching the graph or RDF store per HEAD: once spawns were gone the remaining in-process work (SQLite open, guard globset compile, recall loop) measured under 1.5 ms combined – below the 5 % bar against noise on a loaded machine.

## Reproduce

```sh
K=target/release/kula
for i in $(seq 20); do $K memory recall src/graph.rs >/dev/null; done   # time the loop
echo '{"tool_name":"Edit","tool_input":{"file_path":"src/main.rs"}}' | $K guard hook
```
