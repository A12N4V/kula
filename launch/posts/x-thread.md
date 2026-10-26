# X thread draft (attach the 20–40s fence-refusal clip to post 1)

1/
Kula: a local git wrapper that keeps a graph of your code, so you and your coding agents can ask "who calls this, what tests reach it, what does this branch change structurally".
One Rust binary, MIT, no account, no telemetry.
github.com/A12N4V/kula

2/
Without any agent:
kula init
kula view → a map of every function and file at localhost:7420
kula impact parseConfig → the blast radius
kula graph-diff main WORKTREE → symbols and call edges your uncommitted work adds, cuts or rewrites

3/
With agents: fences by path or by symbol. Lock src/billing.rs:charge_card, hide data/customers/**, or start a task in a workflow: refactor locks the tests, tests mode locks the code under test.

4/
One verdict, checked in several places: MCP answers, a pre-tool hook in Claude Code, Cursor, Codex and Gemini CLI (file tools and shell writes like sed -i or > file), the git pre-commit hook, and kula check in CI. Hooks slow an agent down; CI is the gate.

5/
Memory pinned to code: an agent's note is anchored to a symbol, stored in git, and comes back marked stale when that symbol changes.

6/
Limits, up front: call resolution is tree-sitter plus name heuristics, not compiler-grade. Windows gets 11 languages, not the 173 packs. It's 0.3 and I'm one person.
brew tap a12n4v/kula https://github.com/A12N4V/kula && brew install kula

7/
If you run agents on a shared repo: would you fence by path, by symbol, or by type of task? And if you get an agent past a fence, send me the command.

## critic notes
- Each post checked under 280 chars (post 2 and 4 are the longest; trim the URL line if X counts it over).
- Removed "finally" and "your agents will thank you" style lines.
- Post 4 says "slow an agent down" instead of "enforced", matching README "hooks are speed bumps, CI is the wall".
- No @-tags of people or projects not involved (research.md).
- Video, not a link-only first post.
