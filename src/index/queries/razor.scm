; HTML+Razor: generated from the grammar's node types

(calling_convention . (identifier) @call)

(class_declaration name: (identifier) @def.class)

(constructor_declaration name: (identifier) @def.class)

(destructor_declaration name: (identifier) @def.class)

(enum_declaration name: (identifier) @def.class)

(enum_member_declaration name: (identifier) @def.class)

(file_scoped_namespace_declaration name: [(alias_qualified_name) (generic_name) (identifier) (qualified_name)] @def.class)

(interface_declaration name: (identifier) @def.interface)

(invocation_expression function: (alias_qualified_name) @call)

(invocation_expression function: (generic_name) @call)

(invocation_expression function: (identifier) @call)

(invocation_expression function: (member_access_expression name: (generic_name) @call))

(invocation_expression function: (member_access_expression name: (identifier) @call))

(local_function_statement name: (identifier) @def.function)

(method_declaration name: (identifier) @def.method)

(namespace_declaration name: [(alias_qualified_name) (generic_name) (identifier) (qualified_name)] @def.class)

(razor_compound_using) @import

(razor_using_directive name: (_) @import)

(record_declaration name: (identifier) @def.class)

(struct_declaration name: (identifier) @def.class)

(using_directive name: (_) @import)

(using_statement) @import
