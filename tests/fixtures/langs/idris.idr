module Greeter
import Data.String
data Shape = Circle Double
helper : String -> String
helper s = toUpper s
greet : String -> String
greet n = helper n
