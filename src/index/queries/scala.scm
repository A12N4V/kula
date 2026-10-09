(class_definition name: (identifier) @def.class)

(object_definition name: (identifier) @def.class)

(trait_definition name: (identifier) @def.interface)

(enum_definition name: (identifier) @def.class)

(function_definition name: (identifier) @def.function)

(function_declaration name: (identifier) @def.function)

(call_expression function: (identifier) @call)

(call_expression function: (field_expression field: (identifier) @call))

(instance_expression (type_identifier) @call)

(import_declaration) @import
