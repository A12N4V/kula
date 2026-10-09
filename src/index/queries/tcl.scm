(procedure name: (_) @def.function)

((command name: (simple_word) @_n arguments: (word_list . (simple_word) @def.class)) (#any-of? @_n "namespace" "oo::class" "itcl::class" "class"))

((command name: (simple_word) @call) (#not-any-of? @call "set" "return" "if" "else" "for" "foreach" "while" "expr" "puts" "package" "source" "proc" "namespace"))

((command name: (simple_word) @_p arguments: (word_list . (simple_word) @_r . (simple_word) @import)) (#eq? @_p "package") (#eq? @_r "require"))

((command name: (simple_word) @_s arguments: (word_list . (_) @import)) (#eq? @_s "source"))
