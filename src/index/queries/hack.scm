(function_declaration name: (identifier) @def.function)

(method_declaration name: (identifier) @def.method)

(class_declaration name: (identifier) @def.class)

(interface_declaration name: (identifier) @def.interface)

(trait_declaration name: (identifier) @def.class)

(call_expression function: (qualified_identifier (identifier) @call .))

(call_expression function: (selection_expression (identifier) @call .))

(use_statement (use_clause (qualified_identifier) @import))
