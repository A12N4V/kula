(config_file (body (block (identifier) . (string_lit) . (string_lit (template_literal) @def.class))))

((config_file (body (block (identifier) @_k . (string_lit (template_literal) @def.class) . (block_start)))) (#any-of? @_k "module" "variable" "output" "provider"))

(function_call (identifier) @call)

((block (identifier) @_m (body (attribute (identifier) @_s (expression (literal_value (string_lit (template_literal) @import)))))) (#eq? @_m "module") (#eq? @_s "source"))
