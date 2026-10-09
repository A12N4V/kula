; Sway: generated from the grammar's node types

(abi_call_expression function: (field_expression field: (field_identifier) @call))

(call_expression function: (identifier) @call)

(call_expression function: (scoped_identifier) @call)

(call_expression function: (field_expression field: (field_identifier) @call))

(call_expression function: (struct_expression name: (scoped_type_identifier) @call))

(call_expression function: (struct_expression name: (type_identifier) @call))

(enum_item name: (type_identifier) @def.class)

(function_item name: (identifier) @def.function)

(function_signature_item name: (identifier) @def.function)

(source_file) @import

(struct_item name: (type_identifier) @def.class)

(trait_item name: (type_identifier) @def.interface)

(use_as_clause path: (_) @import)

(use_declaration) @import

(use_list) @import

(use_wildcard) @import
