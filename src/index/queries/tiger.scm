; Tiger: generated from the grammar's node types and its tags.scm

(function_declaration
  name: (identifier) @name) @definition.function

(primitive_declaration
  name: (identifier) @name) @definition.function

(function_call
  function: (identifier) @name) @reference.call

(class_declaration
  name: (identifier) @name) @definition.class

(type_declaration
  name: (identifier) @name
  (class_type)) @definition.class

(new_expression
  class: (type_identifier) @name) @reference.class

(extends_qualifier
  super: (type_identifier) @name) @reference.class

(method_declaration
  name: (identifier) @name) @definition.method

(method_call
  method: (identifier) @name) @reference.call

(class_declaration name: (identifier) @def.class)

(function_call function: (identifier) @call)

(function_declaration name: (identifier) @def.function)

(import_declaration file: (_) @import)

(method_call method: (identifier) @call)

(method_declaration name: (identifier) @def.method)

(source_file) @import

(type_declaration name: (identifier) @def.class)
