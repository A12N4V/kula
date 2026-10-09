(function_definition declarator: (function_declarator declarator: (identifier) @def.function))

(function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @def.function)))

(struct_specifier name: (type_identifier) @def.class body: (_))

(enum_specifier name: (type_identifier) @def.class body: (_))

(type_definition declarator: (type_identifier) @def.class)

(call_expression function: (identifier) @call)

(call_expression function: (field_expression field: (field_identifier) @call))

(preproc_include path: (_) @import)

(function_definition declarator: (function_declarator declarator: (field_identifier) @def.function))

(function_definition declarator: (function_declarator declarator: (qualified_identifier name: (identifier) @def.function)))

(function_definition declarator: (reference_declarator (function_declarator declarator: (identifier) @def.function)))

(class_specifier name: (type_identifier) @def.class body: (_))

(call_expression function: (qualified_identifier name: (identifier) @call))

(call_expression function: (template_function name: (identifier) @call))
