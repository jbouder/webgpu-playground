// Presents the dye field to the swapchain: bilinear upscale + filmic-ish
// tone map so the HDR dye accumulation stays vivid without clipping.

struct RU {
  exposure: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var<uniform> ru: RU;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var dye: texture_2d<f32>;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let c = textureSampleLevel(dye, samp, in.uv, 0.0).rgb;
  // Exposure + Reinhard-ish tone map, then gamma.
  let mapped = vec3f(1.0) - exp(-c * ru.exposure);
  let col = pow(max(mapped, vec3f(0.0)), vec3f(1.0 / 2.2));
  return vec4f(col, 1.0);
}
