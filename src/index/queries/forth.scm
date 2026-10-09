(word_definition (start_definition) . (word) @def.function)

(word_definition (word) @call)

((source_file (word) @_i . (word) @import) (#any-of? @_i "include" "require" "needs"))
