using GLib;
public class Greeter : Object {
    public string greet() { return helper("x"); }
}
string helper(string s) { return s.up(); }
void main() { stdout.printf(helper("y")); }
