module main
import os
struct Point { x int }
fn helper(s string) string { return s.to_upper() }
fn (p Point) norm() int { return p.x }
fn main() { println(helper('x')) }
