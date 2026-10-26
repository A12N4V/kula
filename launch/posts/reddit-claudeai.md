# r/ClaudeAI draft

**Title:** I built fences for Claude Code: lock a function or a folder per task, enforced by a PreToolUse hook and checked again at commit and in CI

**Flair:** pick the project/showcase flair the sub requires (verify on the day)

## Body

If you run Claude Code on a real repo, you have probably watched it "fix" a test to make it pass, or wander into a file you did not want touched. Permissions in settings.json help, but they are path lists: they cannot name a function, follow it when it moves, or change with the kind of work.

Kula is an open-source (MIT) local CLI that adds that layer. Repo: https://github.com/A12N4V/kula

What it does for Claude Code:
- `kula agents connect` writes `.mcp.json` and `PreToolUse` hooks on edits, reads and Bash into `.claude/settings.json`.
- **Fences** in kula.toml: `locked`, `hidden` or `review`, by path or by symbol (`src/billing.rs:charge_card`). Likely secrets are hidden by default.
- **Workflows** are work modes: `refactor` locks the tests, `tests` leaves only tests editable, `explore` locks everything, `docs` only docs. `kula task start "split auth" -w refactor`.
- The hook reads Bash commands for the files they write (`sed -i`, `> file`, `mv`, `tee`, `git rm`) and refuses what it cannot see through (`eval`, `$(...)`, heredoc-fed interpreters). The refusal tells Claude why.
- Claude cannot turn it off: editing kula.toml or the hooks, `kula task done` and `git commit --no-verify` are refused. It can `suggest` a fence change for you to accept.
- A git pre-commit hook refuses an agent's commit with fenced changes, and `kula check` fails the branch in CI. The hook is a speed bump; CI is the actual gate.

MCP tools (24) include `context_pack` (the code a task needs, ranked by graph distance, fitted to a token budget), `pre_edit` (callers, tests that reach a symbol, the fence verdict), `verify_edit`, and `remember`/`recall`: memories pinned to a symbol, stored in git, and returned as **stale** once that symbol's code changes.

**Teams:** `kula team save ship --lead claude -m claude=autoresearch:"speed up the indexer" -m cursor=tests -m codex=explore:review` gives each agent its own workflow in one checkout, and the hook holds each to its own. `kula workflow install <name>` also writes a workflow as a Claude Code subagent in `.claude/agents/`.

Everything runs locally: no account, no telemetry. Install: `brew tap a12n4v/kula https://github.com/A12N4V/kula && brew install kula`, then `kula init` in your repo.

Limits: the graph is tree-sitter plus name heuristics, not a compiler; Windows has 11 languages only; it is 0.3 with one maintainer.

What I'd like to know: is per-task fencing the right model for how you use Claude Code, or do you mostly need one fixed set of rules? And if you get Claude past a fence, post the command; that is the most useful bug report I can get.

## critic notes
- Checked the Claude Code integration row in the README: `.mcp.json` and PreToolUse on edits, reads and Bash. Did not claim it works with plan mode or subagents' own hooks beyond `workflow install`.
- MCP tool count: badge says 24; listed only tools that appear in the README table.
- Replaced "Claude can't escape" with the specific refused actions, and repeated the README line that CI is the real gate.
- Removed a claim about saving tokens; context_pack fits a budget but there is no measurement of savings.
- Team example copied verbatim from the README so it runs.
- Flair and self-promo rules for r/ClaudeAI are marked [verify] in research.md; left as a pre-post check.
