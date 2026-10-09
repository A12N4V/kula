(function_statement name: (identifier) @def.function)

(sub_statement name: (identifier) @def.function)

(function_call function: (prefix_exp (identifier) @call))

(library_statement path: (string) @import)
