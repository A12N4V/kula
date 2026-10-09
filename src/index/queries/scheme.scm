((list . (symbol) @_k . (list . (symbol) @def.function)) (#any-of? @_k "define" "define-syntax" "define-record-type"))

((list . (symbol) @_k . (symbol) @def.function . (list . (symbol) @_l)) (#eq? @_k "define") (#eq? @_l "lambda"))

((list . (symbol) @_k . (symbol) @def.class) (#eq? @_k "define-record-type"))

((list . (symbol) @call) (#not-any-of? @call "define" "define-syntax" "define-record-type" "define-library" "lambda" "let" "let*" "letrec" "if" "cond" "when" "unless" "begin" "quote" "import" "export" "else" "set!"))

((list . (symbol) @_r (_) @import) (#any-of? @_r "import" "require" "use-modules" "load"))
