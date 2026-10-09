(function_specification name: (_) @def.function)

(procedure_specification name: (_) @def.function)

(package_declaration name: (_) @def.class)

(package_body name: (_) @def.class)

(full_type_declaration . (identifier) @def.class)

(function_call name: (identifier) @call)

(function_call name: (selected_component selector_name: (identifier) @call))

(procedure_call_statement name: (identifier) @call)

(procedure_call_statement name: (selected_component selector_name: (identifier) @call))

(with_clause (_) @import)
