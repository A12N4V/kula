pub fn pad(s: &str) -> String { hash_it(s) }
fn hash_it(s: &str) -> String { format!("{s}#") }
