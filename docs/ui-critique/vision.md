# kula: what it needs but lacks (vision review, 2026-10-28)

Repo: ~/projects/kula-team/wt-fuse5/launch (0.3.0, MIT, 22.7k lines in src/*.rs top level). This review is static (code, README, docs, --help) plus web research. The browser was not used.

## Landscape (verified via web, late 2026)
- GitNexus (Akon Labs): tree-sitter graph, MCP tools (query, context, impact, detect_changes, rename, Cypher), one-command setup that installs Claude Code hooks and AGENTS.md. It overlaps kula's map, impact, MCP and init almost exactly, and also ships a browser WASM UI. https://chatgate.ai/post/gitnexus-akon-labs
- codebase-memory-mcp: persistent code graph over MCP. https://codeconductor.ai/blog/codebase-memory-alternative/
- Conductor (Mac): one worktree per agent workspace, Claude Code and Codex, strong diff and PR flow, free. Vibe Kanban: a task board with one worktree per task; the company sunset in April 2026 and the project is now community OSS. Sculptor (Imbue): parallel agents, each in its own copy of the repo, beta. https://nimbalyst-website.pages.dev/blog/best-agent-management-tools-2026/ https://github.com/imbue-ai/sculptor
- Multica: team-level agent infrastructure. https://shiporskip.io/compare/gitnexus-knowledge-graph-codebase-mcp-agent-blast-radius-vs-multica-ai-agent-task-board-skill-compounding-team-management-2026
- Not verified in this pass: Serena, CodeSee (believed dead), Copilot Workspace (folded into the Copilot coding agent), Graphite. Treat any claims about them as unchecked.

Takeaway: the map + MCP half of kula is a crowded commodity (GitNexus is free and ships the same tool list). The parallel-agents-in-worktrees half is commodity too (Conductor, Sculptor, vibe-kanban). kula's real differentiators are symbol-level fences that follow code, memory that goes stale with code, and structural (graph-diff) review. The README currently spreads itself across six pillars plus RDF/SPARQL.

## 1. Missing features, ranked (impact on vision and adoption, effort)
1. **Kernel- or sandbox-backed fences (L).** src/guard.rs:676-1204 is a hand-written shell parser with a denylist (sed -i, perl -pi, redirects, git apply/checkout, heredocs into interpreters). It is heuristic by construction: `python3 tool.py` (a script that writes files), `make`, `npm run x`, compiled helpers, editor binaries and MCP servers other than kula all write without the parser seeing it. An agent writing its own script and then running it is the obvious bypass. What's needed: an OS-level write barrier (macOS sandbox-exec profile or Seatbelt, Linux Landlock or bwrap) for `kula run` and team agents, with the parser kept as early feedback only. Until then, "fences" is a speed bump, and the promo film ("refused each time") overclaims.
2. **Post-hoc verification as the source of truth (S).** `kula verify` and `check` exist. Make the CI gate plus a pre-commit diff check the authoritative fence: reject any commit whose diff touches a locked symbol, whatever tool made the edit. This is cheap and closes most of the gap in (1).
3. **Per-agent worktree isolation with a review queue (M).** This is the feature Conductor, Sculptor and vibe-kanban sell. kula has teams (src/agent.rs, team) but its review pitch only lands if each agent's output arrives as a reviewable unit (branch, graph-diff, fence report, memories touched) in one inbox. Collisions between two agents on one checkout are the default risk (`.kula/task.json` is per-checkout, guard.rs:16).
4. **GitHub/GitLab PR bridge (M).** PRs and issues live on refs/kula/meta only. Adoption needs graph-diff and blast radius posted as a PR comment or check run (a GitHub Action wrapping `kula check`). No forge integration was found in src/meta.rs.
5. **Proof of graph quality (M).** No published precision/recall for call edges or impact. GitNexus advertises cross-file type resolution. Ship a benchmark (5 popular repos, hand-labelled edges) in docs/ and in CI.
6. **Windows parity for hooks and fences (M).** The README badge lists Windows x64. The guard parses POSIX shell only, so PowerShell commands go unchecked.
7. **Hosted demo or zero-install trial (S).** `npx`-style or web demo on a public repo. Every competitor has a one-command or in-browser trial.

## 2. Everything lacking
- **Trust/claims.** The README badge says "parses 11 languages" (README.md header) while docs/LANGUAGES.md:3 says "187 languages". Pick one framing ("11 built in, 173 packs"). The "24 tools" MCP badge needs a test asserting the count. Cargo.toml's `license-file = ["LICENSE", "0"]` is malformed: it should be a string, and it conflicts with `license = "MIT"`. Install table: verify the apt repo and Homebrew tap actually resolve from a clean machine.
- **Fence correctness.** Heuristic parser (above). Symbol fences depend on graph freshness: a stale index means a renamed function loses its lock until reindex. Needs fail-closed behaviour when the graph is stale.
- **Graph correctness.** Tree-sitter name matching with no published accuracy. Dynamic dispatch, DI and re-exports are likely misses. Packs are tiered "measured" only on grammar test corpora (LANGUAGES.md), not on real repos.
- **Onboarding.** `kula init` writes kula.toml, git hooks, MCP config, agent hooks and CI in one go. That is a lot of side effects. It needs a `--dry-run` and a single `kula uninstall` that reverses all of it.
- **Docs.** No "kula vs GitNexus/Conductor" page. The README competitor table omits the closest rivals (GitNexus is mentioned only as a "code-graph engine"; Conductor, Sculptor and Serena are absent).
- **Perf.** No published index-time or RSS table for large repos (only okhttp at 0.55 s). The debug binary is 87 MB and release is claimed at about 28 MB; publish measured numbers.
- **Integrations.** No VS Code/JetBrains extension; the map lives only at localhost:7420. No Linear, Slack or GitHub issue sync.
- **Distribution.** A single maintainer, a repo-as-tap and a self-hosted apt repo all add trust friction. Consider crates.io, homebrew-core and an npm wrapper.
- **Scope sprawl.** 22.7k lines plus skill_hub, research, logos, syntagm, embed_ort, RDF/SPARQL. That is a large surface for one maintainer to keep correct.

## 3. Five bets
1. **"Fences that hold": an OS sandbox for `kula run` and teams, plus a commit-time diff gate.** This is the only claim no competitor makes credibly.
2. **Review inbox: one card per agent run** (worktree branch, graph-diff, fence attempts refused, memories added or staled), with approve/merge. This beats Conductor on review depth.
3. **GitHub Action + PR check posting graph-diff and blast radius.** It is the distribution wedge: teams adopt via CI before the desktop.
4. **Published graph-accuracy benchmark** against GitNexus and codebase-memory-mcp on the same repos. Turns "trust" from rhetoric into a number.
5. **Stale-memory as a headline feature,** shown live in the UI and over MCP (memory marked stale when its function changes). It is unique, cheap to demo, and directly answers the "agents forget" pain.

## 4. Cut or demote
- RDF/Turtle/JSON-LD/SPARQL (src/kg.rs, docs/KNOWLEDGE-GRAPH.md): niche. Remove it from the hero and badges.
- autoresearch (`kula research`, src/research.rs): off-vision metric-optimisation loop.
- skill hub / skills sync (src/skill_hub.rs, skill_index.rs): config theatre unless it ties to fences.
- 173 language packs as a headline: keep them, but lead with the 11 measured ones.
- Embeddings (embed.rs, embed_ort.rs) if they are not on a core path: they cost binary size.
- `issue`/`note` on refs/kula/meta: overlaps forges. Keep memory and proposals, demote issues.
