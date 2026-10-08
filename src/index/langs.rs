//! Language registry: grammars + the tree-sitter patterns Kula extracts.
//!
//! Captures:
//!   @def.function / @def.method / @def.class / @def.interface – a definition's name
//!   @call   – the callee name at a call site
//!   @import – an import statement or its module string
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

const RUST: &[&str] = &[
    "(function_item name: (identifier) @def.function)",
    "(function_signature_item name: (identifier) @def.function)",
    "(struct_item name: (type_identifier) @def.class)",
    "(enum_item name: (type_identifier) @def.class)",
    "(trait_item name: (type_identifier) @def.interface)",
    "(call_expression function: (identifier) @call)",
    "(call_expression function: (field_expression field: (field_identifier) @call))",
    "(call_expression function: (scoped_identifier name: (identifier) @call))",
    "(use_declaration argument: (_) @import)",
    "(mod_item name: (identifier) @import)",
];

const PYTHON: &[&str] = &[
    "(function_definition name: (identifier) @def.function)",
    "(class_definition name: (identifier) @def.class)",
    "(call function: (identifier) @call)",
    "(call function: (attribute attribute: (identifier) @call))",
    "(import_statement name: (dotted_name) @import)",
    "(import_from_statement module_name: (_) @import)",
];

const JS: &[&str] = &[
    "(function_declaration name: (identifier) @def.function)",
    "(generator_function_declaration name: (identifier) @def.function)",
    "(class_declaration name: (_) @def.class)",
    "(method_definition name: (property_identifier) @def.method)",
    "(variable_declarator name: (identifier) @def.function value: (arrow_function))",
    "(variable_declarator name: (identifier) @def.function value: (function_expression))",
    "(call_expression function: (identifier) @call)",
    "(call_expression function: (member_expression property: (property_identifier) @call))",
    "(new_expression constructor: (identifier) @call)",
    "(jsx_opening_element name: (identifier) @call)",
    "(jsx_self_closing_element name: (identifier) @call)",
    "(import_statement source: (string) @import)",
    "(call_expression function: (identifier) @_r arguments: (arguments (string) @import) (#eq? @_r \"require\"))",
];

const TS_EXTRA: &[&str] = &[
    "(interface_declaration name: (type_identifier) @def.interface)",
    "(type_alias_declaration name: (type_identifier) @def.interface)",
    "(abstract_class_declaration name: (type_identifier) @def.class)",
    "(enum_declaration name: (identifier) @def.class)",
];

const GO: &[&str] = &[
    "(function_declaration name: (identifier) @def.function)",
    "(method_declaration name: (field_identifier) @def.method)",
    "(type_spec name: (type_identifier) @def.class)",
    "(call_expression function: (identifier) @call)",
    "(call_expression function: (selector_expression field: (field_identifier) @call))",
    "(import_spec path: (interpreted_string_literal) @import)",
];

const JAVA: &[&str] = &[
    "(method_declaration name: (identifier) @def.function)",
    "(constructor_declaration name: (identifier) @def.function)",
    "(class_declaration name: (identifier) @def.class)",
    "(record_declaration name: (identifier) @def.class)",
    "(enum_declaration name: (identifier) @def.class)",
    "(interface_declaration name: (identifier) @def.interface)",
    "(method_invocation name: (identifier) @call)",
    "(object_creation_expression type: (type_identifier) @call)",
    "(import_declaration (scoped_identifier) @import)",
];

const C: &[&str] = &[
    "(function_definition declarator: (function_declarator declarator: (identifier) @def.function))",
    "(function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @def.function)))",
    "(struct_specifier name: (type_identifier) @def.class body: (_))",
    "(enum_specifier name: (type_identifier) @def.class body: (_))",
    "(type_definition declarator: (type_identifier) @def.class)",
    "(call_expression function: (identifier) @call)",
    "(call_expression function: (field_expression field: (field_identifier) @call))",
    "(preproc_include path: (_) @import)",
];

const CPP_EXTRA: &[&str] = &[
    "(function_definition declarator: (function_declarator declarator: (field_identifier) @def.function))",
    "(function_definition declarator: (function_declarator declarator: (qualified_identifier name: (identifier) @def.function)))",
    "(function_definition declarator: (reference_declarator (function_declarator declarator: (identifier) @def.function)))",
    "(class_specifier name: (type_identifier) @def.class body: (_))",
    "(call_expression function: (qualified_identifier name: (identifier) @call))",
    "(call_expression function: (template_function name: (identifier) @call))",
];

const CSHARP: &[&str] = &[
    "(method_declaration name: (identifier) @def.function)",
    "(constructor_declaration name: (identifier) @def.function)",
    "(local_function_statement name: (identifier) @def.function)",
    "(class_declaration name: (identifier) @def.class)",
    "(struct_declaration name: (identifier) @def.class)",
    "(record_declaration name: (identifier) @def.class)",
    "(enum_declaration name: (identifier) @def.class)",
    "(interface_declaration name: (identifier) @def.interface)",
    "(invocation_expression function: (identifier) @call)",
    "(invocation_expression function: (member_access_expression name: (identifier) @call))",
    "(object_creation_expression type: (identifier) @call)",
    "(using_directive (qualified_name) @import)",
    "(using_directive (identifier) @import)",
];

const RUBY: &[&str] = &[
    "(method name: (identifier) @def.function)",
    "(singleton_method name: (identifier) @def.function)",
    "(class name: (constant) @def.class)",
    "(module name: (constant) @def.class)",
    "(call method: (identifier) @call)",
    "((call method: (identifier) @_req arguments: (argument_list (string (string_content) @import))) (#match? @_req \"^require(_relative)?$\"))",
];

const PHP: &[&str] = &[
    "(function_definition name: (name) @def.function)",
    "(method_declaration name: (name) @def.function)",
    "(class_declaration name: (name) @def.class)",
    "(trait_declaration name: (name) @def.class)",
    "(enum_declaration name: (name) @def.class)",
    "(interface_declaration name: (name) @def.interface)",
    "(function_call_expression function: (name) @call)",
    "(member_call_expression name: (name) @call)",
    "(scoped_call_expression name: (name) @call)",
    "(object_creation_expression (name) @call)",
    "(namespace_use_clause (qualified_name) @import)",
];

pub fn for_path(path: &str) -> Option<&'static str> {
    let ext = path.rsplit('.').next()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "rs" => "rust",
        "py" | "pyi" => "python",
        "js" | "mjs" | "cjs" | "jsx" => "javascript",
        "ts" | "mts" | "cts" => "typescript",
        "tsx" => "tsx",
        "go" => "go",
        "java" => "java",
        "c" | "h" => "c",
        "cc" | "cpp" | "cxx" | "c++" | "hh" | "hpp" | "hxx" | "h++" | "ipp" => "cpp",
        "cs" => "csharp",
        "rb" | "rake" | "gemspec" => "ruby",
        "php" => "php",
        "s" | "S" | "asm" | "nasm" | "objdump" => "asm",
        _ => return None,
    })
}

/// Every language kula parses.
pub const IDS: [&str; 12] = ["rust", "python", "javascript", "typescript", "tsx", "go", "java", "c", "cpp", "csharp", "ruby", "php"];

/// A language's grammar and compiled queries, built once per process and shared
/// by every parser thread (query compilation dominates small indexes otherwise).
pub fn get(id: &str) -> Option<&'static Lang> {
    use std::sync::OnceLock;
    static CELLS: [OnceLock<Option<Lang>>; IDS.len()] = [const { OnceLock::new() }; IDS.len()];
    let i = IDS.iter().position(|l| *l == id)?;
    CELLS[i].get_or_init(|| load(id)).as_ref()
}

pub fn load(id: &str) -> Option<Lang> {
    let (language, pats, class_kinds, def_kinds): (Language, Vec<&str>, &[&str], &[&str]) = match id {
        "rust" => (
            tree_sitter_rust::LANGUAGE.into(),
            RUST.to_vec(),
            &["impl_item", "trait_item"],
            &["function_item", "function_signature_item", "struct_item", "enum_item", "trait_item"],
        ),
        "python" => {
            (tree_sitter_python::LANGUAGE.into(), PYTHON.to_vec(), &["class_definition"], &["function_definition", "class_definition"])
        }
        "javascript" => (
            tree_sitter_javascript::LANGUAGE.into(),
            JS.to_vec(),
            &["class_declaration", "class"],
            &["function_declaration", "generator_function_declaration", "class_declaration", "method_definition", "variable_declarator"],
        ),
        "typescript" | "tsx" => {
            let lang: Language =
                if id == "tsx" { tree_sitter_typescript::LANGUAGE_TSX.into() } else { tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into() };
            let mut p = JS.to_vec();
            p.extend_from_slice(TS_EXTRA);
            (
                lang,
                p,
                &["class_declaration", "abstract_class_declaration", "class"],
                &[
                    "function_declaration",
                    "generator_function_declaration",
                    "class_declaration",
                    "abstract_class_declaration",
                    "method_definition",
                    "variable_declarator",
                    "interface_declaration",
                ],
            )
        }
        "go" => (tree_sitter_go::LANGUAGE.into(), GO.to_vec(), &[], &["function_declaration", "method_declaration", "type_spec"]),
        "java" => (
            tree_sitter_java::LANGUAGE.into(),
            JAVA.to_vec(),
            &["class_declaration", "interface_declaration", "enum_declaration", "record_declaration"],
            &[
                "method_declaration",
                "constructor_declaration",
                "class_declaration",
                "interface_declaration",
                "enum_declaration",
                "record_declaration",
            ],
        ),
        "c" => (
            tree_sitter_c::LANGUAGE.into(),
            C.to_vec(),
            &[],
            &["function_definition", "struct_specifier", "enum_specifier", "type_definition"],
        ),
        "cpp" => {
            let mut p = C.to_vec();
            p.extend_from_slice(CPP_EXTRA);
            (
                tree_sitter_cpp::LANGUAGE.into(),
                p,
                &["class_specifier", "struct_specifier"],
                &["function_definition", "class_specifier", "struct_specifier", "enum_specifier", "type_definition"],
            )
        }
        "csharp" => (
            tree_sitter_c_sharp::LANGUAGE.into(),
            CSHARP.to_vec(),
            &["class_declaration", "struct_declaration", "record_declaration", "interface_declaration"],
            &[
                "method_declaration",
                "constructor_declaration",
                "local_function_statement",
                "class_declaration",
                "struct_declaration",
                "record_declaration",
                "enum_declaration",
                "interface_declaration",
            ],
        ),
        "ruby" => {
            (tree_sitter_ruby::LANGUAGE.into(), RUBY.to_vec(), &["class", "module"], &["method", "singleton_method", "class", "module"])
        }
        "php" => (
            tree_sitter_php::LANGUAGE_PHP.into(),
            PHP.to_vec(),
            &["class_declaration", "trait_declaration", "interface_declaration", "enum_declaration"],
            &[
                "function_definition",
                "method_declaration",
                "class_declaration",
                "trait_declaration",
                "enum_declaration",
                "interface_declaration",
            ],
        ),
        _ => return None,
    };
    let queries = compile(&language, &pats);
    Some(Lang { id: IDS.iter().find(|l| **l == id)?, language, queries, class_kinds, def_kinds })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every pattern of every language compiles against its grammar: a grammar
    /// bump that renames a node kind fails here instead of silently losing symbols.
    #[test]
    fn every_pattern_compiles() {
        let mut broken = vec![];
        for id in IDS {
            let l = load(id).unwrap_or_else(|| panic!("{id} did not load"));
            let pats: Vec<&str> = match id {
                "rust" => RUST.to_vec(),
                "python" => PYTHON.to_vec(),
                "javascript" => JS.to_vec(),
                "typescript" | "tsx" => [JS, TS_EXTRA].concat(),
                "go" => GO.to_vec(),
                "java" => JAVA.to_vec(),
                "c" => C.to_vec(),
                "cpp" => [C, CPP_EXTRA].concat(),
                "csharp" => CSHARP.to_vec(),
                "ruby" => RUBY.to_vec(),
                _ => PHP.to_vec(),
            };
            // JSX belongs to .jsx/.tsx; plain TypeScript drops those patterns by design.
            for p in pats.into_iter().filter(|p| !(id == "typescript" && p.contains("jsx_"))) {
                if let Err(e) = Query::new(&l.language, p) {
                    broken.push(format!("{id}: {p}\n    {e}"));
                }
            }
        }
        assert!(broken.is_empty(), "patterns that do not compile:\n{}", broken.join("\n"));
    }
}
