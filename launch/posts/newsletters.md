# Newsletters

## This Week in Rust (PR to rust-lang/this-week-in-rust, "Project/Tooling Updates")

Only submit once there is a blog post to link (TWiR links posts, not repos). Draft line:

```
* [kula 0.3: indexing git revisions with tree-sitter and SQLite, without a checkout](<blog post URL>)
```

Crate of the Week (users.rust-lang.org thread), optional:

> kula: a git wrapper that builds a tree-sitter call graph of a repo (any revision, from git objects via `cat-file --batch`), stores it in SQLite, and answers SPARQL 1.1 over it with Oxigraph. MIT. https://github.com/A12N4V/kula

## Console.dev (email; pre-1.0 dev tools only, no sponsored reviews)

Subject: kula – local code graph and edit fences for git repos (0.3, MIT)

Hi,

Kula is an open-source CLI for developers, currently 0.3. It wraps git and keeps a graph of a repository's functions, calls and imports, built with tree-sitter and stored in SQLite. It runs locally: one binary, no server, no account, no telemetry.

What a reviewer can try in a few minutes:
- `brew tap a12n4v/kula https://github.com/A12N4V/kula && brew install kula`
- `cd any-repo && kula init && kula view` for the map at localhost:7420
- `kula impact <symbol>` and `kula graph-diff main WORKTREE` for blast radius and structural diff
- Optional: `kula agents connect` adds an MCP server and pre-edit hooks for Claude Code, Cursor, Codex or Gemini CLI, so a task can lock a path or a single function

Limits: call resolution is heuristic, Windows supports 11 built-in languages (macOS and Linux add 173 packs), and there is one maintainer.

Repo: https://github.com/A12N4V/kula
Licence: MIT

Thanks,
Arnav Sharma

## critic notes
- TWiR: removed the repo-link entry; the section links write-ups, so this is blocked on the bootcamp/blog post.
- Console: checked against its stated criteria in research.md (devs as primary user, early stage). Said "0.3" and "pre-1.0" plainly.
- Removed the feature laundry list (issues, proposals, RDF, autoresearch) from the email; reviewers skim, so it shows the three commands that work with no setup.
- No claim of signed binaries.
