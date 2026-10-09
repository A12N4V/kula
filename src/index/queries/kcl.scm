(schema_stmt name: (identifier) @def.class)

(rule_stmt name: (identifier) @def.class)

(assign_stmt left: (dotted_name . (identifier) @def.function) right: (lambda_expr))

(call_expr function: (identifier) @call)

(call_expr function: (selector_expr (select_suffix (identifier) @call)))

(import_stmt name: (_) @import)
