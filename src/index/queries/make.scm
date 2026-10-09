(rule (targets (word) @def.function))

(define_directive name: (word) @def.function)

(prerequisites (word) @call)

(include_directive filenames: (list (word) @import))
