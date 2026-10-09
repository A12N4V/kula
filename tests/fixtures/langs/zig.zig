const std = @import("std");
const Point = struct {
    x: i32,
    pub fn norm(self: Point) i32 { return helper(self.x); }
};
fn helper(x: i32) i32 { return x; }
pub fn main() void { std.debug.print("{}", .{helper(1)}); }
