import gleam/io
import gleam/string
pub type Shape { Circle(Float) }
pub fn greet(name: String) -> String { helper(name) }
fn helper(s: String) -> String { string.uppercase(s) }
