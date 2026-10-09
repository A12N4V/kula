# Languages

kula parses **187 languages**: 11 built into the binary, the script blocks of three component formats, and 173 more as language packs you install with `kula lang add`.

## Built in

TypeScript/TSX, JavaScript/JSX, Python, Rust, Go, Java, C, C++, C#, Ruby and PHP, plus the `<script>` blocks of **Vue** and **Svelte** components and **Astro** frontmatter (parsed as TypeScript in place, so line numbers still point into the original file). Nothing to install.

## Language packs

```bash
kula lang list              # built in, installed, available, and what this repo contains
kula lang add --detected    # every language this repo has that isn't installed
kula lang add kotlin swift  # by id
kula lang add zig --build   # no prebuilt for your platform: compile from the pinned grammar source
kula lang remove kotlin
```

The UI shows the same list under **Settings → Languages**, with an Install button for every language a repository contains but kula skips. `kula index` prints a one-line hint when it skips files for want of a pack.

- **What a pack is.** A grammar compiled to a native shared library (`tree_sitter_<name>` exported), installed under `~/.kula/grammars/<id>/<version>/` and opened with `dlopen` the first time a file of that language is indexed. kula checks the grammar's tree-sitter ABI against the one it was built with and refuses a mismatch with a message saying how to reinstall. The extraction queries stay in the kula binary (`src/index/queries/<id>.scm`, a few hundred bytes each): they are tied to how this kula reads captures, so a query fix never needs a new pack, and the grammar revision is pinned in the same table (`src/index/packs.toml`) so node names and queries stay in step.
- **Where packs come from.** The GitHub release of the running kula version (`A12N4V/kula`): `langpacks-<target>.json` lists every pack with its grammar version and sha256, and each download is checked against it before it is kept. Nothing else is downloaded. `--build` falls back to compiling the pack from its grammar source pinned to a commit (or a crates.io grammar crate) with the system C compiler; `KULA_LANGPACK_DIR` points kula at a local mirror laid out like a release.
- **Size.** Packs are 265 KB at the median, from 33 KB to 23.7 MB (SystemVerilog); all 173 together are 213.7 MB on aarch64-apple-darwin. The kula binary stays at about 28 MB.
- **Speed.** A pack parses exactly as fast as a compiled-in grammar: the same C parser, loaded once per process. Indexing okhttp (617 Kotlin files) takes the same 0.55 s either way.
- **Adding a language.** One `[[pack]]` row in `packs.toml` (repository and commit, extensions) and a query file. Queries use kula's captures (`@def.function`, `@def.method`, `@def.class`, `@def.interface`, `@call`, `@import`, optional `@scope` for a definition's extent) or tree-sitter `tags.scm` captures (`@name` with `@definition.*` / `@reference.call`), so a grammar's own tags file works as-is. `kula lang build <id> --out dir` compiles it and reports what the queries find in the grammar's test corpus; `scripts/build-langpacks.sh` builds them all for a release.

## Tiers

Each pack's tier is measured, not claimed: `kula lang build` runs its queries over the grammar's own test corpus (and kula's fixture, when there is one) and records what they find.

### Definitions, calls and imports (130)

| id | language | extensions |
|---|---|---|
| `ada` | Ada | `.adb` `.ads` `.ada` |
| `agda` | Agda | `.agda` |
| `apex` | Apex | `.cls` `.apex` `.trigger` |
| `nasm` | Assembly | `.asm` `.nasm` |
| `bash` | Bash | `.sh` `.bash` `.zsh` `.ksh` `.bashrc` `.zshrc` `.profile` |
| `bass` | Bass | `.bass` |
| `bicep` | Bicep | `.bicep` |
| `blade` | Blade | `.blade.php` `.blade` |
| `bpftrace` | bpftrace | `.bt` |
| `brightscript` | Brightscript | `.brs` |
| `arduino` | C++ | `.ino` `.pde` |
| `c3` | C3 | `.c3` |
| `cairo` | Cairo | `.cairo` |
| `capnp` | Cap'n Proto | `.capnp` |
| `circom` | Circom | `.circom` |
| `clojure` | Clojure | `.clj` `.boot` `.cl2` `.cljc` `.cljs` `.cljs.hl` `riemann.config` |
| `cmake` | CMake | `.cmake` `CMakeLists.txt` |
| `ql` | CodeQL | `.ql` `.qll` |
| `commonlisp` | Common Lisp | `.lisp` `.lsp` `.cl` `.asd` |
| `crystal` | Crystal | `.cr` |
| `css` | CSS | `.css` |
| `cuda` | Cuda | `.cu` `.cuh` |
| `cue` | CUE | `.cue` |
| `d` | D | `.d` `.di` |
| `dart` | Dart | `.dart` |
| `devicetree` | Devicetree | `.dts` `.dtsi` |
| `dhall` | Dhall | `.dhall` |
| `dockerfile` | Dockerfile | `.dockerfile` `.containerfile` `Containerfile` `Dockerfile` |
| `earthfile` | Earthly | `Earthfile` |
| `elixir` | Elixir | `.ex` `.exs` `mix.lock` |
| `elm` | Elm | `.elm` |
| `elvish` | Elvish | `.elv` |
| `elisp` | Emacs Lisp | `.el` `.emacs` |
| `erlang` | Erlang | `.erl` `.hrl` `Emakefile` `rebar.config` `rebar.config.lock` |
| `fsharp` | F# | `.fs` `.fsx` |
| `faust` | Faust | `.dsp` |
| `fennel` | Fennel | `.fnl` |
| `fortran` | Fortran Free Form | `.f90` `.f95` `.f03` `.f08` `.f` `.for` |
| `gap` | GAP | `.g` `.gi` `.gap` |
| `gdscript` | GDScript | `.gd` |
| `gdshader` | GDShader | `.gdshader` `.gdshaderinc` |
| `gleam` | Gleam | `.gleam` |
| `glsl` | GLSL | `.glsl` `.vert` `.frag` `.geom` `.comp` `.tesc` |
| `gn` | GN | `.gn` `.gni` `.gn` |
| `gren` | Gren | `.gren` |
| `groovy` | Groovy | `.groovy` `.gradle` `.gvy` `Jenkinsfile` |
| `hack` | Hack | `.hack` `.hhi` |
| `hare` | Hare | `.ha` |
| `haskell` | Haskell | `.hs` `.lhs` |
| `hcl` | HCL | `.tf` `.tfvars` `.hcl` |
| `hlsl` | HLSL | `.hlsl` `.cginc` `.fx` `.fxh` `.hlsli` |
| `hoon` | hoon | `.hoon` |
| `razor` | HTML+Razor | `.cshtml` `.razor` |
| `idris` | Idris | `.idr` `.lidr` |
| `inko` | Inko | `.inko` |
| `ispc` | ISPC | `.ispc` |
| `janet_simple` | Janet | `.janet` |
| `jinja` | Jinja | `.jinja` `.j2` `.jinja2` |
| `htmldjango` | Jinja | `.django` `.djhtml` |
| `jq` | jq | `.jq` |
| `jsonnet` | Jsonnet | `.jsonnet` `.libsonnet` |
| `julia` | Julia | `.jl` |
| `just` | Just | `.just` `.JUSTFILE` `.Justfile` `.justfile` |
| `kcl` | KCL | `.k` `kcl.mod` `kcl.mod.lock` |
| `kconfig` | Kconfig | `Kconfig` |
| `kos` | KerboScript | `.ks` |
| `kotlin` | Kotlin | `.kt` `.kts` |
| `koto` | Koto | `.koto` |
| `lalrpop` | LALRPOP | `.lalrpop` |
| `liquid` | Liquid | `.liquid` |
| `liquidsoap` | Liquidsoap | `.liq` |
| `lua` | Lua | `.lua` `.luacheckrc` |
| `luau` | Luau | `.luau` |
| `make` | Makefile | `.mk` `.mak` `.make` `Makefile` `makefile` `GNUmakefile` |
| `m68k` | Motorola 68K Assembly | `.i` `.x68` |
| `nickel` | Nickel | `.ncl` |
| `nim` | Nim | `.nim` `.nim.cfg` `.nimble` `.nimrod` `.nims` |
| `ninja` | Ninja | `.ninja` |
| `nix` | Nix | `.nix` |
| `nqc` | nqc | `.nqc` |
| `nu` | Nushell | `.nu` |
| `objc` | Objective-C | `.m` `.mm` |
| `ocaml` | OCaml | `.ml` |
| `odin` | Odin | `.odin` |
| `rego` | Open Policy Agent | `.rego` |
| `pascal` | Pascal | `.pas` `.dpr` `.lpr` |
| `perl` | Perl | `.pl` `.pm` `.t` `.psgi` `cpanfile` |
| `pkl` | Pkl | `.pkl` |
| `pony` | Pony | `.pony` |
| `powershell` | PowerShell | `.ps1` `.psm1` `.psd1` |
| `proto` | Protocol Buffer | `.proto` |
| `puppet` | Puppet | `.pp` `Modulefile` |
| `purescript` | PureScript | `.purs` |
| `qmljs` | QML | `.qml` `.qbs` |
| `r` | R | `.r` `.Rapp.history` `.Rhistory` `.Rprofile` |
| `racket` | Racket | `.rkt` `.rktl` |
| `ralph` | Ralph | `.ral` |
| `rescript` | ReScript | `.res` `.resi` |
| `robot` | RobotFramework | `.robot` `.resource` |
| `roc` | Roc | `.roc` |
| `scala` | Scala | `.scala` `.sc` |
| `scheme` | Scheme | `.scm` `.ss` `.sld` |
| `scss` | SCSS | `.scss` |
| `slang` | Slang | `.slang` |
| `slint` | Slint | `.slint` |
| `smali` | Smali | `.smali` |
| `snakemake` | Snakemake | `.smk` `.snakefile` `Snakefile` |
| `solidity` | Solidity | `.sol` |
| `sourcepawn` | SourcePawn | `.sp` |
| `authzed` | SpiceDB | `.zed` |
| `squirrel` | Squirrel | `.nut` |
| `starlark` | Starlark | `.bzl` `.star` `.bazel` `BUILD` `BUILD.bazel` `WORKSPACE` |
| `supercollider` | SuperCollider | `.scd` |
| `sway` | Sway | `.sw` |
| `swift` | Swift | `.swift` |
| `systemverilog` | SystemVerilog | `.v` `.sv` `.svh` `.vh` |
| `tact` | Tact | `.tact` |
| `tcl` | Tcl | `.tcl` `.adp` `.sdc` `.tcl.in` `.tm` `.xdc` `owh` `starfield` |
| `templ` | templ | `.templ` |
| `tera` | Tera | `.tera` |
| `tiger` | Tiger | `.tig` |
| `twig` | Twig | `.twig` |
| `typoscript` | TypoScript | `.typoscript` |
| `v` | V | `.v` `.vsh` |
| `vala` | Vala | `.vala` `.vapi` |
| `vhdl` | VHDL | `.vhd` `.vhdl` |
| `vim` | Vim Script | `.vim` `.vimrc` `vimrc` `_vimrc` |
| `yang` | YANG | `.yang` |
| `yuck` | yuck | `.yuck` |
| `zig` | Zig | `.zig` |

### Definitions and calls (28)

| id | language | extensions |
|---|---|---|
| `asm` | Assembly | `.s` |
| `awk` | Awk | `.awk` `.auk` `.gawk` `.mawk` `.nawk` |
| `bp` | bp | `.bp` |
| `cylc` | Cylc | `.cylc` `suite.rc` |
| `ebnf` | EBNF | `.ebnf` |
| `elsa` | Elsa | `.lc` |
| `fish` | fish | `.fish` |
| `forth` | Forth | `.fth` `.4th` `.forth` `.fr` `.frt` |
| `fsh` | FSH | `.fsh` |
| `func` | FunC | `.fc` |
| `gotmpl` | Go Template | `.gohtml` `.gotmpl` `.html.tmpl` `.tmpl` `.tpl` `_helpers.tpl` |
| `graphql` | GraphQL | `.graphql` `.gql` |
| `kusto` | Kusto | `.csl` `.kql` |
| `leo` | Leo | `.leo` |
| `llvm` | LLVM | `.ll` |
| `matlab` | MATLAB | `.matlab` `.m` |
| `menhir` | Menhir | `.mly` |
| `pioasm` | PIO Assembly | `.pio` |
| `prisma` | Prisma | `.prisma` |
| `prql` | PRQL | `.prql` |
| `re2c` | re2c | `.re` `.re2c` |
| `sproto` | sproto | `.sproto` |
| `sql` | SQL | `.sql` |
| `systemtap` | SystemTap | `.stp` |
| `t32` | t32 | `.cmm` |
| `ungrammar` | ungrammar | `.ungram` |
| `wgsl` | WGSL | `.wgsl` |
| `zsh` | Zsh | `.bats` `.cgi` `.command` `.fcgi` `.pacscript` `.sbatch` `.bash_aliases` `.bash_functions` `.bash_history` |

### Definitions only (15)

| id | language | extensions |
|---|---|---|
| `bitbake` | BitBake | `.bb` `.bbappend` `.bbclass` `.inc` |
| `facility` | facility | `.fac` |
| `fidl` | FIDL | `.fidl` |
| `firrtl` | FIRRTL | `.fir` |
| `gnuplot` | Gnuplot | `.gp` `.gnu` `.gnuplot` `.p` `.plot` `.plt` |
| `rbs` | RBS | `.rbs` |
| `smithy` | Smithy | `.smithy` |
| `tablegen` | TableGen | `.td` |
| `thrift` | Thrift | `.thrift` |
| `tlaplus` | TLA | `.tla` |
| `typespec` | TypeSpec | `.tsp` |
| `uxntal` | Uxntal | `.tal` |
| `idl` | Web IDL | `.webidl` `.idl` |
| `wit` | WebAssembly Interface Type | `.wit` |
| `wing` | Wing | `.w` |

## Not included

- **Data and markup** with nothing to call a definition – JSON, YAML, TOML, KDL, XML, CSV, Markdown, plain HTML templates (Pug, Slim, HEEx, EEx, Glimmer, Surface, Vento, WXML) – and query languages without user definitions (PromQL, GROQ, SPARQL, SOQL, SOSL, VRL).
- **Grammars whose repositories don't commit a generated parser** and have no crates.io grammar crate: LaTeX, MLIR, OCamllex, Teal, Unison.
- **goctl** (its `.api` extension collides with too much else) and **Terraform** (covered by the HCL pack).
- **Windows**: no prebuilt packs yet, and `--build` needs a Unix-like C toolchain.
