#include "common.glsl"
struct Light { vec3 pos; };
float helper(float x) { return clamp(x, 0.0, 1.0); }
void main() { gl_FragColor = vec4(helper(1.0)); }
