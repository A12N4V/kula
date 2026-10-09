(function_declaration name: (identifier) @def.function)

(variable_declaration (identifier) @def.class (struct_declaration))

(variable_declaration (identifier) @def.class (enum_declaration))

(variable_declaration (identifier) @def.class (union_declaration))

(call_expression function: (identifier) @call)

(call_expression function: (field_expression member: (identifier) @call))

((builtin_function (builtin_identifier) @_i (arguments (string (string_content) @import))) (#eq? @_i "@import"))
