(let_binding pattern: (value_identifier) @def.function body: (function))

(module_binding name: (module_identifier) @def.class)

(type_binding name: (type_identifier) @def.class)

(call_expression function: (value_identifier) @call)

(call_expression function: (value_identifier_path (value_identifier) @call .))

(open_statement (module_identifier) @import)
