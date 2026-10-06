# kula on a codebase

How kula is installed, set up per project, run day to day, and wired into CI.

## Install

| where | command |
|---|---|
| curl (macOS, Linux) | `curl -fsSL https://raw.githubusercontent.com/A12N4V/kula/main/scripts/install.sh \| sh` |
| Homebrew | `brew install A12N4V/tap/kula` |
| apt | the signed repository in the README, then `apt install kula` |
| npm | `npm i -g kula-cli`: a launcher plus the platform binary (`@kula-cli/<os>-<arch>`) |
| pip | `pip install kula` · `uv tool install kula` · `pipx install kula` |
| cargo | `cargo install kula`, or `cargo install --path .` from a checkout (needs `web/dist`, built by `pnpm --dir web build`) |
| nix | `nix run github:A12N4V/kula` |

One binary. No server, no account. The UI is embedded.

## Set up a project: `kula init`

Like `npm init`, it runs once per repository, asks a few questions (or none with `-y`), and is safe to run again:

```
kula init            # interactive
kula init -y         # accept every default
kula init -y --hooks --agents --ci github
```

It does, in order:

1. `git init` if the directory isn't a repository yet (kula is a superset of git).
2. Writes **`kula.toml`**, the project's shared settings. Commit it.
3. Creates `.kula/`, which holds the graph database. It ignores itself (`.kula/.gitignore` is `*`), so your `.gitignore` is never touched.
4. `--hooks`: adds a marked block to `post-commit`, `post-checkout` and `post-merge` that runs `kula index --if-stale --quiet` in the background. Existing hooks are kept, and `core.hooksPath` is respected.
5. `--agents`: connects Claude Code (`.mcp.json` and a `PreToolUse` hook in `.claude/settings.json`), plus Cursor, Codex and Gemini CLI when their config directories exist, and writes the agent brief into `AGENTS.md`. See [AGENTS.md](AGENTS.md).
6. `--ci github|gitlab|none`: writes `.github/workflows/kula.yml` or `.kula-ci.yml`.
7. Builds the first graph (skip it with `--no-index`).

## `kula.toml`

```toml
[project]
name = "shop"
default_branch = "main"   # what proposals and `kula check` compare against

[index]
exclude = ["**/generated/**"]   # gitignore-style, on top of .gitignore
max_file_kb = 1024

[hooks]
reindex = true

[check]
max_risk = "medium"   # none | low | medium | high

[agents]
hide_secrets = true   # .env, keys, certificates never reach an agent
memory = true         # agents may `remember` facts about the code
docs = ["docs/ARCHITECTURE.md"]   # every agent reads these first

[[guard]]             # as many as you need
paths = ["migrations/**"]
symbols = ["charge_card", "src/billing.rs:refund"]
level = "locked"      # locked: read, never edit · hidden: never shown · review: flagged in check
reason = "money moves here; a person changes it"

[[workflow]]          # a work mode; reuse a built-in's name to replace it
name = "db-migrate"
about = "Schema changes, nothing else"
scope = ["migrations/**"]     # the default task scope
lock = ["src/db/pool.rs"]     # also: hide, review
memory = "read"               # write · read · off
steps = ["Write the migration and its rollback", "verify_edit; run the migration tests"]
docs = ["docs/MIGRATIONS.md"]
```

Every key is optional, and a repository without the file behaves exactly as before.

## The command line

The scheme is `kula <verb>`. Graph verbs answer questions, project verbs keep the setup honest, and anything kula doesn't know goes straight to git. Every graph and project verb takes `--json`.

| group | commands |
|---|---|
| project | `init` · `index [--if-stale] [--quiet]` · `hooks install\|uninstall\|status` · `doctor` |
| graph | `query` · `context` · `impact [--down]` · `trace` · `flows` · `clusters` · `deps` |
| agents | `agents status\|connect\|sync\|brief\|suggestions\|accept\|dismiss` · `workflow list\|show\|install\|prompt` · `task start [-w workflow]\|show\|done` · `guard list\|check\|hook\|commit` · `memory add\|recall\|edit\|stale\|confirm\|rm` · `pack` · `before` · `verify` · `run -w <workflow> -- <agent>…` · `team save\|start\|stop\|list` · `research init\|start\|try\|status\|stop` (and the MCP tools of the same purpose) |
| knowledge graph | `kg export [-f ttl\|nt\|jsonld\|rdfxml]` · `kg sparql <query\|@file\|->` · `kg examples` |
| review | `compare` · `graph-diff` · `check` · `pr` · `issue` · `note` · `sync` |
| surfaces | `view` (web UI) · `mcp` (agents over stdio) · `status` · `lg` |
| git | anything else: `kula commit -am …`, `kula rebase -i`, or `kula git <args>` |

### `kula deps`

Joins the graph's imports with every manifest in the tree (`package.json`, `Cargo.toml`, `pyproject.toml`, `requirements*.txt`, `go.mod`):

```
kula deps                # every package: importers, declared/unused/undeclared/builtin
kula deps --undeclared   # imported but in no manifest – usually a missing dependency
kula deps --unused       # declared but never imported by indexed code
```

Standard-library and runtime modules (`node:fs`, `std`, `os`, Go's stdlib) are marked builtin and never flagged.

### For agents: `pack`, `before`, `verify`

These three are the reason to hand an agent kula rather than grep. They're on the CLI and, under the same names, as MCP tools (`context_pack`, `pre_edit`, `verify_edit`) once `kula init --agents` has registered the server.

```
kula pack "how does login validate a token" --budget 6000
kula before hashToken
kula verify
```

- **`pack`**: takes symbols, files or a plain-language question and returns the code that explains them, not whole files. That's their definitions, what they call, who calls them, their containing class and the tests that reach them, ranked by graph distance and fitted to a token budget. Bodies too large for the budget shrink to signatures, and anything left out is listed by name.
- **`before`**: run before changing a symbol. It lists direct callers, the total dependents and risk, the tests that reach the symbol through the call graph, files that historically change in the same commits, human notes, and concrete advice.
- **`verify`**: run after editing. It compares the working tree with HEAD through the graph: symbols added, removed or modified, callers still pointing at removed code (exit **2**), and callers of modified symbols in other files to re-read.

### Workflows, guards, tasks and memory

```
kula agents connect all                  # Claude Code, Cursor, Codex, Gemini CLI: MCP + the hook
kula agents sync                         # the brief (tools, fences, workflows) into AGENTS.md
kula workflow list                       # explore · fix · refactor · tests · docs · yours
kula workflow show refactor              # its fences, scope, steps, docs, memory policy
kula task start "split auth" --workflow refactor

kula guard list                          # rules, the task, every fenced file
kula guard check src/billing.rs          # exit 1 if an agent may not edit it
kula guard check --staged                # the same for what's staged
echo '{"tool_name":"Edit","tool_input":{"file_path":"migrations/001.sql"}}' | kula guard hook   # exit 2 + reason

kula task start "speed up login" --scope "src/auth/**" login
kula task done

kula memory add charge_card "amounts are integer cents; never floats"
kula memory recall charge_card           # its own, its file's, its callers' and callees'
kula memory recall --query cents
kula memory confirm 12                   # still true after the code changed: re-anchor it
kula memory edit 12 "amounts are integer cents" --target src/pay.rs:charge
kula memory stale 12                     # flag it without forgetting it
kula agents suggestions                  # fences and workflows agents proposed
kula agents accept 3                     # into kula.toml
```

Verdicts, strongest first: **hidden** (never read or edited, left out of every agent answer), **locked** (read, never edited), **scope** (outside the active task), **review** (editable, flagged by `check`). A workflow's fences sit on top of these while a task runs in it. `kula guard hook` reads the tool call of Claude Code, Cursor, Codex (`apply_patch`) or Gemini CLI as JSON on stdin and exits 2 with the reason on stderr to block it; `kula agents connect` registers it in each agent's own format. Shell commands an agent runs are not parsed – the hook fences file tools, MCP fences answers, and `check` is the backstop. The full model is in [AGENTS.md](AGENTS.md).

### Enforcement for any harness, teams and autoresearch

```sh
kula run -w fix --agent aider -- aider        # any agent CLI, held to the fences for the run (exit 3: something was put back)
kula workflow install refactor                 # as a Claude Code subagent, a Cursor rule, a Gemini command
kula workflow prompt refactor                  # as instructions for any system prompt
kula guard commit                              # the pre-commit check (installed by `kula hooks install`)

kula team save ship -m claude=autoresearch:"speed up the indexer" -m cursor=tests -m codex=explore:review
kula team start ship                           # each agent in its own workflow · kula team stop · kula team list

kula research init --metric "<command>" --goal min --scope "src/index/**" --budget 40
kula research start [workflow] [--here]        # baseline, on a research/ branch
kula research try "<hypothesis>"               # one experiment: measured, kept or reverted
kula research status                           # baseline, best, every experiment · kula research stop
```

### `kula kg`, the graph as RDF

```
kula kg export -f ttl -o graph.ttl
kula kg sparql 'ASK { ?n a kula:Memory ; kula:stale true }'
kula kg sparql @queries/hubs.rq --json
```

Prefixes `kula:`, `code:` (`urn:kula:`), `rdf:`, `rdfs:` and `xsd:` are predeclared. `SELECT ?t ?doc { ?t rdfs:comment ?doc }` lists the vocabulary. Queries are read only; hidden code is not in the graph.

### `kula check`, the CI gate

Compares `HEAD` with a base through the graph. It reports files changed, symbols touched, the dependents they ripple into, the clusters crossed, and undeclared imports. It exits with status **2** when the risk is above `max_risk`, or when the change touches code a `[[guard]]` marks locked or hidden:

```
kula check                          # base and gate from kula.toml
kula check --base origin/main --md  # markdown for a PR comment or job summary
```

The GitHub workflow that `init` writes puts that markdown into the job summary of every pull request. It installs kula with the curl installer.

## Tests

- `cargo test`: the CLI end to end on generated polyglot repositories (init, deps, check, hooks, the graph queries, MCP).
- `pnpm --dir web test:ui`: builds the UI and the binary, then drives the real app with Playwright (design language, graph, packages, code panel, loader, API auth, phone width). Set `PW_CHROMIUM` to use a local Chromium.
