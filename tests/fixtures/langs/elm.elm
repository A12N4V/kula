module Greeter exposing (greet)
import Html exposing (text)
type Shape = Circle Float
type alias Point = { x : Int }
greet : String -> String
greet name = helper name
helper s = String.toUpper s
