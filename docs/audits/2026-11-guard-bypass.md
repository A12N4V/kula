# Guard bypass matrix – 2026-11-12 (P1.4.9)

A probe repo (`tests/**` locked, `.env` hidden) was hit with every route we could find, through `kula guard hook`. Each route is now refused, and each one is a case in `shell_bypasses_are_refused_in_a_fenced_repo` (`tests/cli.rs`). A second list of legitimate look-alikes in the same test must still pass.

## Routes closed

- In-place editors: `sed -i`, `perl -pi`, `ruby -i`, `awk -i inplace`, and terminal editors on a fenced file.
- Links: `ln` onto a fenced path.
- Directory tracking: `cd`/`pushd`/`popd` chains, `..` walks, `cd /` and absolute paths inside the repo. A cd the guard cannot follow (`cd $X`, `cd -`, `cd ~`) makes later relative writes refuse.
- Control flow: segments split on `;`, `&&`, `||` and `|`. Leading `{ ! if then do while time` words are skipped.
- Fan-out: `xargs` or `parallel` feeding a writer, `find -exec <writer>` and `find -delete` over a fenced root.
- Archives: `tar -x`/`unzip` into a fenced directory, or an archive that lists a fenced path.
- Scripts: piping into `sh`/`bash`/`python` and friends. A script file that names a fenced or hidden path, kula's config, `.kula/` or git hooks.
- Sweeps that read hidden files: `grep -r` without `--exclude`, `rg --hidden`, `tar -c`, `zip -r`, `cp -r` over a hidden root.
- Git: `clean -f` over a path that covers a fenced file (and hidden files with `-x`; dry runs pass), `pull`, `worktree add`, `merge`/`rebase`/`cherry-pick`/`revert`/`switch`/`checkout <rev>` whose diff touches a fenced file, and `checkout -f`/`--discard-changes`/`--merge`.
- Refusals name the fence's reason, so an agent sees why.

## Wave 2 (B3) – exact verdicts close the file-tool routes

The shell wall refuses commands; the file-tool wall now judges the edit
itself. `Guards::verdict_edit` (the hook path, `edit_exact` now delegates to
it) diffs the old and new text with a patience diff (`similar`), maps the
changed ranges to file lines, and hit-tests them against symbol spans through
an interval tree (`SpanIndex`, O(log n + k)). The verdict is the join (max)
of the levels of everything touched. Each bypass shape and its refusal:

- A line added inside a locked fn – span hit, refused.
- A whole-file Write rewriting the body – body compare, refused.
- Deleting the definition – old-side span hit plus vanish, refused.
- Renaming the locked fn (`vault_unlock` → `vault_release`) – B1 identity
  (`relink`) keeps path + bodyhash when only the name moves; for a rename the
  body text changes too, so the signature-line fallback carries the fence
  across, with a notice ("locked vault_unlock was renamed to vault_release
  and stays locked"). A moved fn (new path, same name and body) is refused
  the same way at the new path.
- Swallowing a locked fn with an opened comment or string (it vanishes from
  the parse) – body compare sees the definition disappear, refused.
- A second definition under the fenced name – refused.
- Edits between fenced symbols (a comment above, a helper below) – pass; the
  hunk edges stay exact because both sides of the diff are mapped.

## Accepted limits

- Obfuscated scripts (paths built at runtime, encoded strings) can slip past the static read. The backstop is `kula run`'s put-back of fenced files and the pre-commit hook, which both check the result, not the command.
- `git rebase <branch>` with an empty diff against fenced files is allowed, since it changes nothing fenced.
- The shell layer refuses only. It never grants a permission the harness has not.
