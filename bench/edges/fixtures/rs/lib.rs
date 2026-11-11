mod b;
pub fn run(x: &str) -> usize { b::pad(x).len() }
pub fn top() -> usize { run("a") }
