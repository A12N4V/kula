((list . (symbol) @_k . (list . (symbol) @def.function)) (#any-of? @_k "define" "define/contract" "define-syntax" "define-syntax-rule"))

((list . (symbol) @_k . (symbol) @def.function . (list . (symbol) @_l)) (#eq? @_k "define") (#any-of? @_l "lambda" "λ" "case-lambda"))

((list . (symbol) @_k . (symbol) @def.class) (#eq? @_k "struct"))

((list . (symbol) @call) (#not-any-of? @call "define" "define-syntax" "define-syntax-rule" "define/contract" "lambda" "λ" "let" "let*" "letrec" "if" "cond" "when" "unless" "begin" "quote" "require" "provide" "struct" "else"))

((list . (symbol) @_r (_) @import) (#eq? @_r "require"))
