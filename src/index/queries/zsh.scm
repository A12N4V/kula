; Shell: generated from the grammar's node types

(arithmetic_call name: (word) @call)

(command name: (command_name) @call)

(function_definition name: (word) @def.function)

(unset_command . (simple_variable_name) @call)
