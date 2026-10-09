open Belt
type point = {x: int}
let helper = s => Js.String.toUpperCase(s)
let greet = name => helper(name)
module Util = { let id = x => x }
