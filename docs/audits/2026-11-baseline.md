# Baseline audit, kula 0.3.0 (c80b8ce), 2026-11-11

Static read by kula-critic. Nothing was built or run. Fence bypasses are untested.
Registry liveness was checked separately: GitHub, crates.io, PyPI, npm, brew and apt are live at MIT and 0.3.0 (npm launcher 0.3.1).

## Blockers
None found.

## Major
1. **Tool count.** `src/mcp.rs` lists 24 tools. README says 24; `site/index.html:196` said 21 (fixed in this commit).
2. **Call linker is name-based.** `src/index/mod.rs:822-868`: same-file match wins, then imported files, then up to 3 candidates weighted 1/n. No receiver or type check; a local `new` or `run` shadows the real cross-file target; calls outside any def attach to the file node. README.md:419 says "unique match", which is wrong. Fix: reword the README, add a `confidence` field to CALLS edges, show it in `impact`, measure precision.
3. **Fences are a deterrent at hook time.** `docs/AGENTS.md:158` concedes the shell denylist cannot be complete; only `kula check` in CI is authoritative. README advertises enforcement without that caveat. Symbol fences lock the whole file at hook time. Untested bypass candidates: `python -c` / `perl -pi` / `node -e` writes, `cp` / `install` over a fenced path, symlinks, `..` and absolute paths, `git -c core.hooksPath=/dev/null commit`, `GIT_DIR` redirection, `commit-tree` / `update-ref` / `push` plumbing, `git restore` / `mv` / `stash pop`, scripts run through `make` or `npm run`. Fix: say so in the README, add a test matrix for each writer.
4. **Renamed fenced symbol drops its fence.** Fences go by name, not stable id. Warn when a `[[guard]]` symbol resolves to 0 definitions.

## Minor
5. `scripts/install.sh:22-26` installs even when the `.sha256` download fails. Make it fatal.
6. README.md:419 size and pack figures ("175-350 MB", "0.07-4.3 MB each") conflict with `docs/LANGUAGES.md` (213.7 MB measured, max 23.7 MB). Use the measured numbers.
7. Homebrew formula is named `kula-core.rb` in `packaging/`; README uses the repo as its own tap. Rename or explain. pyproject version, formula sha and apt version were not read by the critic (apt and brew checked live separately).
8. `refs/kula/meta` stores one JSON blob per commit; concurrent-edit merge behaviour and stale-memory detection on rename or whitespace edits are untested.
9. SPARQL (oxigraph, read-only) is present in code; not run.
10. Per-agent hook payload parsing (Claude Code, Cursor, Codex, Gemini) not verified; run `kula hooks status` per agent.
11. `--no-verify` is refused only at the shell-string level; a person's own `--no-verify` is allowed by design.

## Top three to fix first
1. Tool count and any remaining "live" claims.
2. Honest linker wording, edge confidence, measured precision.
3. Fence honesty, bypass test matrix, warn on zero-match fences.
