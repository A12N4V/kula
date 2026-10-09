; SourcePawn: generated from the grammar's node types and its tags.scm

(
  (comment)* @doc
  .
  [
    (function_definition
        name: (identifier) @name)
    (function_declaration
        name: (identifier) @name)
  ] @definition.function
  (#strip! @doc "^[\\s\\*/]+|^[\\s\\*/]$")
  (#select-adjacent! @doc @definition.function)
)

(
  (comment)* @doc
  .
  [
    (enum_struct_method
        name: (identifier) @name)
    (methodmap_method
        name: (identifier) @name)
    (methodmap_method_constructor
        name: (identifier) @name)
    (methodmap_method_destructor
        name: (identifier) @name)
  ] @definition.method
  (#strip! @doc "^[\\s\\*/]+|^[\\s\\*/]$")
  (#select-adjacent! @doc @definition.method)
)

(
  (comment)* @doc
  .
  [
    (methodmap
        name: (identifier) @name)
    (enum_struct
        name: (identifier) @name)
    (enum
        name: (identifier) @name)
  ] @definition.class
  (#strip! @doc "^[\\s\\*/]+|^[\\s\\*/]$")
  (#select-adjacent! @doc @definition.class)
)

(
  (comment)* @doc
  .
  (global_variable_declaration
    (variable_declaration
      name: (identifier) @name
    ) @definition.variable
  ) 
  (#strip! @doc "^[\\s\\*/]+|^[\\s\\*/]$")
  (#select-adjacent! @doc @definition.variable)
)

(methodmap
  name: (identifier) @name) @definition.class

(enum_struct
  name: (identifier) @name) @definition.class

(enum
  name: (identifier) @name) @definition.class

(enum_struct_method
  name: (identifier) @name) @definition.method

(methodmap_method
  name: (identifier) @name) @definition.method

(methodmap_method_constructor
  name: (identifier) @name) @definition.method

(methodmap_method_destructor
  name: (identifier) @name) @definition.method

(global_variable_declaration
  (variable_declaration
    name: (identifier) @name
  ) @definition.variable
)

(function_definition
  name: (identifier) @name) @definition.function

(function_declaration
  name: (identifier) @name) @definition.function

(enum_entry
  name: (identifier) @name) @definition.constant

(typeset
  name: (identifier) @name) @definition.interface

(typedef
  name: (identifier) @name) @definition.interface

(functag
  name: (identifier) @name) @definition.interface

(funcenum
  name: (identifier) @name) @definition.interface

(preproc_define
  name: (identifier) @name) @definition.macro

(preproc_macro
  name: (identifier) @name) @definition.macro

(call_expression
  function: (identifier) @name) @reference.call

(call_expression
  function: (field_access
    field: (identifier) @name)) @reference.call

(new_expression
  class: (identifier) @name) @reference.class

(call_expression function: (identifier) @call)

(call_expression function: (field_access field: (identifier) @call))

(function_declaration name: (identifier) @def.function)

(function_definition name: (identifier) @def.function)

(preproc_include path: (_) @import)

(preproc_tryinclude path: (_) @import)

(source_file) @import

(struct name: (identifier) @def.class)

(struct_declaration name: (identifier) @def.class)
