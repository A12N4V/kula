<!-- proposed first screen for README.md; replaces everything above "## Why kula" -->
<p align="center"><img src="docs/assets/hero.svg" alt="kula" width="100%"></p>

<p align="center"><b>See what a change breaks before you make it, and stop coding agents from casually editing what you fenced off.</b><br>
A git wrapper with a code graph. One binary, MIT. No server, no account, no telemetry.</p>

<p align="center"><img src="docs/assets/promo.gif" alt="An agent tries an edit, sed and ending the task to get past a fence; each is refused" width="100%"></p>

## Install

```sh
brew tap a12n4v/kula https://github.com/A12N4V/kula && brew install kula
```
Also: `cargo install kula`, `nix run github:A12N4V/kula`, `npm i -g @kula-cli/kula` (npm is on 0.3.1; everything else is on 0.3.0), pip, apt, or [release binaries](../../releases) with `.sha256` files. [All options](docs/CLI.md).

## Sixty seconds, no agent needed

```sh
cd your-repo
kula init                          # kula.toml, git hooks, first graph
kula view                          # the map at http://localhost:7420
kula impact parseConfig            # who calls it, which tests reach it, risk
kula graph-diff main WORKTREE      # symbols and call edges your changes add, cut or rewrite
kula task start "split auth" -w refactor   # agents may restructure; tests are locked
```
Anything kula doesn't know goes to `git`, so `kula rebase -i` works.

## kula vs

| | what it does well | what kula adds |
|---|---|---|
| Sourcegraph | precise, cross-repo code intelligence | local single binary, graph per commit, edit fences |
| Aider repo-map | tree-sitter map built into one agent | persistent, queryable, shared across agents, with a UI |
| repomix / gitingest | one command to pack a repo for an LLM | ranked context fitted to a budget, instead of a flat dump |
| Claude Code permissions, Cursor rules | path allow/deny lists | fences on symbols, per task, also checked at commit and in CI |
| GitNexus | code graph and MCP tools for agents | git client, per-task fences, memory that goes stale with the code, MIT |
| Serena | LSP-backed symbol tools for agents (more precise resolution) | a persistent cross-agent graph, a UI, fences checked at commit and in CI |
| codebase-memory-mcp | a code graph served to agents over MCP | git integration, structural diffs between revisions, fences |
| lazygit, GitKraken | fast, polished git UX | a code graph and structural diffs on top of git |

## Known limits

- Call resolution is tree-sitter plus name heuristics, not compiler-grade (no SCIP/LSIF).
- Windows: the 11 built-in languages only; the 173 language packs are macOS and Linux.
- The hook is a speed bump: the hook catches obvious shell writes; scripts, variables and cd-then-write can slip past; CI (`kula check`) is the gate.
- 0.3, one maintainer.

## critic notes
- Outcome line states two concrete results instead of "turns a git repository into a knowledge graph".
- Brew first; curl|sh moved below the fold. Said ".sha256 files", not "signed", because the installer only checks a checksum when the .sha256 download succeeds.
- Platforms: removed "Windows arm64" implied by the old badge; Releases list Windows x64 only.
- The vs table states where each tool is better first, so it reads as fair, not as a takedown. Removed GitNexus and mem0 rows: less known to HN readers and harder to defend in one cell.
- "no telemetry": no network code found besides language-pack downloads, which the user triggers with `kula lang add`. Worth stating that in the full README.
- About 45 lines; RDF and SPARQL moved below the fold per research.md.
- Round 2: new agents line; GitNexus, Serena and codebase-memory-mcp rows (strengths stated from general knowledge, verify before merging); dead anchor now links docs/CLI.md; npm as @kula-cli/kula at 0.3.1.
