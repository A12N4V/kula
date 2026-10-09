(function_declaration name: (identifier) @def.function)

(generator_function_declaration name: (identifier) @def.function)

(class_declaration name: (_) @def.class)

(method_definition name: (property_identifier) @def.method)

(variable_declarator name: (identifier) @def.function value: (arrow_function))

(variable_declarator name: (identifier) @def.function value: (function_expression))

(call_expression function: (identifier) @call)

(call_expression function: (member_expression property: (property_identifier) @call))

(new_expression constructor: (identifier) @call)

(jsx_opening_element name: (identifier) @call)

(jsx_self_closing_element name: (identifier) @call)

(import_statement source: (string) @import)

(call_expression function: (identifier) @_r arguments: (arguments (string) @import) (#eq? @_r "require"))
