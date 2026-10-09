; Faust: generated from the grammar's node types

(file_import filename: (_) @import)

(function_call callee: (identifier) @call)

(function_call callee: (fconst name: (identifier) @call))

(function_call callee: (fvariable name: (identifier) @call))

(function_call callee: (infix right: (identifier) @call))

(function_call callee: (merge right: (identifier) @call))

(function_call callee: (parallel right: (identifier) @call))

(function_call callee: (prefix right: (identifier) @call))

(function_call callee: (recursive right: (identifier) @call))

(function_call callee: (sequential right: (identifier) @call))

(function_call callee: (split right: (identifier) @call))

(function_definition name: (identifier) @def.function)
