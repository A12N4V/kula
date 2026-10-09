(function_definition declarator: (function_declarator declarator: (identifier) @def.function))

(function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @def.function)))

(struct_specifier name: (type_identifier) @def.class body: (_))

(enum_specifier name: (type_identifier) @def.class body: (_))

(type_definition declarator: (type_identifier) @def.class)

(call_expression function: (identifier) @call)

(call_expression function: (field_expression field: (field_identifier) @call))

(preproc_include path: (_) @import)
