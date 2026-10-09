package authz
import data.users
default allow := false
helper(x) := y if { y := lower(x) }
allow if { helper(input.user) == "admin" }
