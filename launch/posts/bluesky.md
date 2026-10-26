# Bluesky draft (300 char limit per post; attach the fence-refusal clip)

1/
Kula: one Rust binary that wraps git and keeps a graph of your code. `kula view` maps every function at localhost:7420; `kula impact` and `kula graph-diff` show what a change breaks. No account, no telemetry, MIT.
github.com/A12N4V/kula

2/
For coding agents: fence a path or a single function, per task. A refactor can't touch the tests. Checked by the pre-tool hook in Claude Code, Cursor, Codex and Gemini CLI, at commit, and in CI.

3/
Limits: heuristic call graph (tree-sitter, not a compiler), Windows has 11 languages only, 0.3 with one maintainer. Try to get an agent past a fence and tell me how.

## critic notes
- Cut from 7 posts to 3 for Bluesky's shorter-thread norm; each under 300 chars.
- "Checked ... in CI" instead of "enforced everywhere".
- Kept limits in the thread rather than a reply, so they are not hidden.
