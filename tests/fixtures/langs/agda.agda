module Greeter where
open import Data.Nat
data Shape : Set where
  circle : Nat -> Shape
helper : Nat -> Nat
helper n = suc n
greet : Nat -> Nat
greet n = helper n
