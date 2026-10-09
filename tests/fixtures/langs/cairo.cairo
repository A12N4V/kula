use core::traits::Into;
struct Point { x: u32 }
fn helper(x: u32) -> u32 { x + 1 }
fn main() { let y = helper(1); core::debug::print(y); }
