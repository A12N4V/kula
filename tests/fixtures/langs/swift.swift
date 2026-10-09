import Foundation
class Greeter {
    func greet() -> String { return helper("x") }
}
struct Point { var x: Int }
protocol Shape { func area() -> Double }
func helper(_ s: String) -> String { return s.uppercased() }
