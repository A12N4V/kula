open Printf
module Util = struct
  let helper s = String.uppercase_ascii s
end
type shape = Circle of float
let greet name = Util.helper name
let () = printf "%s" (greet "x")
