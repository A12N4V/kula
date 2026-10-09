(func_definition (func_header name: (_) @def.function))

(macro_declaration (macro_header name: (_) @def.function))

(struct_declaration name: (_) @def.class)

(enum_declaration name: (_) @def.class)

(interface_declaration name: (_) @def.interface)

(call_expr function: (ident_expr (ident) @call .))

(import_declaration (import_path) @import)
