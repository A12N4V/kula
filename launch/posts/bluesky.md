# Bluesky draft (300 char limit per post; attach the fence-refusal clip)

1/
Kula: one Rust binary that wraps git and keeps a graph of your code. `kula view` maps every function; `kula impact` and `kula graph-diff` show what a change breaks. No account, no telemetry, MIT.
github.com/A12N4V/kula

2/
For coding agents: fence a path or a single function, per task. A refactor locks the tests. The hook (Claude Code, Cursor, Codex, Gemini CLI) is a speed bump that catches obvious shell writes; scripts can slip past. CI is the gate.

3/
Limits: heuristic call graph (tree-sitter, not a compiler), Windows has 11 languages only, 0.3 with one maintainer. Try to get an agent past a fence and tell me how.

## critic notes
- Round 2: "locks the tests"; post 1 trimmed to fit 300 chars with the URL; shared hook line, shortened.
- Cut from 7 posts to 3 for Bluesky's shorter-thread norm; each under 300 chars.
- "Checked ... in CI" instead of "enforced everywhere".
- Kept limits in the thread rather than a reply, so they are not hidden.
