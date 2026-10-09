(user_defined_function name: (identifier) @def.function)

(resource_declaration (identifier) @def.class)

(module_declaration (identifier) @def.class)

(type_declaration (identifier) @def.class)

(call_expression function: (identifier) @call)

(call_expression function: (member_expression property: (property_identifier) @call))

(module_declaration (string) @import)

(import_statement (string) @import)
