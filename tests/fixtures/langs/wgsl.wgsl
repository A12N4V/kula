struct Light { pos: vec3<f32> }
fn helper(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
@fragment fn main() -> @location(0) vec4<f32> { return vec4<f32>(helper(1.0)); }
