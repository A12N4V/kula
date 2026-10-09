(let_binding pattern: (value_name) @def.function (parameter))

(let_binding pattern: (value_name) @def.function body: (fun_expression))

(let_binding pattern: (value_name) @def.function body: (function_expression))

(module_binding (module_name) @def.class)

(module_type_definition (module_type_name) @def.interface)

(type_binding name: (type_constructor) @def.class)

(class_binding name: (class_name) @def.class)

(method_definition (method_name) @def.method)

(application_expression function: (value_path (value_name) @call))

(open_module module: (module_path) @import)
