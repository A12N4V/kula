(method_declaration name: (identifier) @def.function)

(constructor_declaration name: (identifier) @def.function)

(local_function_statement name: (identifier) @def.function)

(class_declaration name: (identifier) @def.class)

(struct_declaration name: (identifier) @def.class)

(record_declaration name: (identifier) @def.class)

(enum_declaration name: (identifier) @def.class)

(interface_declaration name: (identifier) @def.interface)

(invocation_expression function: (identifier) @call)

(invocation_expression function: (member_access_expression name: (identifier) @call))

(object_creation_expression type: (identifier) @call)

(using_directive (qualified_name) @import)

(using_directive (identifier) @import)
