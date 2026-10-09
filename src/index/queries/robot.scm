(keyword_definition (name) @def.function)

(test_case_definition (name) @def.function)

(keyword_invocation (keyword) @call)

((setting_statement name: (setting_name) @_s (arguments . (argument) @import)) (#match? @_s "^(Library|Resource|Variables)$"))
