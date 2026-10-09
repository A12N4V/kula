((list_lit . (sym_lit name: (sym_name) @_k) . (sym_lit name: (sym_name) @def.function)) @scope (#any-of? @_k "defn" "defn-" "defmacro" "defmulti" "defmethod" "def" "deftest"))

((list_lit . (sym_lit name: (sym_name) @_k) . (sym_lit name: (sym_name) @def.class)) @scope (#any-of? @_k "defrecord" "deftype" "defstruct"))

((list_lit . (sym_lit name: (sym_name) @_k) . (sym_lit name: (sym_name) @def.interface)) @scope (#eq? @_k "defprotocol"))

((list_lit . (sym_lit name: (sym_name) @_k) . (sym_lit name: (sym_name) @def.class)) @scope (#eq? @_k "ns"))

((list_lit . (sym_lit name: (sym_name) @call)) (#not-any-of? @call "defn" "defn-" "defmacro" "defmulti" "defmethod" "def" "deftest" "defrecord" "deftype" "defprotocol" "ns" "let" "if" "do" "fn" "when" "cond" "loop" "recur" "quote"))

((list_lit . (kwd_lit name: (kwd_name) @_r) (vec_lit . (sym_lit) @import)) (#any-of? @_r "require" "use" "import"))
