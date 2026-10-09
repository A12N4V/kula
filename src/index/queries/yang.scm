(module module_name: (identifier) @def.class)

(submodule (identifier) @def.class)

((statement (statement_keyword) @_k . (argument (node_identifier) @def.class)) (#any-of? @_k "grouping" "container" "list" "typedef" "identity" "augment" "choice"))

((statement (statement_keyword) @_k . (argument (node_identifier) @def.function)) (#any-of? @_k "rpc" "action" "notification" "feature"))

((statement (statement_keyword) @_k . (argument (node_identifier) @call)) (#any-of? @_k "uses" "if-feature" "base"))

((statement (statement_keyword) @_k . (argument (node_identifier) @import)) (#any-of? @_k "import" "include"))
