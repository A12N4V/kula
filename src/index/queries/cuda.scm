(function_definition declarator: (function_declarator declarator: (identifier) @def.function))

(function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @def.function)))

(function_definition declarator: (function_declarator declarator: (qualified_identifier name: (identifier) @def.function)))

(function_definition declarator: (function_declarator declarator: (field_identifier) @def.function))

(class_specifier name: (type_identifier) @def.class body: (_))

(struct_specifier name: (type_identifier) @def.class body: (_))

(call_expression function: (identifier) @call)

(call_expression function: (field_expression field: (field_identifier) @call))

(call_expression function: (qualified_identifier name: (identifier) @call))

(preproc_include path: (_) @import)
