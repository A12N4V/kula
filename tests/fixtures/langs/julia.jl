using LinearAlgebra
import Base: show
struct Point
    x::Int
end
function greet(name)
    return helper(name)
end
helper(s) = uppercase(s)
