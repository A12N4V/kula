# Bootcamp: add a feature to bat with kula (sharkdp/bat #1341)

Target: 90 minutes. Issue: [#1341 Custom fallback syntax opt-in](https://github.com/sharkdp/bat/issues/1341); backup [#1618](https://github.com/sharkdp/bat/issues/1618). Before the day: confirm #1341 is open and unassigned, comment on it with the intended approach, and dry-run twice to replace every "TBD" time below with a measured one.

Each step has a checkpoint branch `bootcamp/step-N` on a fork, so anyone who falls behind can `git switch` and continue.

## 1. Setup (10 min)
- `brew tap a12n4v/kula https://github.com/A12N4V/kula && brew install kula`; Rust toolchain installed.
- `git clone https://github.com/sharkdp/bat && cd bat && cargo build` (start the build now; it overlaps step 2).
- **Checkpoint:** `kula --version` prints 0.3.x; `cargo build` is running or done.

## 2. Index and open the map (10 min)
- `kula init`, then `kula view`, open localhost:7420.
- Record the index time and memory on the day (TBD; publish both).
- **Checkpoint:** the graph shows bat's `src/` directories as territories; `kula status` reports the graph is current.

## 3. Find where syntax selection lives (15 min)
- Search (⌘K) for `syntax`; inspect the symbol that picks a syntax for a file and its callers.
- `kula impact <that symbol>` and `kula trace` from the CLI entry point to it.
- No-agent path: write down the 2–3 functions to change and the tests that reach them (`pre_edit` shows these to agents; humans read the Impact view).
- **Checkpoint:** everyone has the same short list of target symbols (compare against `bootcamp/step-3/NOTES.md`).

## 4. Fence the work (10 min)
- `kula graph isolate <path> --save syntax`, then a `[[workflow]]` in kula.toml with `scope` set to the syntax-selection files and `lock` on unrelated modules.
- `kula task start "fallback syntax opt-in (#1341)" -w <that workflow>`.
- **Checkpoint:** `kula guard check <a file outside scope>` reports it as fenced.

## 5. Implement (20 min)
- Agent path: `kula agents connect claude` (or cursor/codex/gemini), give the agent the issue text. Expect at least one refused edit outside scope; show the refusal message.
- No-agent path: make the change by hand using the step-3 list.
- **Checkpoint:** the change compiles; compare with `bootcamp/step-5`.

## 6. Review the structure, then test (15 min)
- `kula graph-diff master WORKTREE` (bat's default branch, check on the day) and the Contrast view: which symbols and call edges changed.
- `cargo test`.
- **Checkpoint:** tests pass; the graph diff touches only the fenced scope.

## 7. Upstream (10 min)
- `kula task done`, commit with plain `git` or `kula commit`, push to a fork, open a PR that links #1341 and follows bat's CONTRIBUTING and CHANGELOG rules.
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
