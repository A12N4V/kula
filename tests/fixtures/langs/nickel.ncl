let lib = import "lib.ncl" in
let helper = fun s => std.string.uppercase s in
let greet = fun name => helper name in
greet "x"
