(function_definition . (identifier) @def.function)

(struct_item name: (type_identifier) @def.class)

(trait_item name: (_) @def.interface)

(enum_item name: (_) @def.class)

(call_expression function: (identifier) @call)

(call_expression function: (scoped_identifier name: (identifier) @call))

(use_declaration argument: (_) @import)
