(function_declaration name: (identifier) @def.function)

(function_declaration name: (dot_index_expression field: (identifier) @def.function))

(function_declaration name: (method_index_expression method: (identifier) @def.method))

(type_definition name: (identifier) @def.class)

(function_call name: (identifier) @call)

(function_call name: (dot_index_expression field: (identifier) @call))

(function_call name: (method_index_expression method: (identifier) @call))

((function_call name: (identifier) @_r arguments: (arguments (_) @import)) (#eq? @_r "require"))
