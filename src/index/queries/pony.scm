; Pony: generated from the grammar's node types and its tags.scm

(
  (identifier) @reference.class
  (#match? @reference.class "^_*[A-Z][a-zA-Z0-9_]*$")
)

(class_definition (identifier) @name) @definition.class

(actor_definition (identifier) @name) @definition.class

(primitive_definition (identifier) @name) @definition.class

(struct_definition (identifier) @name) @definition.class

(type_alias (identifier) @name) @definition.class

(trait_definition (identifier) @name) @definition.interface

(interface_definition (identifier) @name) @definition.interface

(constructor (identifier) @name) @definition.method

(method (identifier) @name) @definition.method

(behavior (identifier) @name) @definition.method

(class_definition (type) @name) @reference.implementation

(actor_definition (type) @name) @reference.implementation

(primitive_definition (type) @name) @reference.implementation

(struct_definition (type) @name) @reference.implementation

(type_alias (type) @name) @reference.implementation

(call_expression callee: [(identifier) (ffi_identifier)] @name) @reference.call

(call_expression callee: (generic_expression [(identifier) (ffi_identifier)] @name)) @reference.call

(call_expression callee: (member_expression (identifier) @name .)) @reference.call

(call_expression callee: (member_expression (generic_expression [(identifier) (ffi_identifier)] @name) .)) @reference.call

(call_expression) @reference.call

(class_definition . (identifier) @def.class)

(interface_definition . (identifier) @def.interface)

(method . (identifier) @def.method)

(source_file) @import

(struct_definition . (identifier) @def.class)

(trait_definition . (identifier) @def.interface)

(use_statement) @import
