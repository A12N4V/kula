(function_definition name: (identifier) @def.function)

(call function: (identifier) @call)

(call function: (attribute attribute: (identifier) @call))

((call function: (identifier) @_l arguments: (argument_list . (string) @import)) (#eq? @_l "load"))
