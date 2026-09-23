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

fn compile(language: &Language, patterns: &[&str]) -> Vec<Query> {
    patterns.iter().filter_map(|p| Query::new(language, p).ok()).collect()
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
    "(macro_invocation macro: (identifier) @call)",
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

pub fn for_path(path: &str) -> Option<&'static str> {
    let ext = path.rsplit('.').next()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "rs" => "rust",
        "py" | "pyi" => "python",
        "js" | "mjs" | "cjs" | "jsx" => "javascript",
        "ts" | "mts" | "cts" => "typescript",
        "tsx" => "tsx",
        "go" => "go",
        _ => return None,
    })
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
        _ => return None,
    };
    let queries = compile(&language, &pats);
    Some(Lang {
        id: match id {
            "rust" => "rust",
            "python" => "python",
            "javascript" => "javascript",
            "typescript" => "typescript",
            "tsx" => "tsx",
            _ => "go",
        },
        language,
        queries,
        class_kinds,
        def_kinds,
    })
}
