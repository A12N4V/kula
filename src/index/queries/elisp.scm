(function_definition name: (symbol) @def.function)

(macro_definition name: (symbol) @def.function)

((list . (symbol) @call) (#not-any-of? @call "let" "let*" "if" "when" "unless" "cond" "progn" "setq" "lambda" "quote" "require" "provide" "defvar" "defcustom" "defconst"))

((list . (symbol) @_r . (quote (symbol) @import)) (#any-of? @_r "require" "load"))
