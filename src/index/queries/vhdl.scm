(entity_declaration entity: (identifier) @def.class)

(architecture_definition architecture: (identifier) @def.class)

(package_declaration package: (identifier) @def.class)

(function_specification function: (identifier) @def.function)

(procedure_specification procedure: (identifier) @def.function)

(instantiated_unit entity: (name (identifier) @call))

(instantiated_unit (name (identifier) @call))

(procedure_call_statement (name (identifier) @call))

(use_clause (selected_name_list) @import)
