# kula on a codebase

How kula is installed, set up per project, run day to day, and wired into CI.

## Install

| where | command |
|---|---|
| curl (macOS, Linux) | `curl -fsSL https://raw.githubusercontent.com/A12N4V/kula/main/scripts/install.sh \| sh` |
| Homebrew | `brew install A12N4V/tap/kula` |
| apt | the signed repository in the README, then `apt install kula` |
| npm (rolling out) | `npm i -g kula-cli`: a launcher plus the platform binary (`@kula-cli/<os>-<arch>`) |
| cargo | `cargo install --path .` (needs `web/dist`, built by `pnpm --dir web build`) |

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
5. `--agents`: merges `{"kula": {"command": "kula", "args": ["mcp"]}}` into `.mcp.json`, so Claude Code and other MCP clients can query the graph.
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
```

Every key is optional, and a repository without the file behaves exactly as before.

## The command line

The scheme is `kula <verb>`. Graph verbs answer questions, project verbs keep the setup honest, and anything kula doesn't know goes straight to git. Every graph and project verb takes `--json`.

| group | commands |
|---|---|
| project | `init` · `index [--if-stale] [--quiet]` · `hooks install\|uninstall\|status` · `doctor` |
| graph | `query` · `context` · `impact [--down]` · `trace` · `flows` · `clusters` · `deps` |
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

### `kula check`, the CI gate

Compares `HEAD` with a base through the graph. It reports files changed, symbols touched, the dependents they ripple into, the clusters crossed, and undeclared imports. It exits with status **2** when the risk is above `max_risk`:

```
kula check                          # base and gate from kula.toml
kula check --base origin/main --md  # markdown for a PR comment or job summary
```

The GitHub workflow that `init` writes puts that markdown into the job summary of every pull request. It installs kula with the curl installer.

## Tests

- `cargo test`: the CLI end to end on generated polyglot repositories (init, deps, check, hooks, the graph queries, MCP).
- `pnpm --dir web test:ui`: builds the UI and the binary, then drives the real app with Playwright (design language, graph, packages, code panel, loader, API auth, phone width). Set `PW_CHROMIUM` to use a local Chromium.
