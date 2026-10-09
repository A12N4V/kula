module Greeter
open System
type Point = { X: int }
type Greeter() =
    member this.Greet() = helper "x"
let helper (s: string) = s.ToUpper()
let greet name = helper name
