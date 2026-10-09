package main
import "core:fmt"
Point :: struct { x: int }
helper :: proc(x: int) -> int { return x }
main :: proc() { fmt.println(helper(1)) }
