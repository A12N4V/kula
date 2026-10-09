(function_item name: (identifier) @def.function)

(function_signature_item name: (identifier) @def.function)

(struct_item name: (type_identifier) @def.class)

(enum_item name: (type_identifier) @def.class)

(trait_item name: (type_identifier) @def.interface)

(call_expression function: (identifier) @call)

(call_expression function: (field_expression field: (field_identifier) @call))

(call_expression function: (scoped_identifier name: (identifier) @call))

(use_declaration argument: (_) @import)

(mod_item name: (identifier) @import)
