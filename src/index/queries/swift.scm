(class_declaration name: (type_identifier) @def.class)

(protocol_declaration name: (type_identifier) @def.interface)

(function_declaration name: (simple_identifier) @def.function)

(protocol_function_declaration name: (simple_identifier) @def.function)

(init_declaration "init" @def.function)

(call_expression . (simple_identifier) @call)

(call_expression . (navigation_expression suffix: (navigation_suffix suffix: (simple_identifier) @call)))

(import_declaration (identifier) @import)
