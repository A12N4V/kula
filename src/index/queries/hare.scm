(function_declaration name: (identifier) @def.function)

(type_declaration . (identifier) @def.class)

(call_expression callee: (identifier) @call)

(call_expression callee: (scoped_type_identifier name: (identifier) @call))

(use_statement (_) @import)
