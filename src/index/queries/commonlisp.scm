(defun_header function_name: (sym_lit) @def.function)

((list_lit . (sym_lit) @_k . (sym_lit) @def.class) (#match? @_k "^(?i)(defclass|defstruct|define-condition)$"))

((list_lit . (sym_lit) @call) (#not-match? @call "^(?i)(defclass|defstruct|let\\*?|if|when|unless|cond|progn|setf|setq|lambda|quote|require|in-package)$"))

((list_lit . (sym_lit) @_k . [(kwd_lit) (str_lit) (sym_lit)] @import) (#match? @_k "^(?i)(require|in-package|ql:quickload|asdf:load-system)$"))
