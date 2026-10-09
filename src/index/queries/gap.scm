; GAP: generated from the grammar's node types and its tags.scm

(assignment_statement
  left: (identifier) @name
  right: [
    (lambda)
    (function)
    (atomic_function)
  ]) @definition.function

(call
  function: (identifier) @name) @reference.call

(call function: (identifier) @call)

(call function: (component_selector selector: (identifier) @call))

(call function: (list_selector selector: (identifier) @call))

(call function: (positional_selector selector: (identifier) @call))

(call function: (record_selector selector: (identifier) @call))

(call function: (sublist_selector selector: (identifier) @call))

(function_call_option . (identifier) @call)

(source_file) @import
