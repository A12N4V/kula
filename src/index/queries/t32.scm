; t32: generated from the grammar's node types and its tags.scm

(subroutine_block
  command: (identifier)
  subroutine: (identifier) @name) @definition.function

(labeled_expression
  label: (identifier) @name
  (block)) @definition.function

(subroutine_call_expression
  command: (identifier)
  subroutine: (identifier) @name) @reference.call

(call_expression function: (identifier) @call)

(call_expression function: (symbol) @call)

(call_expression function: (assignment_expression right: (identifier) @call))

(call_expression function: (assignment_expression right: (symbol) @call))

(call_expression function: (binary_expression right: (identifier) @call))

(call_expression function: (binary_expression right: (symbol) @call))

(command_expression command: (identifier) @call)

(hll_call_expression function: (identifier) @call)

(hll_call_expression function: (symbol) @call)

(hll_call_expression function: (hll_assignment_expression right: (identifier) @call))

(hll_call_expression function: (hll_assignment_expression right: (symbol) @call))

(hll_call_expression function: (hll_binary_expression right: (identifier) @call))

(hll_call_expression function: (hll_binary_expression right: (symbol) @call))

(hll_call_expression function: (hll_field_expression field: (hll_field_identifier) @call))

(subroutine_call_expression command: (identifier) @call)
