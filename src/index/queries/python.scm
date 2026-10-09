(function_definition name: (identifier) @def.function)

(class_definition name: (identifier) @def.class)

(call function: (identifier) @call)

(call function: (attribute attribute: (identifier) @call))

(import_statement name: (dotted_name) @import)

(import_from_statement module_name: (_) @import)
