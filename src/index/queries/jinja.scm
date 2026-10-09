(macro_statement (function_call . (identifier) @def.function))

(primary_expression (function_call . (identifier) @call))

(import_statement (string_literal) @import)

(include_statement (string_literal) @import)

(extends_statement (string_literal) @import)
