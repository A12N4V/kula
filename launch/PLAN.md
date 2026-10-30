# kula launch plan

Goal: get developers to try kula and send frontend, backend and algorithm feedback, then grow into a known dev tool.
Order: product green → repo → promo → bootcamp → feedback loop → launch → follow-through. Platform research is in research.md.

## 1 – Product readiness
- **Now:** fuse5-w3 has 34 failing and 7 flaky desktop e2e tests after wave 3 (map settings popover, inspector, memory grouping, teams). Test fixtures leaked about 10 GB into /tmp; fixed in a4a056f.
- **Roadblocks:**
  - Regressions stacking up.
  - The suite takes 1h with retries.
  - Flaky tests.
- **Plan:**
  - A fix agent clears the failures. Then fast-forward team/fuse5 and open a PR; merging to main needs the user's approval.
  - Cut 0.3.1 as the launch build.
  - Shard the suite to get under 20 min.
  - Quarantine flaky tests (`test.fixme` plus an issue) instead of relying on retries.
- **Gate:** green desktop and visual suites, plus a fresh-repo smoke test on macOS, Linux and Windows.

## 2 – Repo for attention
- **Now:** the README has a hero, badges, a 60s path and a promo.gif, but it runs to 488 lines and the first screen sells features rather than an outcome.
- **Roadblocks:**
  - Fatigue with "another AI tool".
  - Wall-of-text bounce.
  - Distrust of curl | sh.
- **Plan:**
  - Lead with one outcome sentence and put the GIF above the fold.
  - Show the brew install first, and give curl checksums.
  - Lead with what kula does with no agent at all, and say "no account, no telemetry" up front.
  - Cut the README to about 150 lines and move the rest to docs/.
  - Add a "kula vs X" table and a "Known limits" section: tree-sitter heuristics, Windows gaps, fences only as strong as each agent's hooks.
- **Done:** issue templates for frontend, backend, algorithm and bugs, with a link to Discussions.
- **Needs the user:**
  - Enable Discussions.
  - Upload a social preview image.
  - Pin 5 good-first issues.

## 3 – Promo visuals
- **Assets:**
  - A 45s hero video and GIF: map → drill in → spawn a team → a fence blocks an out-of-scope edit → a PR appears.
  - 4 stills.
  - A 1200x630 social card.
  - A 15s vertical cut.
- **Roadblocks:**
  - Toy repos look fake.
  - Agent runs are slow and cost money on camera.
  - The visuals drift after each wave.
- **Plan:**
  - Record on the bootcamp library, so the promo and the bootcamp tell one story.
  - Script the recording with Playwright plus a replayed agent run: deterministic and zero cost per take.
  - Shoot after layer 1 is green.

## 4 – Bootcamp (1–2h)
- **Pick:** sharkdp/bat, issue #1341 (custom fallback syntax opt-in), with #1618 as backup. Second choice: sharkdp/fd. Verify both issues are still open on the day.
- **Shape:**
  - Clone, then `kula init` and `kula view`.
  - Read the map and find where syntax selection lives.
  - Fence an agent team to that module and implement.
  - Review the diff in kula, run `cargo test`, and open an upstream PR.
- **Roadblocks:**
  - Slow first index.
  - The feature may not be upstreamable.
  - Agent nondeterminism.
  - Attendees without API keys.
- **Plan:**
  - Dry-run it twice and record the times.
  - Make a checkpoint branch for each step.
  - Offer a no-agent path where a human edits using the map.
  - Publish measured index time and memory use for the repo.
- **Output:** docs/bootcamp.md, a blog post and an optional live stream.

## 5 – Feedback loop
- **Plan:**
  - Issue templates (done).
  - Discussions categories: Show your map, Ideas, Q&A.
  - An optional `kula feedback` command that opens a prefilled issue, with no telemetry.
  - A weekly triage note in CHANGELOG.
- **Roadblock:** silence. Every launch post asks a specific question, e.g. "is the fence model right for your team?". Invite people to try bypassing the fences and fix what they find fast.

## 6 – Launch across platforms
- **Drafts:** written by the launch team (research → writer → critic) in launch/posts/.
- **Order:**
  1. Soft launch on r/rust, for early bugs.
  2. Show HN on a Tue–Thu, 8–10am ET, with a technical first comment within 5 min, then reply for 3h.
  3. The same day: X, Bluesky and r/ClaudeAI.
  4. Newsletters: This Week in Rust (PR), Console.dev (email).
  5. The bootcamp post a week later as a second wave.
- **Skip:** Product Hunt (low value for an OSS CLI). Lobsters needs an invite.
- **Roadblock:** one spike, then silence. Plan: a weekly changelog post for 4 weeks, driven by feedback.

## 7 – Packaging
- **Now:** a brew tap, a curl installer, and 6 targets.
- **Next:**
  - `cargo install` (check the crate name).
  - An `npx` wrapper.
  - winget or scoop.
  - A notarized macOS binary.
  - homebrew-core once the repo meets its star threshold.

## Status
| Layer | State |
|---|---|
| 1 Product | fix agent running |
| 2 Repo | templates done; README cut next |
| 3 Promo | waits on 1 |
| 4 Bootcamp | bat picked; dry-run pending |
| 5 Feedback | templates done; Discussions needs the user |
| 6 Launch | writer and critic drafting |
| 7 Packaging | planned |
