(class_declaration name: (identifier) @def.class)

(mixin_declaration (identifier) @def.class)

(extension_declaration name: (identifier) @def.class)

(enum_declaration name: (identifier) @def.class)

(function_signature name: (identifier) @def.function)

(getter_signature name: (identifier) @def.function)

(setter_signature name: (identifier) @def.function)

(constructor_signature name: (identifier) @def.function)

(call_expression function: (identifier) @call)

(call_expression function: (member_expression property: (identifier) @call))

(import_specification uri: (configurable_uri (uri (string_literal) @import)))
