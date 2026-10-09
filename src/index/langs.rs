//! Language registry. Core languages are compiled in, one table row each (a
//! grammar, file names, a query file under `queries/`); every other language is
//! a pack described in `packs.toml` and loaded at runtime (see `packs.rs`).
//!
//! Adding a language is a grammar plus a small `.scm` file: patterns are
//! separated by blank lines and use these captures:
//!   @def.function / @def.method / @def.class / @def.interface – a definition's name
//!   @scope  – (optional) the whole definition node, when `def_kinds` can't find it
//!   @call   – the callee name at a call site
//!   @import – an import statement or its module string
//! tree-sitter `tags.scm` captures work too: @name with @definition.<kind> or
//! @reference.call, so a grammar's own tags file can be dropped in as-is.
//!
//! Each pattern is compiled on its own so one grammar-version mismatch never
//! disables a whole language.

use tree_sitter::{Language, Query};

pub struct Lang {
    pub id: &'static str,
    pub language: Language,
    pub queries: Vec<Query>,
    /// Node kinds that make a nested function a method.
    pub class_kinds: &'static [&'static str],
    /// Node kinds that represent a definition body (used to find the enclosing def).
    pub def_kinds: &'static [&'static str],
}

/// One supported language.
pub struct Spec {
    pub id: &'static str,
    /// Calls only resolve between languages of one family (TS calling JS is fine,
    /// TS calling a Rust function of the same name is not).
    pub family: &'static str,
    /// Lower-case file extensions, without the dot.
    pub exts: &'static [&'static str],
    /// Exact file names (`Makefile`, `CMakeLists.txt`).
    pub names: &'static [&'static str],
    pub grammar: Option<fn() -> Language>,
    pub queries: &'static [&'static str],
    pub class_kinds: &'static [&'static str],
    pub def_kinds: &'static [&'static str],
}

pub const SPECS: &[Spec] = &[
    Spec {
        id: "rust",
        family: "rust",
        exts: &["rs"],
        names: &[],
        grammar: Some(|| tree_sitter_rust::LANGUAGE.into()),
        queries: &[include_str!("queries/rust.scm")],
        class_kinds: &["impl_item", "trait_item"],
        def_kinds: &["function_item", "function_signature_item", "struct_item", "enum_item", "trait_item"],
    },
    Spec {
        id: "python",
        family: "python",
        exts: &["py", "pyi"],
        names: &[],
        grammar: Some(|| tree_sitter_python::LANGUAGE.into()),
        queries: &[include_str!("queries/python.scm")],
        class_kinds: &["class_definition"],
        def_kinds: &["function_definition", "class_definition"],
    },
    Spec {
        id: "javascript",
        family: "js",
        exts: &["js", "mjs", "cjs", "jsx"],
        names: &[],
        grammar: Some(|| tree_sitter_javascript::LANGUAGE.into()),
        queries: &[include_str!("queries/javascript.scm")],
        class_kinds: &["class_declaration", "class"],
        def_kinds: &[
            "function_declaration",
            "generator_function_declaration",
            "class_declaration",
            "method_definition",
            "variable_declarator",
        ],
    },
    Spec {
        id: "typescript",
        family: "js",
        exts: &["ts", "mts", "cts"],
        names: &[],
        grammar: Some(|| tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
        queries: &[include_str!("queries/javascript.scm"), include_str!("queries/typescript_extra.scm")],
        class_kinds: &["class_declaration", "abstract_class_declaration", "class"],
        def_kinds: &[
            "function_declaration",
            "generator_function_declaration",
            "class_declaration",
            "abstract_class_declaration",
            "method_definition",
            "variable_declarator",
            "interface_declaration",
        ],
    },
    Spec {
        id: "tsx",
        family: "js",
        exts: &["tsx"],
        names: &[],
        grammar: Some(|| tree_sitter_typescript::LANGUAGE_TSX.into()),
        queries: &[include_str!("queries/javascript.scm"), include_str!("queries/typescript_extra.scm")],
        class_kinds: &["class_declaration", "abstract_class_declaration", "class"],
        def_kinds: &[
            "function_declaration",
            "generator_function_declaration",
            "class_declaration",
            "abstract_class_declaration",
            "method_definition",
            "variable_declarator",
            "interface_declaration",
        ],
    },
    Spec {
        id: "vue",
        family: "js",
        exts: &["vue"],
        names: &[],
        grammar: Some(|| tree_sitter_typescript::LANGUAGE_TSX.into()),
        queries: &[include_str!("queries/javascript.scm"), include_str!("queries/typescript_extra.scm")],
        class_kinds: &["class_declaration", "abstract_class_declaration", "class"],
        def_kinds: &[
            "function_declaration",
            "generator_function_declaration",
            "class_declaration",
            "abstract_class_declaration",
            "method_definition",
            "variable_declarator",
            "interface_declaration",
        ],
    },
    Spec {
        id: "svelte",
        family: "js",
        exts: &["svelte"],
        names: &[],
        grammar: Some(|| tree_sitter_typescript::LANGUAGE_TSX.into()),
        queries: &[include_str!("queries/javascript.scm"), include_str!("queries/typescript_extra.scm")],
        class_kinds: &["class_declaration", "abstract_class_declaration", "class"],
        def_kinds: &[
            "function_declaration",
            "generator_function_declaration",
            "class_declaration",
            "abstract_class_declaration",
            "method_definition",
            "variable_declarator",
            "interface_declaration",
        ],
    },
    Spec {
        id: "astro",
        family: "js",
        exts: &["astro"],
        names: &[],
        grammar: Some(|| tree_sitter_typescript::LANGUAGE_TSX.into()),
        queries: &[include_str!("queries/javascript.scm"), include_str!("queries/typescript_extra.scm")],
        class_kinds: &["class_declaration", "abstract_class_declaration", "class"],
        def_kinds: &[
            "function_declaration",
            "generator_function_declaration",
            "class_declaration",
            "abstract_class_declaration",
            "method_definition",
            "variable_declarator",
            "interface_declaration",
        ],
    },
    Spec {
        id: "go",
        family: "go",
        exts: &["go"],
        names: &[],
        grammar: Some(|| tree_sitter_go::LANGUAGE.into()),
        queries: &[include_str!("queries/go.scm")],
        class_kinds: &[],
        def_kinds: &["function_declaration", "method_declaration", "type_spec"],
    },
    Spec {
        id: "java",
        family: "jvm",
        exts: &["java"],
        names: &[],
        grammar: Some(|| tree_sitter_java::LANGUAGE.into()),
        queries: &[include_str!("queries/java.scm")],
        class_kinds: &["class_declaration", "interface_declaration", "enum_declaration", "record_declaration"],
        def_kinds: &[
            "method_declaration",
            "constructor_declaration",
            "class_declaration",
            "interface_declaration",
            "enum_declaration",
            "record_declaration",
        ],
    },
    Spec {
        id: "c",
        family: "c",
        exts: &["c", "h"],
        names: &[],
        grammar: Some(|| tree_sitter_c::LANGUAGE.into()),
        queries: &[include_str!("queries/c.scm")],
        class_kinds: &[],
        def_kinds: &["function_definition", "struct_specifier", "enum_specifier", "type_definition"],
    },
    Spec {
        id: "cpp",
        family: "c",
        exts: &["cc", "cpp", "cxx", "c++", "hh", "hpp", "hxx", "h++", "ipp"],
        names: &[],
        grammar: Some(|| tree_sitter_cpp::LANGUAGE.into()),
        queries: &[include_str!("queries/c.scm"), include_str!("queries/cpp_extra.scm")],
        class_kinds: &["class_specifier", "struct_specifier"],
        def_kinds: &["function_definition", "class_specifier", "struct_specifier", "enum_specifier", "type_definition"],
    },
    Spec {
        id: "csharp",
        family: "dotnet",
        exts: &["cs"],
        names: &[],
        grammar: Some(|| tree_sitter_c_sharp::LANGUAGE.into()),
        queries: &[include_str!("queries/csharp.scm")],
        class_kinds: &["class_declaration", "struct_declaration", "record_declaration", "interface_declaration"],
        def_kinds: &[
            "method_declaration",
            "constructor_declaration",
            "local_function_statement",
            "class_declaration",
            "struct_declaration",
            "record_declaration",
            "enum_declaration",
            "interface_declaration",
        ],
    },
    Spec {
        id: "ruby",
        family: "ruby",
        exts: &["rb", "rake", "gemspec"],
        names: &["Rakefile", "Gemfile"],
        grammar: Some(|| tree_sitter_ruby::LANGUAGE.into()),
        queries: &[include_str!("queries/ruby.scm")],
        class_kinds: &["class", "module"],
        def_kinds: &["method", "singleton_method", "class", "module"],
    },
    Spec {
        id: "php",
        family: "php",
        exts: &["php"],
        names: &[],
        grammar: Some(|| tree_sitter_php::LANGUAGE_PHP.into()),
        queries: &[include_str!("queries/php.scm")],
        class_kinds: &["class_declaration", "trait_declaration", "interface_declaration", "enum_declaration"],
        def_kinds: &[
            "function_definition",
            "method_declaration",
            "class_declaration",
            "trait_declaration",
            "enum_declaration",
            "interface_declaration",
        ],
    },
];

fn spec(id: &str) -> Option<&'static Spec> {
    SPECS.iter().find(|s| s.id == id)
}

/// Built into the binary (as opposed to a language pack).
pub fn is_core(id: &str) -> bool {
    spec(id).is_some()
}

/// The call-resolution family of a language id.
pub fn family(id: &str) -> &str {
    if let Some(s) = spec(id) {
        return s.family;
    }
    super::packs::get(id).map(|p| p.family()).unwrap_or(id)
}

/// The language kula parses a path as: core languages, then installed packs.
pub fn for_path(path: &str) -> Option<&'static str> {
    let id = detect(path)?;
    (is_core(id) || super::packs::is_installed(id)).then_some(id)
}

/// The language a path is written in, whether or not its pack is installed.
pub fn detect(path: &str) -> Option<&'static str> {
    let name = path.rsplit('/').next()?;
    // Compound extensions (`.blade.php`) outrank the last one.
    if let Some(p) = super::packs::for_compound(name) {
        return Some(p.id.as_str());
    }
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase());
    let core = SPECS
        .iter()
        .find(|s| s.names.contains(&name))
        .or_else(|| SPECS.iter().find(|s| ext.as_deref().is_some_and(|e| s.exts.contains(&e))));
    core.map(|s| s.id).or_else(|| super::packs::for_name(name).map(|p| p.id.as_str()))
}

/// Settle an extension shared by two languages once the content is known:
/// `.m` is Objective-C or MATLAB, `.v` is Verilog or V.
pub fn refine(id: &'static str, src: &str) -> &'static str {
    let (a, b, is_a) = match id {
        "objc" | "matlab" => (
            "objc",
            "matlab",
            ["@interface", "@implementation", "@protocol", "#import", "#include", "@end"].iter().any(|k| src.contains(k)),
        ),
        "systemverilog" | "v" => ("systemverilog", "v", src.contains("endmodule") || src.contains("module ") && src.contains(");")),
        _ => return id,
    };
    let want = if is_a { a } else { b };
    match super::packs::get(want) {
        Some(p) if want != id && super::packs::is_installed(want) => p.id.as_str(),
        _ => id,
    }
}

/// Source as the grammar should see it. Vue, Svelte and Astro components keep
/// only their <script> blocks (and Astro its frontmatter); everything else becomes spaces so byte offsets and
/// line numbers still point into the original file.
pub fn prepare<'a>(id: &str, src: &'a str) -> std::borrow::Cow<'a, str> {
    if !matches!(id, "vue" | "svelte" | "astro") {
        return std::borrow::Cow::Borrowed(src);
    }
    let mut out: Vec<u8> = src.bytes().map(|b| if b == b'\n' { b'\n' } else { b' ' }).collect();
    let lower = src.to_ascii_lowercase();
    let mut at = 0;
    // Astro: the `---` frontmatter fence at the top is TypeScript.
    if id == "astro" && src.trim_start().starts_with("---") {
        let open = src.find("---").unwrap_or(0) + 3;
        let end = src[open..].find("\n---").map(|i| open + i + 1).unwrap_or(src.len());
        out[open..end].copy_from_slice(&src.as_bytes()[open..end]);
        at = end;
    }
    while let Some(open) = lower[at..].find("<script").map(|i| i + at) {
        let Some(body) = lower[open..].find('>').map(|i| open + i + 1) else { break };
        let end = lower[body..].find("</script").map(|i| body + i).unwrap_or(src.len());
        out[body..end].copy_from_slice(&src.as_bytes()[body..end]);
        at = end;
    }
    // Only ASCII spaces replaced whole bytes, and kept ranges are copied whole.
    std::borrow::Cow::Owned(String::from_utf8(out).unwrap_or_default())
}

/// Split a query file into its patterns (blank-line separated; `;` comments).
fn patterns(file: &str) -> impl Iterator<Item = &str> {
    file.split("\n\n").map(str::trim).filter(|p| !p.is_empty() && !p.lines().all(|l| l.trim_start().starts_with(';')))
}

/// Compile patterns in parallel: each tree-sitter query compile is slow for the
/// larger grammars (TS/TSX), and they're independent.
fn compile(language: &Language, patterns: &[&str]) -> Vec<Query> {
    // Validate each pattern on its own (one bad pattern must not sink the rest),
    // then fuse the good ones into a single query: one tree walk per file
    // instead of one per pattern.
    let ok: Vec<&str> = std::thread::scope(|s| {
        let hs: Vec<_> = patterns.iter().map(|p| s.spawn(move || Query::new(language, p).is_ok().then_some(*p))).collect();
        hs.into_iter().filter_map(|h| h.join().ok().flatten()).collect()
    });
    match Query::new(language, &ok.join("\n")) {
        Ok(q) => vec![q],
        Err(_) => ok.iter().filter_map(|p| Query::new(language, p).ok()).collect(),
    }
}

/// Warm every language a file list needs, concurrently, before parsing starts.
pub fn warm(ids: impl IntoIterator<Item = &'static str>) {
    let mut uniq: Vec<&str> = ids.into_iter().collect();
    uniq.sort_unstable();
    uniq.dedup();
    std::thread::scope(|s| {
        for id in uniq {
            s.spawn(move || get(id));
        }
    });
}

/// A language's grammar and compiled queries, built once per process and shared
/// by every parser thread (query compilation dominates small indexes otherwise).
pub fn get(id: &str) -> Option<&'static Lang> {
    use std::sync::OnceLock;
    static CELLS: [OnceLock<Option<Lang>>; SPECS.len()] = [const { OnceLock::new() }; SPECS.len()];
    match SPECS.iter().position(|s| s.id == id) {
        Some(i) => CELLS[i].get_or_init(|| load(id)).as_ref(),
        None => super::packs::lang(id),
    }
}

fn spec_patterns(s: &Spec) -> Vec<&'static str> {
    let mut pats: Vec<&str> = s.queries.iter().flat_map(|q| patterns(q)).collect();
    // JSX belongs to .jsx/.tsx; plain TypeScript drops those patterns by design.
    if s.id == "typescript" {
        pats.retain(|p| !p.contains("jsx_"));
    }
    pats
}

pub fn load(id: &str) -> Option<Lang> {
    let s = spec(id)?;
    let language = (s.grammar?)();
    let queries = compile(&language, &spec_patterns(s));
    Some(Lang { id: s.id, language, queries, class_kinds: s.class_kinds, def_kinds: s.def_kinds })
}

/// A language from a pack: its grammar plus query files.
pub fn build_lang(
    id: &'static str,
    language: Language,
    files: &[&'static str],
    class_kinds: &'static [&'static str],
    def_kinds: &'static [&'static str],
) -> Lang {
    let pats: Vec<&str> = files.iter().flat_map(|q| patterns(q)).collect();
    let queries = compile(&language, &pats);
    let (dk, ck) = derive_kinds(&pats);
    let def_kinds = if def_kinds.is_empty() { dk } else { def_kinds };
    let class_kinds = if class_kinds.is_empty() { ck } else { class_kinds };
    Lang { id, language, queries, class_kinds, def_kinds }
}

/// Definition kinds read off the queries themselves: the root node of every
/// pattern that captures a definition is that definition's extent, and the root
/// of a class or interface pattern (without predicates) is a class body.
fn derive_kinds(pats: &[&str]) -> (&'static [&'static str], &'static [&'static str]) {
    let root = |p: &str| -> Option<String> {
        let t = p.trim_start_matches(|c: char| c == '(' || c.is_whitespace());
        let k: String = t.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
        (!k.is_empty() && !k.starts_with('_')).then_some(k)
    };
    let mut defs: Vec<&'static str> = vec![];
    let mut classes: Vec<&'static str> = vec![];
    for p in pats {
        if !p.contains("@def.") && !p.contains("@definition.") {
            continue;
        }
        let Some(k) = root(p) else { continue };
        let k: &'static str = Box::leak(k.into_boxed_str());
        if !defs.contains(&k) {
            defs.push(k);
        }
        let classy = p.contains("@def.class")
            || p.contains("@def.interface")
            || p.contains("@definition.class")
            || p.contains("@definition.interface");
        if classy && !p.contains("(#") && !classes.contains(&k) {
            classes.push(k);
        }
    }
    (Box::leak(defs.into_boxed_slice()), Box::leak(classes.into_boxed_slice()))
}

/// How many of a language's query patterns compile against its grammar, and the failures.
pub fn check_patterns(language: &Language, file: &str) -> (usize, Vec<String>) {
    let mut ok = 0;
    let mut bad = vec![];
    for p in patterns(file) {
        match Query::new(language, p) {
            Ok(_) => ok += 1,
            Err(e) => bad.push(format!("{p}\n    {e}")),
        }
    }
    (ok, bad)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every pattern of every language compiles against its grammar: a grammar
    /// bump that renames a node kind fails here instead of silently losing symbols.
    #[test]
    fn every_pattern_compiles() {
        let mut broken = vec![];
        for s in SPECS.iter().filter(|s| s.grammar.is_some()) {
            let l = load(s.id).unwrap_or_else(|| panic!("{} did not load", s.id));
            for p in spec_patterns(s) {
                if let Err(e) = Query::new(&l.language, p) {
                    broken.push(format!("{}: {p}\n    {e}", s.id));
                }
            }
        }
        assert!(broken.is_empty(), "patterns that do not compile:\n{}", broken.join("\n"));
    }

    #[test]
    fn ids_and_extensions_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for s in SPECS {
            assert!(seen.insert(s.id), "duplicate id {}", s.id);
        }
        let mut exts = std::collections::HashMap::new();
        for s in SPECS {
            for e in s.exts.iter().chain(s.names) {
                if let Some(o) = exts.insert(*e, s.id) {
                    panic!("{e} claimed by both {o} and {}", s.id);
                }
            }
        }
    }

    #[test]
    fn detection() {
        assert_eq!(for_path("x/App.VUE"), Some("vue"));
        assert_eq!(for_path("main.rs"), Some("rust"));
        assert_eq!(for_path("README"), None);
        assert_eq!(detect("a/b/Makefile"), Some("make"));
        assert_eq!(detect("CMakeLists.txt"), Some("cmake"));
        assert_eq!(detect("src/App.kt"), Some("kotlin"));
        assert_eq!(refine("rust", "fn main() {}"), "rust");
    }

    #[test]
    fn script_blocks_keep_offsets() {
        let src = "<template><div/></template>\n<script setup lang=\"ts\">\nconst a = f()\n</script>\n<style>x{}</style>";
        let p = prepare("vue", src);
        assert_eq!(p.len(), src.len());
        assert_eq!(p.find("const a = f()"), src.find("const a = f()"));
        assert!(!p.contains("template") && !p.contains("style"));
    }
}
