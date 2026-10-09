(function_definition name: (word) @def.function)

(command name: (command_name (word) @call))

((command name: (command_name (word) @_s) argument: (_) @import) (#any-of? @_s "source" "."))
