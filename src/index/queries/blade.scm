((section (directive_start) @_d . (parameter) @def.function) (#match? @_d "^@section"))

((directive) @_d . (parameter) @import (#match? @_d "^@(include|extends|component|livewire)"))

((tag_name) @call (#match? @call "^x-"))
