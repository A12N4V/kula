#include "common.hlsl"
struct Light { float3 pos; };
float helper(float x) { return saturate(x); }
float4 main() : SV_Target { return float4(helper(1.0), 0, 0, 1); }
