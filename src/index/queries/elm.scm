(function_declaration_left . (lower_case_identifier) @def.function)

(type_declaration name: (upper_case_identifier) @def.class)

(type_alias_declaration name: (upper_case_identifier) @def.class)

(port_annotation name: (lower_case_identifier) @def.function)

(function_call_expr target: (value_expr name: (value_qid (lower_case_identifier) @call .)))

(import_clause moduleName: (upper_case_qid) @import)
