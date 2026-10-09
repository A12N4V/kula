<p align="center">
  <img src="docs/assets/hero.svg" alt="kula 1.0: git, with a map, for you and your agents" width="100%">
</p>

<p align="center">
  <a href="https://github.com/A12N4V/kula/actions/workflows/ci.yml"><img alt="ci" src="https://github.com/A12N4V/kula/actions/workflows/ci.yml/badge.svg"></a>
  <a href="../../releases"><img alt="version" src="https://img.shields.io/badge/version-1.0.2-f97f3a?style=flat-square&labelColor=000000"></a>
  <a href="LICENSE"><img alt="license GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-f97f3a?style=flat-square&labelColor=000000"></a>
  <img alt="rust" src="https://img.shields.io/badge/core-rust-e8e2d9?style=flat-square&labelColor=000000&logo=rust&logoColor=e8e2d9">
  <img alt="mcp" src="https://img.shields.io/badge/MCP-21%20tools-8fd694?style=flat-square&labelColor=000000">
  <img alt="agents" src="https://img.shields.io/badge/agents-Claude%20Code%20·%20Cursor%20·%20Codex%20·%20Gemini-8fd694?style=flat-square&labelColor=000000">
  <img alt="languages" src="https://img.shields.io/badge/parses-11%20languages-7cb7ff?style=flat-square&labelColor=000000">
  <img alt="rdf" src="https://img.shields.io/badge/graph-RDF%20·%20SPARQL%201.1-d49cf0?style=flat-square&labelColor=000000">
  <img alt="platforms" src="https://img.shields.io/badge/macOS%20·%20Linux%20·%20Windows-x64%20·%20arm64-e8e2d9?style=flat-square&labelColor=000000">
  <img alt="local-first" src="https://img.shields.io/badge/local--first-no%20account%20·%20no%20telemetry-e8e2d9?style=flat-square&labelColor=000000">
</p>

<p align="center">
  <b>Kula turns a git repository into a knowledge graph, and puts it to work for you and for your AI agents.</b><br>
  Every git command · a graph of your code · architectural review · issues, proposals and notes stored in git ·<br>
  agent workflows, fences and memory anchored to the code · the whole graph as RDF. One binary. No server. No account.
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#sixty-seconds">60 seconds</a> ·
  <a href="#why-kula">Why</a> ·
  <a href="#for-ai-agents">Agents</a> ·
  <a href="#the-ui">UI</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="docs/">Docs</a>
</p>

<img src="docs/assets/divider.svg" width="100%" alt="">

```sh
curl -fsSL https://raw.githubusercontent.com/A12N4V/kula/main/scripts/install.sh | sh
cd your-repo && kula init        # kula.toml, git hooks, agents connected, first graph
kula view                        # the map, at http://localhost:7420
```

<p align="center"><img src="docs/assets/promo.gif" alt="Cursor tries three ways round kula's fences (an edit, sed, ending the task) and is refused each time, then bumps the version" width="100%"></p>
<p align="center"><sub>Cursor, inside the <a href="docs/assets/promo.mp4">two-minute launch film</a>. Watch it with sound. Made in <a href="promo/">promo/</a> from the real app and a real Claude Code + Cursor session: Remotion, an original score, three voices.</sub></p>

## Why kula

AI writes a growing share of the code, and the people shipping it trust it less every year. In the [Stack Overflow 2025 Developer Survey](https://survey.stackoverflow.co/2025/ai), **84%** of developers use or plan to use AI tools, **46%** distrust their accuracy (33% trust it), and the most common complaint, at **66%**, is code that is *almost right, but not quite*. The gap is context and control: an agent greps a codebase it cannot see the shape of, edits code it should never touch, and forgets what it learned between sessions. And the review that has to catch all of this still reads diffs line by line.

Developer tooling splits into camps, and each leaves part of that gap open:

| camp | examples | good at | the gap |
|---|---|---|---|
| git clients | GitKraken, Fork, Tower, lazygit | branches, staging, history | show *text* changes; no idea what the code means or what a change breaks |
| code-graph engines | Sourcegraph, GitNexus | call graphs, code intelligence | not a git client; server-first or non-commercial licences |
| forges | GitHub, GitLab, Gitea | issues, PRs, review | need a server and an account; review is line by line, not architectural |
| agent memory | mem0, TencentDB Agent Memory | long-term memory for assistants | built around conversations; vector stores that never learn the code changed |
| agent guardrails | Claude Code permissions, Cursor rules, leash | allow and deny lists | paths only: a rule can't name a function, follow it when it moves, or change with the kind of work |

Kula is the one place where those meet, because they all need the same thing: a graph of the code that stays current with git:

1. **Workflows for agents.** `explore`, `fix`, `refactor`, `tests`, `docs` and your own: each a work mode with its own fences, scope, steps, docs and memory policy. A refactor can't touch the tests that define "unchanged"; a test-writing session can't "fix" the code under test.
2. **Fences that know the code.** Lock a *symbol*, not just a path; hide secrets; scope a task to part of the graph. One verdict serves MCP, a pre-edit hook in Claude Code, Cursor, Codex and Gemini CLI, and the CI gate.
3. **Memory anchored to code.** What an agent learns is pinned to the function it describes, stored in git, and marked **stale** the moment that function changes.
4. **Architectural review.** `graph-diff` and Contrast show what a branch does to the *structure*: symbols gained, lost and rewritten, call edges added and cut, blast radius by risk.
5. **Offline collaboration.** Proposals, issues, notes and memories are git objects on `refs/kula/meta`: they work on a plane and sync through any remote.
6. **A graph you can take with you.** The whole graph is RDF under a published vocabulary: export Turtle or JSON-LD, or ask it anything in SPARQL.

## Install

One static binary with the web UI embedded. The only runtime dependency is `git`.

| | command |
|---|---|
| **curl** (macOS, Linux) | `curl -fsSL https://raw.githubusercontent.com/A12N4V/kula/main/scripts/install.sh \| sh` |
| **Homebrew** | `brew install kula`, after a one-time `brew tap a12n4v/tap` |
| **apt** (Debian, Ubuntu) | `sudo apt install kula`, after adding the signed repository (below) |
| **npm · pnpm · bun** | `npm i -g kula-cli` · `pnpm add -g kula-cli` · `bunx kula-cli` |
| **pip · uv · pipx** | `pip install kula` · `uv tool install kula` · `pipx install kula` |
| **cargo** | `cargo install kula` |
| **nix** | `nix run github:A12N4V/kula` · `nix profile install github:A12N4V/kula` |
| **binaries** | macOS (arm64, x64), Linux (x64, arm64), Windows (x64) and `.deb` on [Releases](../../releases) |
| **source** | `pnpm -C web install && pnpm -C web build && cargo install --path .` |

<details>
<summary><b>The apt repository</b>: add it once, then <code>apt install</code> and <code>apt upgrade</code> as usual</summary>

```bash
curl -fsSL https://a12n4v.github.io/kula/kula.gpg | sudo tee /usr/share/keyrings/kula.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/kula.gpg] https://a12n4v.github.io/kula/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/kula.list
sudo apt update && sudo apt install kula
```
</details>

## Sixty seconds

```bash
cd your-repo
kula init                          # kula.toml · git hooks · agents connected · first graph
kula view                          # graph + git UI → http://localhost:7420
kula impact parseConfig            # what breaks if I change this?
kula graph-diff main WORKTREE      # what my uncommitted work does to the architecture
kula task start "split auth" -w refactor   # agents may restructure; tests are locked
kula commit -am "ship it"          # …and it's still just git
```

<p align="center"><img src="docs/assets/terminal.svg" alt="Animated terminal session" width="92%"></p>

## For AI agents

<p align="center"><img src="docs/assets/agent-loop.svg" alt="The agent loop: workflows → context_pack → pre_edit → edit, checked by the fence hook → verify_edit → remember" width="100%"></p>

```sh
kula agents connect all     # Claude Code, Cursor, Codex, Gemini CLI: MCP server + pre-edit hook, in each one's own format
kula agents sync            # a brief of tools, fences and workflows in AGENTS.md, for every other agent
```

| agent | connected through |
|---|---|
| Claude Code | `.mcp.json` · `PreToolUse` on edits, reads and `Bash` in `.claude/settings.json` |
| Cursor | `.cursor/mcp.json` · `preToolUse`, `beforeReadFile` and `beforeShellExecution` in `.cursor/hooks.json` |
| Codex | `[mcp_servers.kula]` in `.codex/config.toml` · `PreToolUse` on `apply_patch` and `shell` in `.codex/hooks.json` |
| Gemini CLI | `mcpServers` and a `BeforeTool` hook on file tools and `run_shell_command` in `.gemini/settings.json` |
| Windsurf, Zed, Copilot, Continue, Cline, Goose, Amp, … | `kula mcp` over stdio, the brief in `AGENTS.md` |
| Aider, OpenCode, a script, anything | `kula run -w <workflow> -- <command>` |

### Enforced, not advised

Fences are not a paragraph in a prompt. Every way an agent can change code meets the same verdict:

| how an agent acts | what holds it |
|---|---|
| a file tool: Edit, Write, apply_patch, write_file | the pre-tool hook refuses the call and tells the agent why |
| a shell command: `rm`, `mv`, `sed -i`, `> file`, `tee`, `git rm` | the same hook reads the command for every file it writes or reads |
| switching kula off: editing `kula.toml` or a hook, `kula task done`, `git commit --no-verify` | refused: kula's own config is locked for agents, always; they may `suggest` |
| a commit | the git `pre-commit` hook refuses an agent's commit that holds fenced changes |
| a harness kula doesn't know | `kula run` makes fenced files read-only for the run (hidden ones unreadable) and puts back anything fenced it changed; the agent's version is kept in `.kula/run/` |
| a branch | `kula check` fails it in CI |

### Workflows

A workflow is a work mode. Start a task in one and its fences, scope, steps, docs and memory policy apply to every agent until the task is done.

```sh
kula workflow list
kula task start "split the auth module" --workflow refactor
```

| workflow | for | fences | memory |
|---|---|---|---|
| `explore` | read and explain; change nothing | everything locked | write |
| `fix` | the smallest change that holds | – | write |
| `refactor` | restructure without changing behaviour | tests locked | write |
| `tests` | write tests; leave the code under test alone | only tests editable | write |
| `docs` | documentation, no code | only docs editable | read |
| `autoresearch` | an experiment loop: change, measure, keep what's better | its scope | write |
| *yours* | anything, via `[[workflow]]` in `kula.toml` | `scope` · `lock` · `hide` · `review` | write · read · off |

```toml
[[workflow]]
name = "db-migrate"
about = "Schema changes, nothing else"
scope = ["migrations/**"]
lock = ["src/db/pool.rs"]
memory = "read"
steps = ["Write the migration and its rollback", "pre_edit every query on the changed tables", "verify_edit"]
docs = ["docs/MIGRATIONS.md"]
```

Any harness can work in any workflow: through MCP and the hooks, under `kula run -w <name>`, or as the agent's own file: `kula workflow install <name>` writes it as a Claude Code subagent (`.claude/agents/`), a Cursor rule (`.cursor/rules/`) and a Gemini CLI command (`/kula:<name>`).

### Autoresearch

Give an agent a number to move (test time, bundle size, p95 latency, validation loss) and the code it may change. It forms a hypothesis, edits, and calls `experiment`: kula checks the change against the fences, **runs the metric itself**, commits the change when the number improves and reverts it when it doesn't. Agents never report their own scores, every kept step is a commit you can read, and memories carry what worked into the next run.

```sh
kula research init --metric "cargo bench --bench index 2>&1 | grep -o '[0-9.]* ms' | tail -1" --goal min --scope "src/index/**" --budget 40
kula research start                 # the baseline, on a research/ branch
kula research try "cache the parser per language"   # or the agent's `experiment` tool
kula research status                # baseline, best, every experiment
```

```mermaid
flowchart LR
    R[research<br/>baseline · best · what failed] --> H[one hypothesis]
    H --> E[edit, in scope<br/>fenced by the hook]
    E --> X[experiment<br/>kula runs the metric]
    X -->|better| K[kept as a commit]
    X -->|worse · failed · fenced| V[reverted]
    K --> M[remember why]
    V --> M
    M --> R
```

### Teams

A team gives every agent its own workflow, and the hook holds each one to its own: Claude Code on an autoresearch loop, Cursor writing tests, Codex reviewing read-only – at the same time, in one checkout.

```sh
kula team save ship --lead claude -m claude=autoresearch:"speed up the indexer" -m cursor=tests -m codex=explore:review
kula team prompt ship codex     # the team's prompt, its own, its place, its workflow
kula team start ship
```

Teams carry a hierarchy (who leads, who answers to whom), hand-offs, and system prompts for the team and each agent; Agents › Teams draws them on the same renderer as the code graph, tinted by workflow. Start one from a template (ship a feature, bug hunt, research swarm, safe refactor, docs pass) and rewire it by dragging one member onto another.

### Skills

One set of skills for every agent, kept in git. Each lives in `.agents/skills/<name>/SKILL.md`, which Codex reads directly; kula writes the same skill where Claude Code, Gemini CLI and Cursor look for theirs. A skill only one agent has can be adopted into the shared set.

```sh
kula skill new release-notes -d "Write release notes from the commits since the last tag"
kula skill list                 # each skill, and whether each agent has the current copy
kula skill adopt claude triage  # take an agent's own skill into the shared set
kula skill sync                 # write every skill where each agent reads it
```

When an agent's copy of a skill was edited locally, `kula skill list` shows it as `differs`; Agents › Skills shows the diff – the agent's copy against the source – before a sync overwrites it. The tab also shows which workflows and teams mention a skill, and the skill's own files.

### Agent config: MCP and rules

TeamAI-CLI-style parity beyond skills: every agent's MCP servers (`.mcp.json` for Claude Code, `.cursor/mcp.json` for Cursor, `.gemini/settings.json` for Gemini CLI, `.codex/config.toml` for Codex) and rules files (`CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, `.cursor/rules/`) are read where each one lies, and shown against the shared source in `.agents/mcp.json`. Syncing writes one server definition out to every agent and never clobbers the rest of their config.

```sh
kula agents mcp          # the matrix: MCP servers and rules per agent vs the source
kula agents mcp kula     # sync the kula server from .agents/mcp.json to every agent
```

Agent memories carry layers derived at read time, no new storage: each memory is labelled with its scope – `task` when its target is inside the active task's scope, else `workflow` when inside a workflow's scope, else `repo` – and its provenance: the agent that wrote it, the commit on `refs/kula/meta` that introduced it, and the symbol or file it is anchored to. Agents › Skills shows the table.

### Fences

```toml
[[guard]]
paths = ["migrations/**"]
level = "locked"          # read, never edit
reason = "schema changes go through the DBA"

[[guard]]
symbols = ["src/billing.rs:charge_card"]
level = "review"          # editable; kula check lists it for a person

[[guard]]
paths = ["data/customers/**"]
level = "hidden"          # never shown to an agent, in any answer
```

```mermaid
flowchart LR
    T[kula.toml<br/>fences · workflows] --> V{{one verdict<br/>per path and symbol}}
    K[.kula/task.json<br/>task · scope · workflow] --> V
    S[secrets<br/>.env · keys · certs] --> V
    V --> M[MCP answers<br/>hidden code left out]
    V --> H[pre-tool hook<br/>edits, reads, shell, refused with the reason]
    V --> P[pre-commit hook<br/>an agent's fenced commit refused]
    V --> R[kula run<br/>any harness, held for the run]
    V --> E[verify_edit<br/>reports what slipped]
    V --> C[kula check<br/>fails the branch in CI]
    V --> U[UI<br/>fences on the graph]
```

The strongest level wins: `hidden > locked > scope > review > open`, so a task can narrow what kula.toml allows, never widen it. Likely secrets are hidden by default. Agents can **suggest** a fence or a workflow over MCP; only a person accepts it into kula.toml.

### Memory

```sh
kula memory add login "tokens are hashed twice for legacy clients"
kula memory recall login       # its own, its file's, its callers' and callees', the repo's
```

```mermaid
stateDiagram-v2
    direction LR
    [*] --> fresh: remember, anchored to a hash of the code
    fresh --> stale: the code changes
    stale --> fresh: confirm, re-anchored
    fresh --> [*]: forget
    stale --> [*]: forget
```

A memory is one fact pinned to a symbol, a file or the repo, stored with the notes in git. Recall ranks by the graph, not by text similarity. When the code changes, the memory comes back **stale** instead of being trusted silently.

### Tools

| MCP tool | |
|---|---|
| `workflows` · `start_task` · `finish_task` | how this kind of work is done here, and the agent's place in the team; declare a task in a workflow |
| `research` · `experiment` | an autoresearch loop: kula runs the metric, keeps what's better, reverts the rest |
| `context_pack` | the code a task needs (definitions, what they use, who uses them, tests), ranked by graph distance and fitted to a token budget |
| `pre_edit` · `verify_edit` | before a change: callers, the tests that reach it, risk, the fence verdict, memories. After: what moved, what broke, what was fenced |
| `guards` | what the agent may change, and why |
| `remember` · `recall` · `update_memory` | facts about the code that go stale when it changes |
| `suggest` | propose a fence or a workflow; a person decides |
| `sparql` | any structural question over the whole graph |
| `query` · `context` · `impact` · `trace` · `compare` · `graph_diff` · `flows` · `notes` · `issues` | the graph itself |

The full model (levels, the hook protocol per agent, recall ranking, the brief) is in [docs/AGENTS.md](docs/AGENTS.md).

<img src="docs/assets/divider.svg" width="100%" alt="">

## The UI

`kula view` serves a local app at **localhost:7420**: loopback only, with a per-session token.

<table>
<tr><td colspan="2">
<img src="docs/assets/ui-agents.png" alt="Agents overview">
<p align="center"><b>Agents.</b> The task and its workflow, the agent loop with the fence gate, the workflow's steps, and everything agents left for a person: suggestions to accept, stale memories to confirm, briefs that fell behind kula.toml.</p>
</td></tr>
<tr>
<td width="50%"><img src="docs/assets/ui-agents-workflows.png" alt="Workflows editor"><p align="center"><b>Workflows.</b> Built-ins and your own. Fences as chips with autofill, steps in order, memory as a switch. Saving writes <code>kula.toml</code>.</p></td>
<td width="50%"><img src="docs/assets/ui-workflow-preview.png" alt="Workflow preview on the graph"><p align="center"><b>Preview a workflow.</b> What <code>refactor</code> would fence, drawn on the graph before anything starts: tests locked, lockfiles for review.</p></td>
</tr>
<tr>
<td><img src="docs/assets/ui-agents-fences.png" alt="Fences editor"><p align="center"><b>Fences.</b> Every <code>[[guard]]</code>, editable in place; agents' suggestions to accept; what's fenced right now and by which rule.</p></td>
<td><img src="docs/assets/ui-agents-memory.png" alt="Memory"><p align="center"><b>Memory.</b> Rewrite, retarget, mark stale, confirm or forget any memory. Stale ones first.</p></td>
</tr>
<tr>
<td><img src="docs/assets/ui-agents-docs.png" alt="Docs agents read"><p align="center"><b>Docs.</b> AGENTS.md, CLAUDE.md and the docs each workflow points at, edited in place; the generated brief kept in sync.</p></td>
<td><img src="docs/assets/ui-agents-connect.png" alt="Connect agents"><p align="center"><b>Connect.</b> One click per agent, in its own config format. Anything else speaks MCP.</p></td>
</tr>
<tr><td colspan="2">
<img src="docs/assets/ui-graph.png" alt="Graph view">
<p align="center"><b>Graph.</b> Every function, class and file. Each directory settles into its own territory; the most connected symbols become tiles that carry their kind. Right-click a symbol for its actions, <kbd>⇧</kbd>-click another to light the shortest path, <kbd>f</kbd> for fences. WebGL, so thousands of nodes stay smooth.</p>
</td></tr>
<tr><td colspan="2">
<img src="docs/assets/ui-contrast.png" alt="Contrast view">
<p align="center"><b>Contrast.</b> Any two branches, tags, commits or your working tree, as an overlay, side by side, or a report. Changed symbols become tiles marked <code>+</code> <code>−</code> <code>~</code>; their neighbours stay lit.</p>
</td></tr>
<tr>
<td><img src="docs/assets/ui-impact.png" alt="Impact"><p align="center"><b>Impact.</b> The blast radius of any symbol, shaded by depth and graded by risk.</p></td>
<td><img src="docs/assets/ui-fences.png" alt="Fences on the graph"><p align="center"><b>Fences.</b> Locked and hidden code in colour, the task's scope lit, the rest receding.</p></td>
</tr>
<tr>
<td><img src="docs/assets/ui-overview.png" alt="Overview"><p align="center"><b>Overview.</b> Proposals by risk, issues, branches, hotspots, and a directory coupling matrix with loops marked.</p></td>
<td><img src="docs/assets/ui-autofill.png" alt="Notes autofill"><p align="center"><b>Autofill.</b> Notes and memories offer what you were just looking at: the symbol, its file, its siblings. <kbd>Tab</kbd> takes the completion; <code>[[</code> links a symbol.</p></td>
</tr>
<tr>
<td><img src="docs/assets/ui-query.png" alt="Query"><p align="center"><b>Query.</b> SPARQL over the graph, with examples and the vocabulary beside it; results open in the map.</p></td>
<td><img src="docs/assets/ui-console.png" alt="Console"><p align="center"><b>Console.</b> A terminal that runs kula itself: its commands and every git command – in tabs.</p></td>
</tr>
<tr>
<td><img src="docs/assets/ui-proposal.png" alt="Proposals"><p align="center"><b>Proposals.</b> Pull requests that live in your repo: thread, graph impact, merge.</p></td>
<td><img src="docs/assets/ui-history.png" alt="History"><p align="center"><b>History.</b> Every branch as lanes. Contrast any commit with its parent, cherry-pick, revert, tag.</p></td>
</tr>
</table>

<details>
<summary><b>More of the UI</b>: split view, report, changes, compare, issues, notes, the opening</summary>

| | |
|---|---|
| <img src="docs/assets/ui-split.png" alt="Side by side"> | <img src="docs/assets/ui-report.png" alt="Report"> |
| <img src="docs/assets/ui-changes.png" alt="Changes"> | <img src="docs/assets/ui-compare.png" alt="Compare"> |
| <img src="docs/assets/ui-issues.png" alt="Issues"> | <img src="docs/assets/ui-notes.png" alt="Notes"> |
| <img src="docs/assets/ui-opening.png" alt="Opening"> | |
</details>

**Getting around:** <kbd>⌘K</kbd> searches everything (`#` issues, `@` branches, `>` commands); <kbd>1</kbd>–<kbd>9</kbd>, <kbd>0</kbd>, <kbd>a</kbd>, <kbd>q</kbd> switch views; <kbd>⌥←</kbd> <kbd>⌥→</kbd> and the browser's back and forward walk through views and tabs; <kbd>[</kbd> <kbd>]</kbd> through inspected symbols; <kbd>?</kbd> lists every shortcut. Every place has a shareable URL: `#graph/<id>/impact`, `#graph/fences/refactor`, `#agents/memory`, `#issues/3`.

## Commands

Kula is a **superset of git**: anything it doesn't know goes straight to `git`, so `kula rebase -i`, `kula bisect` and `kula lfs pull` all work. Every graph command takes `--json`; `-C <path>` works like git's.

| | |
|---|---|
| **start** | `init` · `index` · `view` · `status` · `hooks install\|uninstall\|status` · `doctor` |
| **explore** | `query` · `context` · `impact [--down]` · `trace` · `flows` · `clusters` · `deps` · `kg export\|sparql\|examples` |
| **review** | `lg` · `compare` · `graph-diff` · `check [--md]` |
| **agents** | `agents status\|connect\|sync\|brief\|suggestions\|accept\|dismiss` · `workflow list\|show\|install\|prompt` · `task start [-w]\|show\|done` · `guard list\|check\|hook\|commit` · `memory add\|recall\|edit\|stale\|confirm\|rm` · `pack` · `before` · `verify` · `mcp` |
| **enforce & research** | `run -w <workflow> -- <agent>` · `team save\|start\|stop\|list` · `research init\|start\|try\|status\|stop` |
| **collaborate** | `issue` · `pr` · `note` · `sync` |

The full reference, `kula.toml` and CI are in [docs/CLI.md](docs/CLI.md).

## The knowledge graph as RDF

```sh
kula kg export -f jsonld -o graph.jsonld        # ttl · nt · jsonld · rdfxml
kula kg sparql 'SELECT ?name (COUNT(?c) AS ?callers) WHERE {
  ?s a kula:Function ; kula:name ?name . ?c kula:calls ?s
} GROUP BY ?name ORDER BY DESC(?callers) LIMIT 10'
```

Symbols, files, packages, clusters, calls and imports, plus the notes, memories, issues and fences attached to them, under `kula:` (`https://kula.dev/ns#`) with stable `urn:kula:` IRIs. [Oxigraph](https://github.com/oxigraph/oxigraph) answers SPARQL 1.1, read only. Vocabulary and examples: [docs/KNOWLEDGE-GRAPH.md](docs/KNOWLEDGE-GRAPH.md).

## How it works

```mermaid
flowchart LR
    subgraph repo[your repository]
        WT[working tree]
        GIT[(git objects)]
        META[(refs/kula/meta<br/>issues · proposals · notes · memories)]
        TOML[kula.toml]
    end
    subgraph kula[kula]
        IDX[tree-sitter indexer<br/>11 languages]
        DB[(graph.db<br/>SQLite · FTS5)]
        G[impact · trace · flows<br/>clusters · compare]
        GU[guard: one verdict]
        KG[RDF · SPARQL]
    end
    WT --> IDX
    GIT -->|ls-tree + cat-file, no checkout| IDX
    IDX --> DB --> G
    DB --> KG
    META --> KG
    TOML --> GU
    G & GU & KG --> CLI[CLI]
    G & GU & KG --> MCP[MCP · hooks]
    G & GU & KG --> UI[web UI]
    CLI -->|everything else| GITBIN[git]
```

- **Indexing.** Files are walked in parallel (respecting `.gitignore`) and parsed with tree-sitter: TypeScript/TSX, JavaScript/JSX, Python, Rust, Go, Java, C, C++, C#, Ruby and PHP. Calls resolve to the same file, then imported files, then a unique match in the same language family; a stoplist keeps `.get()` and `.map()` from wiring everything together. Clusters come from weighted label propagation.
- **Any revision, without a checkout.** A revision's graph is built from git objects (`git ls-tree` and one `git cat-file --batch`) and cached per commit. Symbols match across revisions by kind, path, container and name, and compare by a hash of their source.
- **Storage.** `.kula/graph.db` (SQLite and FTS5) is git-ignored, built beside the live file and swapped in with one rename, so a running `kula view` never reads a half-built graph. It reindexes in the background whenever `HEAD` moves.
- **Cleans up after itself.** Once `kula view` sits idle (15 min by default), it drops old `kula run` copies, temp files and cached graphs, and compacts the store. Change the timer in Settings → Disk or with `kula clean --after 30` (`0` turns it off); `kula clean` runs a pass now.
- **Metadata in git.** Issues, proposals, notes and memories are one JSON document committed onto `refs/kula/meta`: full history, nothing touches your branches, `kula share` publishes it (with the agent setup on `refs/kula/setup`) and `kula sync` pulls it; nothing is pushed until you share.
- **Git itself** is never reimplemented: kula shells out to `git`, so hooks, signing, credential helpers and LFS keep working.
- **Security.** The UI listens on `127.0.0.1`, rejects foreign `Host` headers (DNS rebinding), requires a per-session token on every call, and validates revisions so they can't be read as options.

The internals (resolution, the store, risk, the meta ref, the API) are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Docs

| | |
|---|---|
| [docs/CLI.md](docs/CLI.md) | install, `kula init`, `kula.toml`, every command, the CI gate |
| [docs/AGENTS.md](docs/AGENTS.md) | workflows, fences, tasks, memory, the brief, suggestions, the hook per agent, every MCP tool |
| [docs/KNOWLEDGE-GRAPH.md](docs/KNOWLEDGE-GRAPH.md) | the RDF vocabulary, IRIs, SPARQL examples, result shapes |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | indexing, resolution, storage, contrast, risk, the meta ref, the HTTP API, tests |
| [promo/](promo/) | the launch film: score, voiceover, capture, and the Remotion edit |

## Development

```bash
pnpm -C web install && pnpm -C web build   # UI → web/dist (embedded in release builds)
cargo run -- view                           # run against this repo
./scripts/test.sh                           # everything CI runs; --quick skips packaging
pnpm -C web test:ui                         # Playwright: desktop, tablet and phone, against this repo and a seeded fixture
```

| stage | checks |
|---|---|
| `web` | pnpm install · TypeScript · Vite production build |
| `rust` | rustfmt · clippy `-D warnings` · unit tests · end-to-end CLI tests against a polyglot fixture |
| `e2e` | a real `kula view`: token and Host guards, the API, staging and committing over HTTP, agents and SPARQL |
| `pkg` | release build · npm launcher · pip wheel · crate contents · Homebrew formula · installer · nix flake |

**Releasing:** push a `vX.Y.Z` tag. [`release.yml`](.github/workflows/release.yml) builds five targets and publishes the GitHub release, `.deb` packages and the apt repository, PyPI wheels, npm packages, the crate and the Homebrew formula.

## Roadmap

- Incremental re-indexing on file change (`kula view --watch`)
- Kotlin, Swift, Scala and Elixir
- Shell-command fencing for agents (parse `sed -i`, `mv`, `rm` before they run)
- Two-way sync with GitHub and GitLab issues and pull requests
- Time-travel: scrub through history and watch the architecture change

<img src="docs/assets/logo.svg" width="40" align="right" alt="">

## License

[GPL-3.0](LICENSE) © 2026 Arnav Sharma. The GNU General Public License, version 3, as used across Ubuntu and the GNU tools. You may use, study, share and change kula; if you distribute a modified version, you share its source under the same terms. Kula is an independent, clean-room project and contains no code from other code-graph tools.
