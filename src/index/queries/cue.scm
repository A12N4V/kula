(field (label (identifier) @def.class) (value (struct_lit)))

(call_expression function: (identifier) @call)

(call_expression function: (selector_expression (_) (identifier) @call .))

(import_spec path: (string) @import)

(package_clause (package_identifier) @def.class)
