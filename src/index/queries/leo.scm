; Leo: generated from the grammar's node types

(assert_call . (variable) @call)

(assert_equal_call . (variable) @call)

(assert_not_equal_call . (variable) @call)

(associated_function_call . (identifier) @call)

(free_function_call . (identifier) @call)

(function_declaration name: (identifier) @def.function)

(import_declaration) @import

(method_call . (identifier) @call)

(record_declaration . (identifier) @def.class)

(source_file) @import

(struct_component_declaration . (identifier) @def.class)

(struct_declaration name: (identifier) @def.class)
