import std.stdio;
class Greeter { string greet() { return helper("x"); } }
struct Point { int x; }
string helper(string s) { return s; }
void main() { writeln(helper("y")); }
