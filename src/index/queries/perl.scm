(function_definition name: (identifier) @def.function)

(package_statement (package_name) @def.class)

(call_expression_with_bareword function_name: (identifier) @call)

(method_invocation function_name: (identifier) @call)

(use_no_statement package_name: (_) @import)

(require_statement package_name: (_) @import)

(bareword_import module: (identifier) @import)
