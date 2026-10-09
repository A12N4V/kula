((call target: (identifier) @_k (arguments (alias) @def.class)) (#any-of? @_k "defmodule" "defprotocol"))

((call target: (identifier) @_k (arguments [(call target: (identifier) @def.function) (identifier) @def.function (binary_operator left: (call target: (identifier) @def.function))])) (#any-of? @_k "def" "defp" "defmacro" "defmacrop" "defguard" "defdelegate"))

((call target: (identifier) @call) (#not-any-of? @call "def" "defp" "defmacro" "defmacrop" "defmodule" "defprotocol" "defimpl" "defstruct" "defguard" "defdelegate" "alias" "import" "require" "use"))

(call target: (dot right: (identifier) @call))

((call target: (identifier) @_k (arguments (alias) @import)) (#any-of? @_k "alias" "import" "require" "use"))
