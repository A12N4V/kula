((par_tup_lit . (sym_lit) @_k . (sym_lit) @def.function) @scope (#any-of? @_k "defn" "defn-" "defmacro" "defmacro-" "varfn"))

((par_tup_lit . (sym_lit) @call) (#not-any-of? @call "defn" "defn-" "defmacro" "defmacro-" "def" "var" "let" "if" "do" "fn" "when" "cond" "import" "use" "quote"))

((par_tup_lit . (sym_lit) @_i . (sym_lit) @import) (#any-of? @_i "import" "use"))
