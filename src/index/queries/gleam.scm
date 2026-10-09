(function name: (identifier) @def.function)

(external_function name: (identifier) @def.function)

(type_definition (type_name name: (type_identifier) @def.class))

(type_alias (type_name name: (type_identifier) @def.class))

(function_call function: (identifier) @call)

(function_call function: (field_access field: (label) @call))

(import module: (module) @import)
