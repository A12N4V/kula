(binary_operator lhs: (identifier) @def.function rhs: (function_definition))

(call function: (identifier) @call)

(call function: (namespace_operator rhs: (identifier) @call))

((call function: (identifier) @_f arguments: (arguments argument: (argument value: (_) @import))) (#any-of? @_f "library" "require" "source" "requireNamespace"))
