(method_declaration name: (identifier) @def.function)

(constructor_declaration name: (identifier) @def.function)

(class_declaration name: (identifier) @def.class)

(record_declaration name: (identifier) @def.class)

(enum_declaration name: (identifier) @def.class)

(interface_declaration name: (identifier) @def.interface)

(method_invocation name: (identifier) @call)

(object_creation_expression type: (type_identifier) @call)

(import_declaration (scoped_identifier) @import)
