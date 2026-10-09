; Nim: generated from the grammar's node types

(call function: (blank_identifier) @call)

(call function: (identifier) @call)

(call function: (dot_expression right: (blank_identifier) @call))

(call function: (dot_expression right: (identifier) @call))

(dot_generic_call function: (blank_identifier) @call)

(dot_generic_call function: (identifier) @call)

(func_declaration name: [(blank_identifier) (identifier)] @def.function)

(import_from_statement module: (_) @import)

(import_statement) @import

(include_statement) @import

(macro_declaration name: [(blank_identifier) (identifier)] @def.function)

(method_declaration name: [(blank_identifier) (identifier)] @def.method)

(proc_declaration name: [(blank_identifier) (identifier)] @def.function)

(source_file) @import

(using_section) @import
