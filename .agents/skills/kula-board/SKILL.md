---
name: kula-board
description: The swarm's message board. Every kula agent reads it at start and posts to it at hand-off.
---
- Read the board first: `kula note list` and `kula issue list` (stored in git, shared by every agent).
- Claim work: `kula issue` with your workflow name and scope in the title before starting.
- Post a hand-off note when done: commits, what changed, tests run, gaps, and who should pick up next.
- Blocked by a fence (e.g. web/src/ds): do not work around it. Open an issue tagged `ds` describing the change; the ds lead does it.
- Before editing a symbol run `kula before <symbol>`; after editing run `kula verify`.
