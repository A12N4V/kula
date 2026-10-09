(fn_form name: (_) @def.function)

(lambda_form name: (_) @def.function)

(macro_form name: (_) @def.function)

(list call: (symbol) @call)

(list call: (multi_symbol member: (symbol_fragment) @call .))

((list call: (symbol) @_r . item: (_) @import) (#any-of? @_r "require" "import-macros" "include"))
