local lib = import 'lib.libsonnet';
local helper(s) = std.asciiUpper(s);
{
  greet(name):: helper(name),
  x: lib.f(1),
}
