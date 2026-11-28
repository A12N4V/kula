use crate::codec::b::ping;
pub fn pong(s: &str) -> String { format!("{s}{}", ping(s)) }
