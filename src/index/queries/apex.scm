; Apex: generated from the grammar's node types and its tags.scm

(class_declaration
  name: (identifier) @name) @definition.class

(interface_declaration
  name: (identifier) @name) @definition.interface

(enum_declaration
  name: (identifier) @name) @definition.enum

(method_invocation
  name: (identifier) @name) @reference.call

(method_declaration
  name: (identifier) @name) @definition.method

(interfaces
  (type_list
    (type_identifier ) @name)) @reference.implementation

(local_variable_declaration
  (type_identifier) @name ) @reference.class

(object_creation_expression
  type: (type_identifier) @name) @reference.class

(class_declaration name: (identifier) @def.class)

(constructor_declaration name: (identifier) @def.class)

(enum_declaration name: (identifier) @def.class)

(interface_declaration name: (identifier) @def.interface)

(method_declaration name: (identifier) @def.method)

(method_invocation name: (identifier) @call)

(sosl_using_clause) @import

(using_advanced_search) @import

(using_clause) @import

(using_listview_clause) @import

(using_lookup_bind_clause) @import

(using_lookup_bind_expression) @import

(using_lookup_clause) @import

(using_phrase_search) @import

(using_scope_clause) @import

(using_scope_type) @import

(with_clause) @import
