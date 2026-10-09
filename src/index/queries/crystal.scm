; Crystal: generated from the grammar's node types

(abstract_method_def name: (identifier) @def.method)

(assign_call method: (identifier) @call)

(c_struct_def name: (constant) @def.class)

(call method: (constant) @call)

(call method: (identifier) @call)

(class_def name: (constant) @def.class)

(enum_def name: (constant) @def.class)

(fun_def name: [(constant) (identifier)] @def.function)

(implicit_object_call method: (identifier) @call)

(include) @import

(macro_def name: (identifier) @def.function)

(method_def name: (identifier) @def.method)

(module_def name: (constant) @def.class)

(require) @import

(struct_def name: (constant) @def.class)

(type_def name: (constant) @def.class)

(union_def name: (constant) @def.class)
