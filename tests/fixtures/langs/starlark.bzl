load("//tools:defs.bzl", "my_rule")
def helper(x):
    return x
def greet(name):
    return helper(name)
my_rule(name = "x")
