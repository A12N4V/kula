(class_declaration name: (identifier) @def.class)

(interface_declaration name: (identifier) @def.interface)

(method_declaration name: (identifier) @def.method)

(function_definition name: (identifier) @def.function)

(method_invocation name: (identifier) @call)

(juxt_function_call name: (identifier) @call)

(import_declaration (scoped_identifier) @import)
