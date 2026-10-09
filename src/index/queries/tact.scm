; Tact: generated from the grammar's node types and its tags.scm

(
  (comment)* @doc
  .
  [
    (contract
      name: (identifier) @name)
    (message
      name: (type_identifier) @name)
    (struct
      name: (type_identifier) @name)
  ] @definition.class
  (#strip! @doc "^[\\s\\*/]+|^[\\s\\*/]$")
  (#select-adjacent! @doc @definition.class)
)

(
  (comment)* @doc
  .
  [
    (native_function
      name: (identifier) @name)
    (asm_function
      name: (identifier) @name)
    (global_function
      name: (identifier) @name)
  ] @definition.function
  (#strip! @doc "^[\\s\\*/]+|^[\\s\\*/]$")
  (#select-adjacent! @doc @definition.function)
)

(
  (comment)* @doc
  .
  (trait
    name: (identifier) @name) @definition.interface
  (#strip! @doc "^[\\s\\*/]+|^[\\s\\*/]$")
  (#select-adjacent! @doc @definition.interface)
)

(
  (comment)* @doc
  .
  [
    (init_function "init" @name)
    (receive_function "receive" @name)
    (bounced_function "bounced" @name)
    (external_function "external" @name)
    (storage_function
      name: (identifier) @name)
  ] @definition.method
  (#strip! @doc "^[\\s\\*/]+|^[\\s\\*/]$")
  (#select-adjacent! @doc @definition.method)
)

(
  (comment)* @doc
  .
  [
    (global_constant
      name: (identifier) @name)
    (storage_constant
      name: (identifier) @name)
  ] @definition.constant
  (#strip! @doc "^[\\s\\*/]+|^[\\s\\*/]$")
  (#select-adjacent! @doc @definition.constant)
)

(
  [
    (method_call_expression
      name: (identifier) @name)
    (static_call_expression
      name: (identifier) @name)
  ] @reference.call
)

(
  [
    (instance_expression
      name: (identifier) @name)
    (initOf
      name: (identifier) @name)
    (codeOf
      name: (identifier) @name)
  ] @reference.class
)

(destruct_statement name: (type_identifier) @def.class)

(import name: (_) @import)

(let_statement name: (identifier) @def.function)

(method_call_expression name: (identifier) @call)

(source_file) @import

(static_call_expression name: (identifier) @call)

(struct name: (type_identifier) @def.class)
