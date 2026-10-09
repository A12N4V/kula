(label (ident) @def.function)

((instruction kind: (word) @_i (ident) @call) (#match? @_i "^(?i)(call|bl|blx|jal|jmp|b)$"))
