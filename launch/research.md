# kula launch research

Date: 2026-10-26. Status: partial. The disk filled up (ENOSPC) partway through, so the live GitHub issue lookups did not finish. Anything marked **[verify]** is from general knowledge and was not re-checked this session.

## 1. Competitors and adjacent tools

| Tool | Overlap | How kula differs | Where kula is weaker |
|---|---|---|---|
| Sourcegraph | Code search and navigation, code graph, Cody/Amp agents | Local single binary with no server or account; the graph is versioned per commit | Sourcegraph is far ahead on cross-repo scale, precise SCIP indexing and enterprise trust |
| CodeSee (dead) | Visual codebase maps, onboarding | Maps live in a CLI/local UI that is tied to git and agents | Proves "code maps" is a hard business. CodeSee said its sales growth was inconsistent and it needed faster revenue; it shut down commercial operations on Feb 22 (year per founder post) and GitKraken acquired it on 2024-05-14 ([schneider.im](https://www.schneider.im/gitkraken-acquired-codesee), [CB Insights](https://www.cbinsights.com/company/codesee), [LinkedIn post](https://sk.linkedin.com/in/daniel-ivanyi-16845458)). Expect "maps are pretty but unused" |
| Swimm | Docs coupled to code, kept in sync | Notes and issues stored in git, anchored to symbols; free and MIT | Swimm has IDE plugins, polished docs authoring and enterprise sales |
| gitingest / repomix | Pack a repo into LLM context | Structured graph plus MCP queries instead of a flat dump; fences | Packers are zero-setup, one command, and anyone understands them in 5 seconds |
| Greptile | AI code review using a codebase graph | Local, no SaaS, no code leaves the machine | Greptile does hosted PR review on GitHub and is more mature at review quality |
| Aider repo-map | tree-sitter symbol map for LLM context | Persistent, queryable graph, a UI, and use across agents | Aider's map is built in and free; for many users it is "good enough" |
| Cursor | Codebase indexing, agents | Agent-neutral; fences enforce scope across agents | Cursor's index is invisible and needs no extra tool. kula has to justify being a second layer |
| Claude Code | Agentic coding, subagents, hooks | kula supplies the map, fences and memory through MCP and hooks | Native features (hooks, subagents, CLAUDE.md, plugins) overlap with fences and teams more every release |
| GitKraken | GUI git client, commit graph | Code graph, not just a commit DAG; CLI-first, local | GitKraken has years of polish and merge-conflict UX, and it now owns the CodeSee IP |
| Lazygit | TUI git | Graph, agents and RDF on top | Lazygit is beloved, fast and focused. "Every git command" invites direct comparison |
| jj (Jujutsu) | Rethinks the git workflow | kula wraps git and does not replace the VCS model | jj people dislike wrapper layers; kula's issues and notes in git may clash with jj's own model **[verify]** |

Honest weak spots to name first in the launch post:
- Scope sprawl: VCS client, code graph, issue tracker, agent orchestrator and RDF in one tool reads as "does everything". Lead with one job.
- Graph precision: tree-sitter plus name heuristics, not compiler-grade (unlike SCIP/LSIF). Say so.
- Windows gets only the 11 built-in languages (stated in the README).
- RDF/SPARQL is niche and HN may mock it; keep it below the fold.
- Fences are only as strong as the hooks each agent exposes; critics will try to get around them.

## 2. Platform playbook

### Show HN
- Title: `Show HN: kula – git with a map for you and your coding agents`. Plain wording, no superlatives; use an en dash. Several guides suggest a name plus fewer than 10 words of description ([flowjam](https://www.flowjam.com/blog/how-to-get-on-the-front-page-of-hacker-news-in-2025-the-complete-up-to-date-playbook), [causo](https://hub.causo.ai/guides/show-hn-launch-playbook-technical-founders-2026)).
- Timing: Tue to Thu, about 8–10am ET (guides vary). Avoid Fridays and big Apple/OpenAI news days.
- First comment within 5 minutes: why you built it, how it works (tree-sitter, SQLite, git objects), limits, what you want feedback on. No marketing copy.
- The post must be something people can try now. Stay and reply for 2–3+ hours, including to hostile comments.
- What HN hates: voting rings (they are detected), upvote requests, waitlists, sign-up walls, superlatives, "AI-powered" framing, curl|sh without a checksum, unexplained telemetry. Official rules: https://news.ycombinator.com/showhn.html

### Reddit
- r/rust: self-promotion is allowed within limits; the post must clearly involve Rust; "Announcing X 1.0" alone is not enough title context ([rules mirror](https://axebps-redlib.hf.space/r/rust/wiki/rules)). Talk about the Rust internals (tree-sitter, SQLite swap, git cat-file batching).
- r/programming: strict about promotional and low-effort posts; a technical blog post does better than a product link **[verify sidebar]**.
- r/commandline: CLI demos (asciinema/GIF) work well; follow its flair rules **[verify]**.
- r/ClaudeAI: needs flair; show the MCP and fences angle with a real Claude Code session **[verify rules]**.
- r/LocalLLaMA: only relevant if it works with local models or agents; otherwise it reads as off-topic **[verify]**.
- r/git: small; frame it as a git workflow tool **[verify]**.
- General Reddit rule of thumb (9:1 participation): use an account with history, post one subreddit per day, and do not crosspost-spam.

### X / Bluesky
- A 20–40s native video (not a link-only post) of the fence-refusal moment. Pin it. Tag @rustlang? No, tag people only if they are actually involved. Bluesky has a growing dev/Rust audience; post natively there too.

### Product Hunt
- Low yield for an OSS CLI. The audience leans toward founders and marketers, and the badge has little value with devs. Optional at best, and not on the same day as HN **[judgement]**.

### dev.to / Hashnode / Lobsters
- dev.to and Hashnode: cross-post a technical write-up (with a canonical URL to your blog). Low risk, small reach.
- Lobsters is invite-only; you need an invite from a member. Authors must use the `show` tag, and self-promotion is limited (they expect most of your activity to be non-self) **[verify at lobste.rs/about]**.

### YouTube / short video
- The repo already has a 2-minute film (promo/). Also make a 60s vertical cut and a 10–15 min "add a feature to a real library with kula" video (see section 3). Real sessions beat motion graphics.

### Newsletters
- Console.dev: email per its selection criteria. It reviews 2–3 dev tools a week, does no sponsored reviews, and lists only early access, alpha or beta tools where devs are the primary user ([criteria](https://console.dev/selection-criteria)). kula 0.3 qualifies as pre-1.0.
- This Week in Rust: open a PR against https://github.com/rust-lang/this-week-in-rust adding the blog post link under "Project/Tooling Updates" (example [PR](https://github.com/rust-lang/this-week-in-rust/pull/6467/files)). Crate of the Week nominations go in the users.rust-lang.org thread.
- TLDR: no editorial submission path found; it is mostly ad-driven. Getting into it organically depends on HN traction **[verify tldr.tech]**.
- Changelog (changelog.com/news): has a submit form for news items **[verify]**.

## 3. Bootcamp: library for a "use kula to add a real feature" walkthrough

Criteria: built-in language, 10k–100k LOC, recognisable, maintainers merge outside PRs, open small issues.

| Rank | Repo | Lang | Why |
|---|---|---|---|
| 1 | sharkdp/bat | Rust | Famous, mid-size, active. Open issues seen 2026-10-26: [#1341 Custom fallback syntax opt-in](https://github.com/sharkdp/bat/issues/1341) (updated 2026-07-08) and [#1618 --list-themes + BAT_OPTS can be problematic](https://github.com/sharkdp/bat/issues/1618) (updated 2026-07-26). #1341 is a contained feature: a good map-then-edit demo |
| 2 | sharkdp/fd | Rust | Small, clean codebase. Its only labelled issue is [#893 Extended benchmark suite](https://github.com/sharkdp/fd/issues/893) (updated 2023-09-29), which is stale. Pick an open feature request on the day instead **[verify]** |
| 3 | pallets/click | Python | Recognisable, about 10k LOC; no labelled good first issues returned **[verify]** |
| 4 | Textualize/rich | Python | Popular, many feature requests; maintainers are selective **[verify]** |
| 5 | BurntSushi/ripgrep | Rust | Most recognisable, but there were no labelled issues and the maintainer has a high bar. Good to show off the map, poor for an upstream PR |

Before recording: confirm the issue is still open and not assigned, comment on it first, and run `kula init` on the repo to time indexing.

## 4. Roadblocks and mitigations

- **curl | sh trust:** lead with `brew install`; publish sha256 checksums and signed release assets (cosign or GitHub artifact attestations); show the install script's line count; offer `cargo install` and direct binary downloads.
- **"Another AI tool" fatigue:** lead with the git/map value that works without any agent; agents come second. Avoid "AI-powered" in titles. State that there is no telemetry or account up front.
- **Windows:** say plainly what works (11 built-in languages, x64/arm64) and what does not (no packs). Offer winget/scoop later and track it in an issue.
- **Huge-repo demos:** commenters will try linux/chromium. Publish measured index times and memory on 3 sizes (small, medium, a large monorepo) and the known limits. Demo on a mid-size repo and link the benchmarks.
- **Graph accuracy challenges:** publish the resolution rules (already in the README) and a precision/recall check on one repo.
- **Fence-bypass attempts:** invite people to try; have a SECURITY.md and fix fast during launch week.
- **Scope confusion:** one-line pitch, 60-second demo, a "what kula is not" section.
- **Bus factor / solo maintainer:** be transparent; show CI, tests and the release cadence.

## Sources
- https://www.schneider.im/gitkraken-acquired-codesee
- https://www.cbinsights.com/company/codesee
- https://sk.linkedin.com/in/daniel-ivanyi-16845458
- https://www.flowjam.com/blog/how-to-get-on-the-front-page-of-hacker-news-in-2025-the-complete-up-to-date-playbook
- https://hub.causo.ai/guides/show-hn-launch-playbook-technical-founders-2026
- https://news.ycombinator.com/showhn.html
- https://axebps-redlib.hf.space/r/rust/wiki/rules
- https://console.dev/selection-criteria
- https://github.com/rust-lang/this-week-in-rust
- https://github.com/sharkdp/bat/issues/1341
- https://github.com/sharkdp/fd/issues/893
