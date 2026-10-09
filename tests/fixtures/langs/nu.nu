use std assert
source lib.nu
def helper [s: string] { $s | str upcase }
def greet [name: string] { helper $name }
greet "x"
