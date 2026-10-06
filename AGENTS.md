# Agent instructions

<!-- kula:begin – written by `kula agents sync` from kula.toml; edit kula.toml, not this block -->
## Working here with kula

This repository is indexed by [kula](https://github.com/A12N4V/kula), a code knowledge graph. Use its MCP server (`kula mcp`) when your tool speaks MCP; otherwise the same answers come from the shell.

| when | MCP tool | shell |
|---|---|---|
| before reading files | `context_pack` | `kula pack "<task>"` |
| before changing a symbol | `pre_edit` | `kula before <symbol>` |
| after editing | `verify_edit` | `kula verify` |
| what you may change | `guards` | `kula guard list` |
| facts about the code | `recall` · `remember` | `kula memory recall <symbol>` |
| how to work on this task | `workflows` | `kula workflow show <name>` |
| an autoresearch loop | `research` · `experiment` | `kula research status` · `kula research try "<hypothesis>"` |

### Fences

**locked** code may be read, never edited. **hidden** code must not be opened. **review** code may be edited; a person reviews it. An active task (`kula task show`) makes everything outside its scope read only. These are enforced, not advice: kula's pre-tool hook refuses fenced edits, reads and shell commands, its pre-commit hook refuses an agent's commit of fenced changes, and kula's own config (`kula.toml`, `.kula/`, the agent hooks) is never an agent's to change – `suggest` instead. Likely secrets (`.env`, keys, certificates) are hidden.

### Workflows

Start one with `kula task start "<title>" --workflow <name>`; its fences apply until `kula task done`.

| workflow | for | fences | memory |
|---|---|---|---|
| `explore` | Read and explain the code; change nothing | locks everything | write |
| `fix` | Fix a bug with the smallest change that holds | – | write |
| `refactor` | Restructure without changing behaviour; tests are the contract | locks tests | write |
| `tests` | Write tests; leave the code under test alone | may change only tests | write |
| `docs` | Write documentation; no code changes | may change only docs | read |
| `autoresearch` | Run experiments in a loop: change, measure, keep what's better | – | write |

No hooks in your harness? Run under `kula run -w <workflow> -- <your agent>`: fenced files are held for the run and anything fenced it changes is put back.
<!-- kula:end -->
