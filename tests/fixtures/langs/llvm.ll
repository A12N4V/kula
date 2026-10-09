declare i32 @puts(ptr)
define i32 @helper(i32 %x) {
  ret i32 %x
}
define i32 @main() {
  %r = call i32 @helper(i32 1)
  ret i32 %r
}
