(function_statement (function_name) @def.function)

(class_statement . (simple_name) @def.class)

(class_method_definition (simple_name) @def.method)

(command command_name: (command_name) @call)

((command command_name: (command_name) @_c command_elements: (command_elements (generic_token) @import)) (#match? @_c "^(?i)(import-module|using)$"))

(command (command_invokation_operator) command_name: (command_name_expr (command_name) @import))
