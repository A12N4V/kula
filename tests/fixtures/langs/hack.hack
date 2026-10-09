use namespace HH\Lib\Str;
class Greeter {
  public function greet(): string { return helper("x"); }
}
function helper(string $s): string { return Str\uppercase($s); }
