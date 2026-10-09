(function_declaration name: (identifier) @def.function)

(struct_declaration name: (identifier) @def.class)

(interface_declaration name: (identifier) @def.interface)

(enum_declaration name: (identifier) @def.class)

(call_expression name: (reference_expression (identifier) @call))

(call_expression name: (selector_expression field: (reference_expression (identifier) @call)))

(import_spec (import_path) @import)
