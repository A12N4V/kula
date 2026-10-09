(function_definition name: (name) @def.function)

(method_declaration name: (name) @def.function)

(class_declaration name: (name) @def.class)

(trait_declaration name: (name) @def.class)

(enum_declaration name: (name) @def.class)

(interface_declaration name: (name) @def.interface)

(function_call_expression function: (name) @call)

(member_call_expression name: (name) @call)

(scoped_call_expression name: (name) @call)

(object_creation_expression (name) @call)

(namespace_use_clause (qualified_name) @import)
