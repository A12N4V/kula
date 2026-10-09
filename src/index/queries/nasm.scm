(label name: (word) @def.function)

((actual_instruction instruction: (word) @_i operands: (operands . (operand (word) @call))) (#match? @_i "^(?i)(call|jmp|j[a-z]+)$"))

(preproc_include path: (_) @import)
