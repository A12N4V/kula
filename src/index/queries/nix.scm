(binding attrpath: (attrpath . (identifier) @def.function .) expression: (function_expression))

(apply_expression function: (variable_expression name: (identifier) @call))

(apply_expression function: (select_expression attrpath: (attrpath (identifier) @call .)))

((apply_expression function: (variable_expression name: (identifier) @_i) argument: [(path_expression) (spath_expression)] @import) (#eq? @_i "import"))
