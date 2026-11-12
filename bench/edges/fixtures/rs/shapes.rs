pub mod render {
    pub fn draw() {}
    pub fn paint() {}
}

pub mod widgets {
    pub fn gadget() -> u32 {
        1
    }
}

pub struct Wheel;

pub trait Spin {
    fn spin(&self) -> u32;
}

impl Spin for Wheel {
    fn spin(&self) -> u32 {
        1
    }
}

pub struct Circle {
    r: f64,
}

impl Circle {
    pub fn new(r: f64) -> Self {
        Circle { r }
    }

    pub fn area(&self) -> f64 {
        3.0 * self.r * self.r
    }
}

impl Wheel {
    pub fn new() -> Self {
        Wheel
    }
}
