(decl_def unquoted_name: (_) @def.function)

(decl_def quoted_name: (_) @def.function)

(decl_module (cmd_identifier) @def.class)

(command head: (cmd_identifier) @call)

(decl_use module: (_) @import)

((command head: (cmd_identifier) @_s arg_str: (_) @import) (#any-of? @_s "source" "source-env"))
