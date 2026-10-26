# r/rust draft

**Title:** Kula: a single-binary git wrapper in Rust that indexes repos with tree-sitter into SQLite and answers SPARQL via Oxigraph

**Flair:** project / tooling (check current flair list)

## Body

I've been building kula, a CLI (MIT, Rust 2021) that wraps git and keeps a call/import graph of your code. Repo: https://github.com/A12N4V/kula. Some Rust details people here might care about:

- **One binary.** The Vite web UI is embedded in release builds and served by axum on 127.0.0.1 with a per-session token and a Host-header check (DNS rebinding). The only runtime dependency is `git`. Release binary is about 28 MB.
- **Parsing.** `tree-sitter` 0.27 with 11 grammars compiled in (Rust, TS/TSX, JS, Python, Go, Java, C, C++, C#, Ruby, PHP). Files are walked with `ignore` (so .gitignore applies) and parsed in parallel with `rayon`. 173 more grammars ship as optional native-library packs, verified against a sha256 manifest, so the base binary stays small.
- **Indexing past revisions without a checkout.** `git ls-tree` plus a single long-lived `git cat-file --batch` stream the blobs; the graph is cached per commit. Symbols match across revisions by kind, path, container and name, and compare by a hash of their source. That is what `kula graph-diff main WORKTREE` uses.
- **Storage.** `rusqlite` (bundled) with FTS5. The new graph is built beside the live file and swapped in with one rename, so a running `kula view` never reads a half-built DB.
- **RDF.** The graph exports as Turtle, N-Triples, JSON-LD or RDF/XML, and `oxigraph` 0.5 (default features off) answers read-only SPARQL 1.1 over it. Niche, I know; it is there because "which functions have the most callers in this cluster" is one query instead of a script.
- **Resolution is heuristic.** Same file, then imported files, then a unique same-language match, with a stoplist for names like `get`/`map`. For Rust that means trait method calls and macro-generated items are where it is weakest. There is a small gold set under `bench/mapping/gold/miniserde` I am using to measure it.

It also has agent features (an MCP server and edit fences; the hook catches obvious shell writes; scripts, variables and cd-then-write can slip past; CI (`kula check`) is the gate), but for this sub the indexing is the interesting part.

No benchmarks yet; I will post index times and memory once measured.

`cargo install kula` builds from source; brew, nix and release binaries also exist.

Question: for Rust specifically, how would you get better call resolution without pulling in rust-analyzer? I'm considering reading `use` trees more carefully and resolving `impl` blocks by type name, but I'd like to hear from anyone who has done this with tree-sitter.

## critic notes
- Round 2: dropped the MSRV 1.80 claim (no 1.80 toolchain to run `cargo +1.80 check`); said "no benchmarks yet"; replaced "enforced" with the shared hook line.
- r/rust rule: posts must clearly involve Rust. Title now names the crates and the technique, not just "Announcing kula".
- Verified versions in Cargo.toml: tree-sitter 0.27, oxigraph 0.5 with default-features = false, rusqlite bundled, axum 0.8, rayon, ignore.
- Removed "fast" and "blazing"; no benchmark numbers exist yet.
- Removed a claim that cat-file is "one process per index"; README says "one git cat-file --batch", phrased to match.
- Called out Rust trait/macro resolution as weak; a r/rust reader would find it in five minutes anyway.
- Confirmed bench/mapping/gold/miniserde exists before citing it; did not claim a precision number.
- Kept agent features to one line so it does not read as an AI-tool post in a language sub.
