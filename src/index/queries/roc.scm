; Roc: generated from the grammar's node types and its tags.scm

(function_call_pnc_expr
  caller:  (variable_expr
      (identifier)@name ))@reference.call

(function_call_pnc_expr
  caller: (field_access_expr (identifier)@name .))@reference.call

(value_declaration(decl_left 
  (identifier_pattern 
   (identifier)@name))(expr_body(anon_fun_expr)))@definition.function

(import_expr) @import

(import_file_expr) @import

(import_ident) @import

(requires) @import

(requires_rigid) @import

(requires_rigids) @import
