use fmt;
use strings;
type point = struct { x: int };
fn helper(s: str) str = strings::dup(s);
export fn main() void = { fmt::println(helper("x"))!; };
