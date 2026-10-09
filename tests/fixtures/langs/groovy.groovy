import groovy.json.JsonSlurper
class Greeter {
  def greet() { return helper("x") }
}
def helper(s) { s.toUpperCase() }
