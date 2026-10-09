import common;
struct Light { float3 pos; };
float helper(float x) { return saturate(x); }
float4 main() { return float4(helper(1.0)); }
