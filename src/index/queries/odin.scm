(procedure_declaration . (identifier) @def.function)

(overloaded_procedure_declaration . (identifier) @def.function)

(struct_declaration . (identifier) @def.class)

(enum_declaration . (identifier) @def.class)

(union_declaration . (identifier) @def.class)

(call_expression function: (identifier) @call)

(call_expression function: (member_expression . (_) (identifier) @call .))

(member_expression (call_expression function: (identifier) @call))

(import_declaration (string) @import)
