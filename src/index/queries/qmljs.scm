(function_declaration name: (identifier) @def.function)

(ui_object_definition type_name: (identifier) @call)

(call_expression function: (identifier) @call)

(call_expression function: (member_expression property: (property_identifier) @call))

(ui_import source: (_) @import)
