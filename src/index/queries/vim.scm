; Vim Script: generated from the grammar's node types

(call_expression function: (identifier) @call)

(call_expression function: (scoped_identifier) @call)

(call_expression function: (binary_operation right: (identifier) @call))

(call_expression function: (binary_operation right: (scoped_identifier) @call))

(call_expression function: (field_expression field: (identifier) @call))

(call_expression function: (ternary_expression right: (identifier) @call))

(call_expression function: (ternary_expression right: (scoped_identifier) @call))

(command_statement name: (command_name) @call)

(function_declaration name: [(identifier) (scoped_identifier)] @def.function)

(let_statement . (identifier) @def.function)

(source_statement file: (_) @import)

(user_command . (command_name) @call)
