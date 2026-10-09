((list . (symbol) @_k . (symbol) @def.function) @scope (#any-of? @_k "defwidget" "defwindow" "defpoll" "deflisten" "defvar"))

((list . (symbol) @call) (#not-any-of? @call "defwidget" "defwindow" "defpoll" "deflisten" "defvar" "include" "box" "label" "button" "geometry"))

((list . (symbol) @_i . (string) @import) (#eq? @_i "include"))
