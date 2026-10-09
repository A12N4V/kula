(class_declaration "interface" name: (identifier) @def.interface)

(class_declaration name: (identifier) @def.class)

(object_declaration name: (identifier) @def.class)

(function_declaration name: (identifier) @def.function)

(call_expression . (identifier) @call)

(call_expression . (navigation_expression (identifier) @call .))

(import (qualified_identifier) @import)
