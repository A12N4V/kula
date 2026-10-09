; GDShader: generated from the grammar's node types and its tags.scm

((function_definition
  declarator: (identifier) @name) @definition.function)

((call_expression
  function: (_) @name) @reference.call)

((method_expression
  method: (identifier) @name) @reference.call)

((struct_definition
  name: (identifier) @name) @definition.class)

(((type_identifier) @name) @reference.class)

(call_expression function: (identifier) @call)

(function_definition declarator: (identifier) @def.function)

(preproc_include path: (_) @import)

(source_file) @import

(struct_definition name: (identifier) @def.class)
