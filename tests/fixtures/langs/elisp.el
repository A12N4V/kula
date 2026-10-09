(require 'cl-lib)
(defun helper (s) (upcase s))
(defun greet (name) (helper name))
(defmacro with-x (&rest b) `(progn ,@b))
