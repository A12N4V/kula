(function_definition name: (identifier) @def.function)

(class_definition name: (identifier) @def.class)

(rule_definition name: (identifier) @def.function)

(checkpoint_definition name: (identifier) @def.function)

(call function: (identifier) @call)

(call function: (attribute attribute: (identifier) @call))

(directive_parameters (identifier) @call)

(import_statement name: (dotted_name) @import)

(import_from_statement module_name: (_) @import)

((directive) @_d (directive_parameters (string) @import) (#match? @_d "^include"))
