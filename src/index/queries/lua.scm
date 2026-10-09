(function_declaration name: (identifier) @def.function)

(function_declaration name: (dot_index_expression field: (identifier) @def.function))

(function_declaration name: (method_index_expression method: (identifier) @def.method))

(assignment_statement (variable_list name: (identifier) @def.function) (expression_list value: (function_definition)))

(function_call name: (identifier) @call)

(function_call name: (dot_index_expression field: (identifier) @call))

(function_call name: (method_index_expression method: (identifier) @call))

((function_call name: (identifier) @_r arguments: (arguments (string content: (string_content) @import))) (#eq? @_r "require"))
