(class_interface . (identifier) @def.class)

(class_implementation . (identifier) @def.class)

(protocol_declaration . (identifier) @def.interface)

(method_definition . (method_type) . (identifier) @def.method)

(method_declaration . (method_type) . (identifier) @def.method)

(function_definition declarator: (function_declarator declarator: (identifier) @def.function))

(function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @def.function)))

(struct_specifier name: (type_identifier) @def.class body: (_))

(call_expression function: (identifier) @call)

(message_expression method: (identifier) @call)

(preproc_include path: (_) @import)

(module_import path: (_) @import)
