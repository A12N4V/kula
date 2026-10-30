# Bootcamp: add a feature to bat with kula (sharkdp/bat #3805)

Target: 90 minutes. Issue: [#3805 Add support for Device Tree Source (dts) files](https://github.com/sharkdp/bat/issues/3805): open, no comments, no linked or competing PR (checked 2026-10-26). A new syntax is the kind of change bat merges regularly: a Sublime syntax as a submodule under `assets/syntaxes/02_Extra`, a mapping if needed, a syntax test, a CHANGELOG line. **Earlier picks are out:** #1341 is already in bat master (`--fallback-syntax`); #1618 is open but cannot be reproduced on current master and has four open competing PRs (#3739, #3859, #3880, #4072). Other good-first and feature issues checked (#4019, #2944, #2784, #2993, #3811, #4017, #3203, #1081) each have an open PR or a merged fix. **Dry run 2026-10-26 (Apple M4, kula 0.3.0 release build from launch-prep, no agents, feature not implemented).** Times are measured wall times for kula commands; human reading time is extra.

Each step has a checkpoint branch `bootcamp/step-N` on a fork, so anyone who falls behind can `git switch` and continue.

## 1. Setup (10 min)
- `brew tap a12n4v/kula https://github.com/A12N4V/kula && brew install kula`; Rust toolchain installed.
- `git clone --recursive https://github.com/sharkdp/bat && cd bat && cargo build` (start the build now; it overlaps step 2). `--recursive` matters: the syntaxes are submodules.
- **Checkpoint:** `kula --version` prints 0.3.x; `cargo build` is running or done.

## 2. Index and open the map (10 min)
- `kula init --yes` (1.8 s with hooks, MCP, AGENTS.md and CI): `git status` stays clean, because kula's files go in `.git/info/exclude`. Nothing to keep out of the bat PR by hand. (`--commit` keeps them committable, for your own repos.)
- `kula index`: the first run after init builds the map, 3.2 s. Every later no-change `kula index` takes 0.5 s (118 files parsed, 0 changed, map reused). Demo the second run.
- `kula view`, open localhost:7420.
- **Checkpoint:** the graph shows bat's `src/` directories as territories; `kula status` reports "graph current".

## 3. Find where syntax selection lives (15 min)
- `kula query syntax_mapping` (0.05 s): `SyntaxMapping` (`src/syntax_mapping.rs:57`) and `get_syntax_mapping_to_paths` (`src/bin/bat/main.rs:85`). `kula query devicetree` finds nothing, which is the point: bat has no DTS support yet.
- `kula context get_syntax_for_path` (0.06 s): callers `syntax_for_file_name`, `get_syntax`, `get_languages`; callees include `SyntaxMapping::get_syntax_for`. `kula impact get_syntax_for_path`: medium risk, 15 symbols, 4 files.
- `kula trace syntax_detection_basic get_syntax` (0.05 s): test → `syntax_for_file` → … → `get_syntax_name` → `get_syntax`, through `self.` helpers and `assert_eq!` bodies.
- MCP `pre_edit {symbol: "get_syntax"}` / `kula before get_syntax` (0.1 s): 2 direct callers, 28 dependents, and "Run the 14 test(s) that reach it" (the `#[test]` fns in `src/assets.rs`).
- Target files: `.gitmodules`, `assets/syntaxes/02_Extra/` (new submodule), `src/syntax_mapping/builtins/**` (only if `.dts`/`.dtsi` need a mapping), `tests/syntax-tests/source/` and `highlighted/`, `CHANGELOG.md`.
- **Checkpoint:** everyone has the same short list (compare against `bootcamp/step-3/NOTES.md`).

## 4. Fence the work (10 min)
- `kula graph isolate src/syntax_mapping.rs 'src/syntax_mapping/**' --save dts` (0.02 s). A saved scope only holds indexed source files: the `.toml` mapping files, CHANGELOG and submodule paths are not in the graph (isolate refuses them with "nothing in the graph matches"), so list those in the workflow next to the scope name.
- Add to kula.toml (kept local by init):
  `[[workflow]]` `name = "dts-syntax"`, `scope = ["dts", "src/syntax_mapping/builtins/**", "assets/syntaxes/02_Extra/**", ".gitmodules", "tests/syntax-tests/**", "CHANGELOG.md"]`, `lock = ["src/printer.rs", "src/controller.rs", "src/assets.rs"]`.
- `kula guard list` shows the fences: the task scope (with `dts` resolved to its files), the workflow's locks and the saved `dts` scope.
- `kula task start "Device Tree syntax (#3805)" -w dts-syntax` (0.06 s).
- **Checkpoint:** `kula guard check src/pager.rs` prints "⊘ scope" and exits 1; `kula guard check src/printer.rs` prints "⊘ locked"; `kula guard check src/syntax_mapping.rs` and `kula guard check CHANGELOG.md` exit 0. Piping a Claude `Edit` call JSON for `src/pager.rs` into `kula guard hook` exits 2 with the refusal message.

## 5. Implement (20 min)
- Agent path: `kula agents connect claude` (or cursor/codex/gemini), give the agent the issue text. Expect at least one refused edit outside scope; show the refusal message.
- No-agent path: add a maintained, permissively licensed DeviceTree `.sublime-syntax` as a submodule in `assets/syntaxes/02_Extra`, run `bash assets/create.sh`, add `tests/syntax-tests/source/DeviceTree/` with a sample, regenerate highlighted output, add the CHANGELOG line. (Not done in the dry run.)
- **Checkpoint:** `cargo build` passes and `bat --list-languages | grep -i device` shows it; compare with `bootcamp/step-5`.

## 6. Review the structure, then test (15 min)
- `kula graph-diff master WORKTREE` (bat's default branch is `master`): 1.6 s; lists added, removed and modified symbols and call edges.
- `cargo test`.
- **Checkpoint:** tests pass; the graph diff touches only the fenced scope.

## 7. Upstream (10 min)
- `kula task done` (0.01 s), commit with plain `git` or `kula commit`, push to a fork, open a PR that links #3805 and follows bat's CONTRIBUTING and syntax-request rules. kula's files are already excluded, so `git add -A` is safe.
- **Checkpoint:** PR URL shared in chat (or a draft PR if the maintainers asked for discussion first).

## Fallbacks
- No API key: the no-agent path in steps 3 and 5 covers the whole session.
- Agent goes off course: `git switch bootcamp/step-5`.
- #3805 taken or rejected on the day: re-check the bat tracker for an open syntax request with no PR (e.g. #3797 JSON5, #3810 Djot); steps 3 to 7 stay the same.

## critic notes
- Removed made-up timings for indexing; marked TBD until the dry run (PLAN layer 4 says publish measured numbers).
- Did not name bat's internal functions: not verified this session. Step 3 has attendees find them, which is the point of the demo anyway.
- Default branch name flagged for checking instead of assumed.
- Every kula command used appears in the README command table (`init`, `view`, `impact`, `trace`, `graph isolate`, `task start/done`, `guard check`, `agents connect`, `graph-diff`).
- Added a step to follow bat's contribution rules; a sloppy upstream PR from a tool demo would reflect badly on both projects.
- Total 90 min, within the 1–2h plan.
- Dry run 2026-10-26: timings and command output filled in from a no-agent run; #1341 found already implemented upstream (flagged at the top).
- Dry run 2 (2026-10-26): switched to #3805 after #1341 (done upstream) and #1618 (crowded, not reproducible); re-measured with the launch-prep build (clean init, warm index 0.5 s, method-call trace and inline tests, saved scope in the workflow, scope fences in `guard list`).
