((module type: (identifier) property: (property field: (identifier) @_n value: (interpreted_string_literal) @def.class)) (#eq? @_n "name"))

(module type: (identifier) @call)

((property field: (identifier) @_d value: (list_expression element: (interpreted_string_literal) @call)) (#match? @_d "^(defaults|deps|static_libs|shared_libs|header_libs)$"))
