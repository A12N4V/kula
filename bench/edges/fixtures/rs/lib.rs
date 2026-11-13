mod b;
mod cfg;
mod cfg_use;
mod deep;
mod m1;
mod m2;
mod shapes;

#[path = "alt/bridge.rs"]
mod bridge;

use crate::shapes::{render::{draw, paint as brush}, Circle, Wheel};
use self::b::pad;
use crate::shapes::widgets::*;
use crate::m1::*;
use crate::deep::inner::{self};
use crate::m2::*;

pub fn run(x: &str) -> usize {
    b::pad(x).len()
}

pub fn top() -> usize {
    run("a")
}

pub fn entry() {
    draw();
    brush();
    pad("x");
    gadget();
}

pub fn use_bridge() -> u32 {
    bridge::bridged()
}

pub fn path_call() {
    crate::shapes::render::draw();
}

pub fn make_circle() -> f64 {
    let c = Circle::new(2.0);
    c.area()
}

pub fn make_wheel() -> u32 {
    let w = Wheel::new();
    w.spin()
}

pub fn pick_shared() -> u32 {
    crate::m2::shared()
}

pub fn pick_glob() -> u32 {
    dup_fn()
}

pub fn via_deep() -> u32 {
    deep::outer()
}

pub fn via_self_import() -> u32 {
    inner::leaf()
}

pub fn from_deep() -> usize {
    deep::via_super()
}
