((call_expression function: (identifier) @_t . (primary_expression (string (string_content) @def.function))) (#eq? @_t "template"))

(call_expression function: (identifier) @call)

(import_statement (primary_expression (string (string_content) @import)))
