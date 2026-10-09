(component_declaration name: (component_identifier) @def.class)

(function_declaration name: (identifier) @def.function)

(method_declaration name: (field_identifier) @def.method)

(type_spec name: (type_identifier) @def.class)

(call_expression function: (identifier) @call)

(call_expression function: (selector_expression field: (field_identifier) @call))

(component_import name: (component_identifier) @call)

(import_spec path: (interpreted_string_literal) @import)
