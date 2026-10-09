(function_def (function_command (argument_list . (argument) @def.function)))

(macro_def (macro_command (argument_list . (argument) @def.function)))

(normal_command (identifier) @call)

((normal_command (identifier) @_c (argument_list . (argument) @import)) (#match? @_c "^(?i)(include|add_subdirectory|find_package)$"))
