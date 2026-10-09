//! Language registry: one table row per language – a grammar, file names, and
//! a tree-sitter query file under `queries/`.
//!
//! Adding a language is a grammar crate plus a small `.scm` file: patterns are
//! separated by blank lines and use these captures:
//!   @def.function / @def.method / @def.class / @def.interface – a definition's name
//!   @scope  – (optional) the whole definition node, when `def_kinds` can't find it
//!   @call   – the callee name at a call site
//!   @import – an import statement or its module string
//! tree-sitter `tags.scm` captures work too: @name with @definition.<kind> or
//! @reference.call, so a grammar's own tags file can be dropped in as-is.
//!
//! Each pattern is compiled on its own so one grammar-version mismatch never
//! disables a whole language. Grammars beyond the core set sit behind
//! `lang-*` Cargo features (all on by default; `--no-default-features`
//! builds a slim binary with only the core languages).

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
    /// None when the grammar's Cargo feature is off.
    pub grammar: Option<fn() -> Language>,
    pub queries: &'static [&'static str],
    pub class_kinds: &'static [&'static str],
    pub def_kinds: &'static [&'static str],
}

macro_rules! grammar {
    ($f:literal, $e:expr) => {{
        #[cfg(feature = $f)]
        let g: Option<fn() -> Language> = Some(|| $e.into());
        #[cfg(not(feature = $f))]
        let g: Option<fn() -> Language> = None;
        g
    }};
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
    Spec {
        id: "kotlin",
        family: "jvm",
        exts: &["kt", "kts"],
        names: &[],
        grammar: grammar!("lang-kotlin", tree_sitter_kotlin_ng::LANGUAGE),
        queries: &[include_str!("queries/kotlin.scm")],
        class_kinds: &["class_declaration", "object_declaration"],
        def_kinds: &["class_declaration", "object_declaration", "function_declaration"],
    },
    Spec {
        id: "swift",
        family: "swift",
        exts: &["swift"],
        names: &[],
        grammar: grammar!("lang-swift", tree_sitter_swift::LANGUAGE),
        queries: &[include_str!("queries/swift.scm")],
        class_kinds: &["class_declaration", "protocol_declaration"],
        def_kinds: &[
            "class_declaration",
            "protocol_declaration",
            "function_declaration",
            "protocol_function_declaration",
            "init_declaration",
        ],
    },
    Spec {
        id: "scala",
        family: "jvm",
        exts: &["scala", "sc"],
        names: &[],
        grammar: grammar!("lang-scala", tree_sitter_scala::LANGUAGE),
        queries: &[include_str!("queries/scala.scm")],
        class_kinds: &["class_definition", "object_definition", "trait_definition", "enum_definition"],
        def_kinds: &[
            "class_definition",
            "object_definition",
            "trait_definition",
            "enum_definition",
            "function_definition",
            "function_declaration",
        ],
    },
    Spec {
        id: "groovy",
        family: "jvm",
        exts: &["groovy", "gradle", "gvy"],
        names: &["Jenkinsfile"],
        grammar: grammar!("lang-groovy", tree_sitter_groovy::LANGUAGE),
        queries: &[include_str!("queries/groovy.scm")],
        class_kinds: &["class_declaration", "interface_declaration"],
        def_kinds: &["class_declaration", "interface_declaration", "method_declaration", "function_definition"],
    },
    Spec {
        id: "dart",
        family: "dart",
        exts: &["dart"],
        names: &[],
        grammar: grammar!("lang-dart", tree_sitter_dart::LANGUAGE),
        queries: &[include_str!("queries/dart.scm")],
        class_kinds: &["class_declaration", "mixin_declaration", "extension_declaration", "enum_declaration"],
        def_kinds: &[
            "class_declaration",
            "mixin_declaration",
            "extension_declaration",
            "enum_declaration",
            "function_declaration",
            "method_declaration",
        ],
    },
    Spec {
        id: "lua",
        family: "lua",
        exts: &["lua"],
        names: &[],
        grammar: grammar!("lang-lua", tree_sitter_lua::LANGUAGE),
        queries: &[include_str!("queries/lua.scm")],
        class_kinds: &[],
        def_kinds: &["function_declaration", "assignment_statement"],
    },
    Spec {
        id: "bash",
        family: "shell",
        exts: &["sh", "bash", "zsh", "ksh"],
        names: &[".bashrc", ".zshrc", ".profile", ".bash_profile"],
        grammar: grammar!("lang-bash", tree_sitter_bash::LANGUAGE),
        queries: &[include_str!("queries/bash.scm")],
        class_kinds: &[],
        def_kinds: &["function_definition"],
    },
    Spec {
        id: "zig",
        family: "zig",
        exts: &["zig"],
        names: &[],
        grammar: grammar!("lang-zig", tree_sitter_zig::LANGUAGE),
        queries: &[include_str!("queries/zig.scm")],
        class_kinds: &[],
        def_kinds: &["function_declaration", "variable_declaration"],
    },
    Spec {
        id: "elixir",
        family: "beam",
        exts: &["ex", "exs"],
        names: &[],
        grammar: grammar!("lang-elixir", tree_sitter_elixir::LANGUAGE),
        queries: &[include_str!("queries/elixir.scm")],
        class_kinds: &[],
        def_kinds: &["call"],
    },
    Spec {
        id: "erlang",
        family: "beam",
        exts: &["erl", "hrl"],
        names: &[],
        grammar: grammar!("lang-erlang", tree_sitter_erlang::LANGUAGE),
        queries: &[include_str!("queries/erlang.scm")],
        class_kinds: &[],
        def_kinds: &["fun_decl", "record_decl"],
    },
    Spec {
        id: "gleam",
        family: "beam",
        exts: &["gleam"],
        names: &[],
        grammar: grammar!("lang-gleam", tree_sitter_gleam::LANGUAGE),
        queries: &[include_str!("queries/gleam.scm")],
        class_kinds: &[],
        def_kinds: &["function", "external_function", "type_definition", "type_alias"],
    },
    Spec {
        id: "haskell",
        family: "haskell",
        exts: &["hs", "lhs"],
        names: &[],
        grammar: grammar!("lang-haskell", tree_sitter_haskell::LANGUAGE),
        queries: &[include_str!("queries/haskell.scm")],
        class_kinds: &["class"],
        def_kinds: &["function", "bind", "data_type", "newtype", "type_synonym", "class"],
    },
    Spec {
        id: "ocaml",
        family: "ml",
        exts: &["ml"],
        names: &[],
        grammar: grammar!("lang-ocaml", tree_sitter_ocaml::LANGUAGE_OCAML),
        queries: &[include_str!("queries/ocaml.scm")],
        class_kinds: &["class_binding"],
        def_kinds: &["let_binding", "module_binding", "module_type_definition", "type_binding", "class_binding", "method_definition"],
    },
    Spec {
        id: "fsharp",
        family: "dotnet",
        exts: &["fs", "fsx"],
        names: &[],
        grammar: grammar!("lang-fsharp", tree_sitter_fsharp::LANGUAGE_FSHARP),
        queries: &[include_str!("queries/fsharp.scm")],
        class_kinds: &["type_definition"],
        def_kinds: &["function_or_value_defn", "type_definition", "member_defn", "module_defn"],
    },
    Spec {
        id: "elm",
        family: "elm",
        exts: &["elm"],
        names: &[],
        grammar: grammar!("lang-elm", tree_sitter_elm::LANGUAGE),
        queries: &[include_str!("queries/elm.scm")],
        class_kinds: &[],
        def_kinds: &["value_declaration", "type_declaration", "type_alias_declaration", "port_annotation"],
    },
    Spec {
        id: "julia",
        family: "julia",
        exts: &["jl"],
        names: &[],
        grammar: grammar!("lang-julia", tree_sitter_julia::LANGUAGE),
        queries: &[include_str!("queries/julia.scm")],
        class_kinds: &[],
        def_kinds: &[
            "function_definition",
            "macro_definition",
            "assignment",
            "struct_definition",
            "abstract_definition",
            "module_definition",
        ],
    },
    Spec {
        id: "r",
        family: "r",
        exts: &["r"],
        names: &[],
        grammar: grammar!("lang-r", tree_sitter_r::LANGUAGE),
        queries: &[include_str!("queries/r.scm")],
        class_kinds: &[],
        def_kinds: &["binary_operator"],
    },
    Spec {
        id: "objc",
        family: "c",
        exts: &["m", "mm"],
        names: &[],
        grammar: grammar!("lang-objc", tree_sitter_objc::LANGUAGE),
        queries: &[include_str!("queries/objc.scm")],
        class_kinds: &["class_implementation", "class_interface", "protocol_declaration"],
        def_kinds: &[
            "class_interface",
            "class_implementation",
            "protocol_declaration",
            "method_definition",
            "method_declaration",
            "function_definition",
            "struct_specifier",
        ],
    },
    Spec {
        id: "matlab",
        family: "matlab",
        exts: &["m"],
        names: &[],
        grammar: grammar!("lang-matlab", tree_sitter_matlab::LANGUAGE),
        queries: &[include_str!("queries/matlab.scm")],
        class_kinds: &["class_definition"],
        def_kinds: &["function_definition", "class_definition"],
    },
    Spec {
        id: "solidity",
        family: "solidity",
        exts: &["sol"],
        names: &[],
        grammar: grammar!("lang-solidity", tree_sitter_solidity::LANGUAGE),
        queries: &[include_str!("queries/solidity.scm")],
        class_kinds: &["contract_declaration", "library_declaration", "interface_declaration"],
        def_kinds: &[
            "contract_declaration",
            "library_declaration",
            "interface_declaration",
            "struct_declaration",
            "enum_declaration",
            "event_definition",
            "modifier_definition",
            "function_definition",
        ],
    },
    Spec {
        id: "sql",
        family: "sql",
        exts: &["sql"],
        names: &[],
        grammar: grammar!("lang-sql", tree_sitter_sequel::LANGUAGE),
        queries: &[include_str!("queries/sql.scm")],
        class_kinds: &[],
        def_kinds: &["create_table", "create_view", "create_materialized_view", "create_function"],
    },
    Spec {
        id: "hcl",
        family: "hcl",
        exts: &["tf", "tfvars", "hcl"],
        names: &[],
        grammar: grammar!("lang-hcl", tree_sitter_hcl::LANGUAGE),
        queries: &[include_str!("queries/hcl.scm")],
        class_kinds: &[],
        def_kinds: &["block"],
    },
    Spec {
        id: "graphql",
        family: "graphql",
        exts: &["graphql", "gql"],
        names: &[],
        grammar: grammar!("lang-graphql", tree_sitter_graphql::LANGUAGE),
        queries: &[include_str!("queries/graphql.scm")],
        class_kinds: &[],
        def_kinds: &[
            "object_type_definition",
            "interface_type_definition",
            "input_object_type_definition",
            "enum_type_definition",
            "union_type_definition",
            "scalar_type_definition",
            "operation_definition",
            "fragment_definition",
            "directive_definition",
        ],
    },
    Spec {
        id: "proto",
        family: "proto",
        exts: &["proto"],
        names: &[],
        grammar: grammar!("lang-proto", tree_sitter_proto::LANGUAGE),
        queries: &[include_str!("queries/proto.scm")],
        class_kinds: &["service"],
        def_kinds: &["message", "enum", "service", "rpc"],
    },
    Spec {
        id: "fortran",
        family: "fortran",
        exts: &["f90", "f95", "f03", "f08", "f", "for", "f77"],
        names: &[],
        grammar: grammar!("lang-fortran", tree_sitter_fortran::LANGUAGE),
        queries: &[include_str!("queries/fortran.scm")],
        class_kinds: &[],
        def_kinds: &["function", "subroutine", "module", "program", "derived_type_definition"],
    },
    Spec {
        id: "powershell",
        family: "powershell",
        exts: &["ps1", "psm1", "psd1"],
        names: &[],
        grammar: grammar!("lang-powershell", tree_sitter_powershell::LANGUAGE),
        queries: &[include_str!("queries/powershell.scm")],
        class_kinds: &["class_statement"],
        def_kinds: &["function_statement", "class_statement", "class_method_definition"],
    },
    Spec {
        id: "make",
        family: "make",
        exts: &["mk", "mak", "make"],
        names: &["Makefile", "makefile", "GNUmakefile"],
        grammar: grammar!("lang-make", tree_sitter_make::LANGUAGE),
        queries: &[include_str!("queries/make.scm")],
        class_kinds: &[],
        def_kinds: &["rule", "define_directive"],
    },
    Spec {
        id: "cmake",
        family: "cmake",
        exts: &["cmake"],
        names: &["CMakeLists.txt"],
        grammar: grammar!("lang-cmake", tree_sitter_cmake::LANGUAGE),
        queries: &[include_str!("queries/cmake.scm")],
        class_kinds: &[],
        def_kinds: &["function_def", "macro_def"],
    },
    Spec {
        id: "nix",
        family: "nix",
        exts: &["nix"],
        names: &[],
        grammar: grammar!("lang-nix", tree_sitter_nix::LANGUAGE),
        queries: &[include_str!("queries/nix.scm")],
        class_kinds: &[],
        def_kinds: &["binding"],
    },
    Spec {
        id: "verilog",
        family: "hdl",
        exts: &["v", "sv", "svh", "vh"],
        names: &[],
        grammar: grammar!("lang-verilog", tree_sitter_systemverilog::LANGUAGE),
        queries: &[include_str!("queries/verilog.scm")],
        class_kinds: &["class_declaration"],
        def_kinds: &[
            "module_declaration",
            "interface_declaration",
            "package_declaration",
            "class_declaration",
            "function_declaration",
            "task_declaration",
        ],
    },
    Spec {
        id: "vhdl",
        family: "hdl",
        exts: &["vhd", "vhdl"],
        names: &[],
        grammar: grammar!("lang-vhdl", tree_sitter_vhdl::LANGUAGE),
        queries: &[include_str!("queries/vhdl.scm")],
        class_kinds: &[],
        def_kinds: &[
            "entity_declaration",
            "architecture_definition",
            "package_declaration",
            "subprogram_definition",
            "subprogram_declaration",
        ],
    },
    Spec {
        id: "d",
        family: "d",
        exts: &["d", "di"],
        names: &[],
        grammar: grammar!("lang-d", tree_sitter_d::LANGUAGE),
        queries: &[include_str!("queries/d.scm")],
        class_kinds: &["class_declaration", "struct_declaration", "interface_declaration"],
        def_kinds: &[
            "function_declaration",
            "class_declaration",
            "struct_declaration",
            "interface_declaration",
            "enum_declaration",
            "template_declaration",
        ],
    },
    Spec {
        id: "pascal",
        family: "pascal",
        exts: &["pas", "dpr", "lpr"],
        names: &[],
        grammar: grammar!("lang-pascal", tree_sitter_pascal::LANGUAGE),
        queries: &[include_str!("queries/pascal.scm")],
        class_kinds: &["declClass"],
        def_kinds: &["defProc", "declProc", "declType"],
    },
    Spec {
        id: "ada",
        family: "ada",
        exts: &["adb", "ads", "ada"],
        names: &[],
        grammar: grammar!("lang-ada", tree_sitter_ada::LANGUAGE),
        queries: &[include_str!("queries/ada.scm")],
        class_kinds: &[],
        def_kinds: &["subprogram_body", "subprogram_declaration", "package_declaration", "package_body", "full_type_declaration"],
    },
    Spec {
        id: "commonlisp",
        family: "lisp",
        exts: &["lisp", "lsp", "cl", "asd"],
        names: &[],
        grammar: grammar!("lang-lisp", tree_sitter_commonlisp::LANGUAGE_COMMONLISP),
        queries: &[include_str!("queries/commonlisp.scm")],
        class_kinds: &[],
        def_kinds: &["defun", "list_lit"],
    },
    Spec {
        id: "elisp",
        family: "lisp",
        exts: &["el"],
        names: &[],
        grammar: grammar!("lang-lisp", tree_sitter_elisp::LANGUAGE),
        queries: &[include_str!("queries/elisp.scm")],
        class_kinds: &[],
        def_kinds: &["function_definition", "macro_definition"],
    },
    Spec {
        id: "racket",
        family: "scheme",
        exts: &["rkt", "rktl"],
        names: &[],
        grammar: grammar!("lang-scheme", tree_sitter_racket::LANGUAGE),
        queries: &[include_str!("queries/racket.scm")],
        class_kinds: &[],
        def_kinds: &["list"],
    },
    Spec {
        id: "scheme",
        family: "scheme",
        exts: &["scm", "ss", "sld"],
        names: &[],
        grammar: grammar!("lang-scheme", tree_sitter_scheme::LANGUAGE),
        queries: &[include_str!("queries/scheme.scm")],
        class_kinds: &[],
        def_kinds: &["list"],
    },
    Spec {
        id: "glsl",
        family: "shader",
        exts: &["glsl", "vert", "frag", "geom", "comp", "tesc", "tese"],
        names: &[],
        grammar: grammar!("lang-shaders", tree_sitter_glsl::LANGUAGE_GLSL),
        queries: &[include_str!("queries/glsl.scm")],
        class_kinds: &[],
        def_kinds: &["function_definition", "struct_specifier"],
    },
    Spec {
        id: "cuda",
        family: "c",
        exts: &["cu", "cuh"],
        names: &[],
        grammar: grammar!("lang-cuda", tree_sitter_cuda::LANGUAGE),
        queries: &[include_str!("queries/cuda.scm")],
        class_kinds: &["class_specifier", "struct_specifier"],
        def_kinds: &["function_definition", "class_specifier", "struct_specifier"],
    },
    Spec {
        id: "odin",
        family: "odin",
        exts: &["odin"],
        names: &[],
        grammar: grammar!("lang-odin", tree_sitter_odin::LANGUAGE),
        queries: &[include_str!("queries/odin.scm")],
        class_kinds: &[],
        def_kinds: &[
            "procedure_declaration",
            "overloaded_procedure_declaration",
            "struct_declaration",
            "enum_declaration",
            "union_declaration",
        ],
    },
    Spec {
        id: "starlark",
        family: "python",
        exts: &["bzl", "star", "bazel"],
        names: &["BUILD", "BUILD.bazel", "WORKSPACE", "Tiltfile"],
        grammar: grammar!("lang-starlark", tree_sitter_starlark::LANGUAGE),
        queries: &[include_str!("queries/starlark.scm")],
        class_kinds: &[],
        def_kinds: &["function_definition"],
    },
    Spec {
        id: "puppet",
        family: "puppet",
        exts: &["pp"],
        names: &[],
        grammar: grammar!("lang-puppet", tree_sitter_puppet::LANGUAGE),
        queries: &[include_str!("queries/puppet.scm")],
        class_kinds: &[],
        def_kinds: &["class_definition", "defined_resource_type", "function_declaration"],
    },
    Spec {
        id: "bicep",
        family: "bicep",
        exts: &["bicep"],
        names: &[],
        grammar: grammar!("lang-bicep", tree_sitter_bicep::LANGUAGE),
        queries: &[include_str!("queries/bicep.scm")],
        class_kinds: &[],
        def_kinds: &["user_defined_function", "resource_declaration", "module_declaration", "type_declaration"],
    },
];

fn spec(id: &str) -> Option<&'static Spec> {
    SPECS.iter().find(|s| s.id == id)
}

/// The call-resolution family of a language id.
pub fn family(id: &str) -> &str {
    spec(id).map(|s| s.family).unwrap_or(id)
}

/// The language of a path, by exact file name, then extension. An extension two
/// languages share (`.m`) goes to the first one this build has; `refine` settles
/// it once the content is read.
pub fn for_path(path: &str) -> Option<&'static str> {
    let name = path.rsplit('/').next()?;
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase());
    let built = SPECS.iter().filter(|s| s.grammar.is_some());
    let by_name = built.clone().find(|s| s.names.contains(&name));
    by_name.or_else(|| built.clone().find(|s| ext.as_deref().is_some_and(|e| s.exts.contains(&e)))).map(|s| s.id)
}

/// Settle an extension shared by two languages once the content is known:
/// `.m` is Objective-C or MATLAB.
pub fn refine(id: &'static str, src: &str) -> &'static str {
    if id == "objc" && spec("matlab").is_some_and(|s| s.grammar.is_some()) {
        let objc = ["@interface", "@implementation", "@protocol", "#import", "#include", "@end"].iter().any(|k| src.contains(k));
        if !objc {
            return "matlab";
        }
    }
    id
}

/// Source as the grammar should see it. Vue and Svelte components keep only
/// their <script> blocks; everything else becomes spaces so byte offsets and
/// line numbers still point into the original file.
pub fn prepare<'a>(id: &str, src: &'a str) -> std::borrow::Cow<'a, str> {
    if !matches!(id, "vue" | "svelte") {
        return std::borrow::Cow::Borrowed(src);
    }
    let mut out: Vec<u8> = src.bytes().map(|b| if b == b'\n' { b'\n' } else { b' ' }).collect();
    let lower = src.to_ascii_lowercase();
    let mut at = 0;
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
    let i = SPECS.iter().position(|s| s.id == id)?;
    CELLS[i].get_or_init(|| load(id)).as_ref()
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
                // `.m` is Objective-C or MATLAB, settled by `refine`.
                if let Some(o) = exts.insert(*e, s.id).filter(|_| *e != "m") {
                    panic!("{e} claimed by both {o} and {}", s.id);
                }
            }
        }
    }

    #[test]
    fn detection() {
        #[cfg(feature = "lang-make")]
        assert_eq!(for_path("a/b/Makefile"), Some("make"));
        #[cfg(feature = "lang-cmake")]
        assert_eq!(for_path("CMakeLists.txt"), Some("cmake"));
        assert_eq!(for_path("x/App.VUE"), Some("vue"));
        assert_eq!(for_path("main.rs"), Some("rust"));
        assert_eq!(for_path("README"), None);
        #[cfg(feature = "lang-matlab")]
        assert_eq!(for_path("a/f.m").map(|id| refine(id, "function y = f(x)\nend\n")), Some("matlab"));
        #[cfg(all(feature = "lang-objc", feature = "lang-matlab"))]
        assert_eq!(refine("objc", "function y = f(x)\n  y = x;\nend\n"), "matlab");
        assert_eq!(refine("objc", "#import <Foundation/Foundation.h>\n"), "objc");
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
