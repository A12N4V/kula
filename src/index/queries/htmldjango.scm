((paired_statement (tag_name) @_t . (variable (variable_name) @def.function)) (#eq? @_t "block"))

(filter (filter_name) @call)

((unpaired_statement (tag_name) @_t . (string) @import) (#any-of? @_t "extends" "include"))

((unpaired_statement (tag_name) @_t . (variable (variable_name) @import)) (#eq? @_t "load"))
