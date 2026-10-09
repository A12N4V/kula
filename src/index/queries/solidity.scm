(contract_declaration name: (identifier) @def.class)

(library_declaration name: (identifier) @def.class)

(interface_declaration name: (identifier) @def.interface)

(struct_declaration name: (identifier) @def.class)

(enum_declaration name: (identifier) @def.class)

(event_definition name: (identifier) @def.function)

(modifier_definition name: (identifier) @def.function)

(function_definition name: (identifier) @def.function)

(call_expression function: (expression (identifier) @call))

(call_expression function: (expression (member_expression property: (identifier) @call)))

(import_directive source: (string) @import)
