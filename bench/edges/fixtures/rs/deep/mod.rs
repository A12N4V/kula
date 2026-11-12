mod inner;

use super::b::pad;

pub fn outer() -> u32 {
    inner::leaf()
}

pub fn via_super() -> usize {
    pad("x").len()
}
