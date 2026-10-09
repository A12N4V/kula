import "lib" as lib;
include "util";
def helper: ascii_upcase;
def greet(name): name | helper;
greet("x")
