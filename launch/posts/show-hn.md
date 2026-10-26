# Show HN draft

**Title:** Show HN: Kula – git with a code map for you and your coding agents

**URL:** https://github.com/A12N4V/kula

## First comment (post within 5 minutes)

Hi HN, I'm Arnav. Kula is a single Rust binary (MIT, about 28 MB, the web UI embedded) that wraps git and keeps a graph of your code beside it. No server, no account, no telemetry. It works without any agent: `kula init`, `kula view`, and you get a local map of every function, class and file at localhost:7420, plus `kula impact <symbol>` (what breaks if I change this) and `kula graph-diff main WORKTREE` (what my uncommitted work does to the structure: symbols gained, lost and rewritten, call edges added and cut).

Why I built it: I was running coding agents on real repos and kept hitting two problems. They lacked a cheap way to ask "who calls this, and which tests reach it", and the only guardrails were path allow/deny lists that cannot name a function or change with the kind of work.

How the graph works:
- Files are walked in parallel (respecting .gitignore) and parsed with tree-sitter. 11 languages are built in; 173 more are optional packs (`kula lang add`), downloaded and checked against a sha256 manifest.
- Calls resolve to the same file first, then imported files, then a unique match in the same language family. A stoplist keeps `.get()` and `.map()` from wiring everything together. This is a heuristic, not compiler-grade resolution like SCIP.
- Any revision is indexed from git objects (`git ls-tree` plus one `git cat-file --batch`), no checkout, cached per commit. The store is SQLite with FTS5, built beside the live file and swapped in with a rename.
- Kula shells out to git for everything else, so hooks, signing, credential helpers and LFS keep working. `kula rebase -i` is just `git rebase -i`.

How fences work:
- In kula.toml you lock or hide paths or symbols (`src/billing.rs:charge_card`), or mark them for review. A task can narrow scope, never widen it: hidden > locked > scope > review > open.
- One verdict feeds every place an agent can act: the MCP answers (hidden code is left out), a pre-tool hook in Claude Code, Cursor, Codex and Gemini CLI that refuses edits and shell writes it can see (`sed -i`, `> file`, `mv`, `git rm`) and refuses what it cannot see through (`eval`, command substitution, heredoc-fed interpreters), a git pre-commit hook, and `kula check` in CI.
- For a harness kula doesn't know, `kula run -w <workflow> -- <command>` makes fenced files read-only for the run and restores anything fenced it changed.
- Agents cannot switch it off: kula.toml and the hooks are locked for them; they can only `suggest` a change for a person to accept.

Known limits:
- Hooks are speed bumps; CI (`kula check`) is the real gate. A fence is only as strong as the hook each agent exposes, and a shell parser will have gaps.
- Graph edges are name heuristics. Expect false and missing edges with dynamic dispatch, reflection and heavy metaprogramming.
- Windows gets the 11 built-in languages only; no prebuilt packs yet.
- It is pre-1.0 (0.3) with one maintainer.
- It does a lot (git UI, graph, issues and notes in git, agent workflows, RDF/SPARQL export). The map and the fences are the parts I would judge it on.

Install: `brew tap a12n4v/kula https://github.com/A12N4V/kula && brew install kula`, or `cargo install kula`, npm, pip, nix, apt, or release binaries with .sha256 files.

A question for you: if you run agents on a shared codebase, would you rather fence by path, by symbol, or by the kind of task (refactor locks tests, tests mode locks the code under test)? And if you can get a write past a fence, please open an issue with the command; I will fix those first.

## critic notes
- Title: changed "git with a map" to "git with a code map" so it says what the map is; kept the en dash, no superlatives, under 80 chars.
- Lead with what works without an agent, per research.md ("another AI tool" fatigue); "AI" appears nowhere in title.
- Put curl|sh last and offered brew/cargo first. Did not claim signed releases: install.sh verifies a .sha256 only if one downloads, and skips silently otherwise. Said ".sha256 files", not "signed".
- Removed "enforced" wording from the first draft; the README's own line "hooks are speed bumps, CI is the wall" is more honest and pre-empts bypass comments.
- Named SCIP explicitly so the precision limit is stated before a commenter does.
- Dropped the Stack Overflow survey stats; they read as marketing in an HN comment.
- Binary size (28 MB) and 11 + 173 languages checked against README "How it works". Resolution order quoted from the same paragraph.
- Did not claim index speed numbers: none are measured yet (PLAN layer 4). Add them before posting if the bat dry run has finished.
