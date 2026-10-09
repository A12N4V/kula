((list . (symbol) @_k . (symbol) @def.function) @scope (#any-of? @_k "defn" "defop" "def"))

((list . (symbol) @call) (#not-any-of? @call "defn" "defop" "def" "let" "if" "do" "fn" "use" "case" "cond" "quote"))

((list . (symbol) @_u (_) @import) (#eq? @_u "use"))
