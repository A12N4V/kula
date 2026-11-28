pub fn compute(x: u32) -> u32 {
    helper(x) + 1
}

fn helper(x: u32) -> u32 {
    x * 2
}
