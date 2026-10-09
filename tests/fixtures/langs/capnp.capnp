@0xdbb9ad1f14bf0b36;
using Base = import "base.capnp";
struct Point { x @0 :Int32; }
interface Greeter { greet @0 (name :Text) -> (reply :Text); }
enum Kind { a @0; }
