-module(greeter).
-import(lists, [map/2]).
-include("defs.hrl").
greet(Name) -> helper(Name).
helper(S) -> string:uppercase(S).
