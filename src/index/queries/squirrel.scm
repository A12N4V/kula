(function_declaration . (identifier) @def.function)

(class_declaration . (identifier) @def.class)

(call_expression function: (identifier) @call)

(call_expression function: (deref_expression (_) (identifier) @call .))

((call_expression function: (identifier) @_d (call_args (string) @import)) (#any-of? @_d "dofile" "import" "require"))
