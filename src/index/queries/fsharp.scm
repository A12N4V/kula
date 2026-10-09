(function_declaration_left . (identifier) @def.function)

(type_name type_name: (identifier) @def.class)

(method_or_prop_defn name: (property_or_ident method: (identifier) @def.method))

(method_or_prop_defn name: (property_or_ident . (identifier) @def.method .))

(module_defn (identifier) @def.class)

(application_expression . (long_identifier_or_op (identifier) @call))

(application_expression . (long_identifier_or_op (long_identifier (identifier) @call .)))

(import_decl (long_identifier) @import)
