(function_statement name: (name) @def.function)

(subroutine_statement name: (name) @def.function)

(module_statement (name) @def.class)

(program_statement (name) @def.class)

(derived_type_statement (type_name) @def.class)

(subroutine_call subroutine: (identifier) @call)

(call_expression . (identifier) @call)

(use_statement (module_name) @import)
