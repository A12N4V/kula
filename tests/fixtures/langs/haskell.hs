module Greeter where
import Data.List (sort)
data Shape = Circle Double
class Named a where
  name :: a -> String
greet :: String -> String
greet n = helper n
helper :: String -> String
helper s = sort s
