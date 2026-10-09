; SpiceDB: generated from the grammar's node types

(call_expression function: (identifier) @call)

(call_expression function: (binary_expression right: (identifier) @call))

(call_expression function: (selector_expression field: (field_identifier) @call))

(definition name: (identifier) @def.function)

(import_statement path: (_) @import)

(source_file) @import
