import scala.collection.mutable
class Greeter {
  def greet(): String = helper("x")
}
trait Shape { def area(): Double }
object Main { def run(): Unit = println(helper("y")) }
def helper(s: String): String = s
