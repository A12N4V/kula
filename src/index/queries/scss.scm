; SCSS: generated from the grammar's node types

(call_expression . (function_name) @call)

(function_statement . (name) @def.function)

(import_statement) @import

(include_statement) @import

(mixin_statement . (name) @def.class)

(namespace_statement . (namespace_name) @def.class)

(use_statement) @import

(important) @import
