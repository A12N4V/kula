---
name: kula-test-rules
description: How to build and test kula on the 16 GB dev Mac without crashing it.
---
- Before any build or test: `~/Desktop/projects/homonin/homonin-scripts/storage/memguard.sh`; exit 1 means wait.
- One heavy job at a time. cargo with `-j 4`, never alongside Playwright or vite build.
- Web build (needed before e2e): `cd web && NODE_OPTIONS=--max-old-space-size=2048 npx vite build`.
- e2e, affected specs only: `cd web && KULA_NO_AGENT=1 KULA_NO_NET=1 npx playwright test e2e/ui.spec.ts --workers=2 --reporter=line -g <pattern>`.
- After tests: `git checkout -- kula.toml; pkill -f ms-playwright; pkill -f chrome-headless`.
- Tests never spawn agents (KULA_NO_AGENT=1). Never git stash, never push, never commit test churn in kula.toml.
- Commits: `git -c user.name=arnav -c user.email=arnavs15@uci.edu commit`, no attribution lines.
