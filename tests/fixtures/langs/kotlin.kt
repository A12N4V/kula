package demo
import kotlin.math.max
class Greeter(val name: String) {
    fun greet(): String { return helper(name) }
}
interface Shape { fun area(): Double }
fun helper(s: String): String = max(1, 2).toString() + s
