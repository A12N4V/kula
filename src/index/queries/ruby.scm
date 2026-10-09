(method name: (identifier) @def.function)

(singleton_method name: (identifier) @def.function)

(class name: (constant) @def.class)

(module name: (constant) @def.class)

(call method: (identifier) @call)

((call method: (identifier) @_req arguments: (argument_list (string (string_content) @import))) (#match? @_req "^require(_relative)?$"))
