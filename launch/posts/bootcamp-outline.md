# Bootcamp: add a feature to bat with kula (sharkdp/bat #1341)

Target: 90 minutes. Issue: [#1341 Custom fallback syntax opt-in](https://github.com/sharkdp/bat/issues/1341); backup [#1618](https://github.com/sharkdp/bat/issues/1618). **Dry run 2026-10-26 (Apple M4, kula 0.3.0 release build, no agents): #1341 is still open and unassigned, but bat master already has `--fallback-syntax` (`src/bin/bat/clap_app.rs:126`, `Config::fallback_syntax`, used in `HighlightingAssets::get_syntax` at `src/assets.rs:269`), with integration tests, and open PRs #4074/#4078 add completions and man-page docs. The feature as written is done. Before the day: either pick a different issue (#1618 is open and unassigned) or reframe the session as "find and fence an existing feature, then extend it" (e.g. the `AutoDetect` value suggested in the #1341 thread). Times below are measured kula command times; human reading time is extra.**

Each step has a checkpoint branch `bootcamp/step-N` on a fork, so anyone who falls behind can `git switch` and continue.

## 1. Setup (10 min)
- `brew tap a12n4v/kula https://github.com/A12N4V/kula && brew install kula`; Rust toolchain installed.
- `git clone https://github.com/sharkdp/bat && cd bat && cargo build` (start the build now; it overlaps step 2).
- **Checkpoint:** `kula --version` prints 0.3.x; `cargo build` is running or done.

## 2. Index and open the map (10 min)
- `kula init` (writes kula.toml, AGENTS.md, .mcp.json, .claude/settings.json, .github/workflows/kula.yml, git hooks; tell attendees not to commit these into their bat PR), then `kula view`, open localhost:7420.
- Measured: `kula init` on bat takes 0.9 s wall, 354 MB peak RSS (825 files, 2,013 symbols, 4,507 edges). A no-change `kula index` takes 2.7 s (it reparses all 118 source files), so do not demo re-indexing as "instant".
- **Checkpoint:** the graph shows bat's `src/` directories as territories; `kula status` reports "graph current".

## 3. Find where syntax selection lives (15 min)
- Search (⌘K) or `kula query fallback` / `kula query syntax` (instant): surfaces `HighlightingAssets::get_syntax` (`src/assets.rs:216`) and the existing `fallback_syntax_*` integration tests.
- `kula context get_syntax`: callers `get_syntax_name` and `InteractivePrinter::new` (`src/printer.rs:219`). `kula impact get_syntax`: medium risk, 12 symbols, 3 files.
- `kula trace print_file_ranges get_syntax` works (controller → print_line → printer new → get_syntax). `kula trace main get_syntax` reports no path (the bin `main` → `Controller::run` edge is missing), so start the trace from `print_file_ranges`.
- MCP equivalent: `pre_edit {symbol: "get_syntax"}` returns callers and advice, but wrongly says no test reaches it (the `#[test]` fns in `src/assets.rs` do, via `self.` helpers). Tell attendees to read the tests themselves.
- Target files: `src/assets.rs`, `src/config.rs`, `src/printer.rs`, `src/bin/bat/clap_app.rs`, `src/bin/bat/app.rs`, `tests/integration_tests.rs`.
- **Checkpoint:** everyone has the same short list of target symbols (compare against `bootcamp/step-3/NOTES.md`).

## 4. Fence the work (10 min)
- `kula graph isolate src/assets.rs src/syntax_mapping.rs src/printer.rs --save syntax` (instant): 109 symbols, 52 inbound edges from 26 outside symbols.
- Add to kula.toml (the saved scope is not referenced by the workflow; list files by hand):
  `[[workflow]]` `name = "fallback-syntax"`, `scope = [the step-3 files]`, `lock = ["src/controller.rs", "src/decorations.rs", "src/less.rs"]`.
- `kula task start "fallback syntax opt-in (#1341)" -w fallback-syntax` (instant).
- **Checkpoint:** `kula guard check src/pager.rs` prints "⊘ scope" and exits 1; `kula guard check src/controller.rs` prints "⊘ locked"; `kula guard check src/assets.rs` exits 0. Piping a Claude `Edit` call JSON for `src/pager.rs` into `kula guard hook` exits 2 with the refusal message.

## 5. Implement (20 min)
- Agent path: `kula agents connect claude` (or cursor/codex/gemini), give the agent the issue text. Expect at least one refused edit outside scope; show the refusal message.
- No-agent path: make the change by hand using the step-3 list. (Not dry-run: the feature already exists upstream.)
- **Checkpoint:** the change compiles; compare with `bootcamp/step-5`.

## 6. Review the structure, then test (15 min)
- `kula graph-diff master WORKTREE` (bat's default branch is `master`): 2.0 s; lists added, removed and modified symbols and call edges.
- `cargo test`.
- **Checkpoint:** tests pass; the graph diff touches only the fenced scope.

## 7. Upstream (10 min)
- `kula task done` (instant), commit with plain `git` or `kula commit`, push to a fork, open a PR that links the issue and follows bat's CONTRIBUTING and CHANGELOG rules. Leave the kula files out of the PR.
- **Checkpoint:** PR URL shared in chat (or a draft PR if the maintainers asked for discussion first).

## Fallbacks
- No API key: the no-agent path in steps 3 and 5 covers the whole session.
- Agent goes off course: `git switch bootcamp/step-5`.
- Issue closed or rejected by maintainers on the day: switch to #1618, steps unchanged.

## critic notes
- Removed made-up timings for indexing; marked TBD until the dry run (PLAN layer 4 says publish measured numbers).
- Did not name bat's internal functions: not verified this session. Step 3 has attendees find them, which is the point of the demo anyway.
- Default branch name flagged for checking instead of assumed.
- Every kula command used appears in the README command table (`init`, `view`, `impact`, `trace`, `graph isolate`, `task start/done`, `guard check`, `agents connect`, `graph-diff`).
- Added a step to follow bat's contribution rules; a sloppy upstream PR from a tool demo would reflect badly on both projects.
- Total 90 min, within the 1–2h plan.
- Dry run 2026-10-26: timings and command output filled in from a no-agent run; #1341 found already implemented upstream (flagged at the top).
