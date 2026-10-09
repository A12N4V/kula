let lib = ./lib.dhall
let helper = \(s : Text) -> s ++ "!"
let greet = \(name : Text) -> helper name
in greet "x"
