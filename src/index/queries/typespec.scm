; TypeSpec: generated from the grammar's node types

(enum_statement name: (identifier) @def.class)

(function_declaration_statement name: (identifier) @def.function)

(import_statement) @import

(interface_statement name: (identifier) @def.interface)

(namespace_statement name: (identifier_or_member_expression) @def.class)

(source_file) @import

(union_statement name: (identifier) @def.class)

(using_statement module: (_) @import)
