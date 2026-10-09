#include "common.isph"
struct Point { float x; };
float helper(float x) { return abs(x); }
export void run(uniform float a[]) { a[0] = helper(a[0]); }
