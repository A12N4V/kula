(module_ansi_header name: (simple_identifier) @def.class)

(module_nonansi_header name: (simple_identifier) @def.class)

(interface_ansi_header name: (simple_identifier) @def.interface)

(package_declaration name: (simple_identifier) @def.class)

(class_declaration name: (simple_identifier) @def.class)

(function_body_declaration name: (simple_identifier) @def.function)

(task_body_declaration name: (simple_identifier) @def.function)

(tf_call (hierarchical_identifier (simple_identifier) @call .))

(module_instantiation instance_type: (simple_identifier) @call)

(include_compiler_directive (quoted_string) @import)

(package_import_item (simple_identifier) @import)
