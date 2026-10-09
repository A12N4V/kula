(function_definition declarator: (function_declarator declarator: (identifier) @def.function))

(struct_specifier name: (type_identifier) @def.class body: (_))

(call_expression function: (identifier) @call)

(call_expression function: (field_expression field: (field_identifier) @call))

(preproc_include path: (_) @import)
