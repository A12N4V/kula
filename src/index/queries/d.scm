(function_declaration (identifier) @def.function)

(class_declaration (identifier) @def.class)

(struct_declaration (identifier) @def.class)

(interface_declaration (identifier) @def.interface)

(enum_declaration (identifier) @def.class)

(template_declaration (identifier) @def.function)

(call_expression . (identifier) @call)

(call_expression . (property_expression (identifier) @call .))

(import_declaration (imported (module_fqn) @import))
