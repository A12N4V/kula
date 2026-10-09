(function_definition (signature (call_expression . (identifier) @def.function)))

(function_definition (signature (typed_expression (call_expression . (identifier) @def.function))))

(macro_definition (signature (call_expression . (identifier) @def.function)))

(assignment . (call_expression . (identifier) @def.function))

(struct_definition (type_head (identifier) @def.class))

(struct_definition (type_head (binary_expression . (identifier) @def.class)))

(abstract_definition (type_head (identifier) @def.interface))

(module_definition name: (identifier) @def.class)

(call_expression . (identifier) @call)

(call_expression . (field_expression (identifier) @call .))

(using_statement (_) @import)

(import_statement (_) @import)
