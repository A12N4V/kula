package require http
source lib.tcl
proc helper {s} { return [string toupper $s] }
proc greet {name} { return [helper $name] }
greet x
