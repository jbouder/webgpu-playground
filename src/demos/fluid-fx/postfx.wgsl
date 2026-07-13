// Post-processing for the flow mode's trail texture:
//   fade  — dims the whole trail toward black each frame (trail length)
//   blit  — tone-maps the HDR trail to the swapchain

struct FU {
  fade: f32,     // 0   per-frame darken amount
  exposure: f32, // 4
  _pad: vec2f,   // 8
};

@group(0) @binding(0) var<uniform> u: FU;

// Fade: output alpha = fade; host blends with dst *= (1 - fade).
@fragment
fn fade_fs(in: VsOut) -> @location(0) vec4f {
  return vec4f(0.0, 0.0, 0.0, u.fade);
}

@group(0) @binding(1) var blit_samp: sampler;
@group(0) @binding(2) var trail: texture_2d<f32>;

@fragment
fn blit_fs(in: VsOut) -> @location(0) vec4f {
  let c = textureSampleLevel(trail, blit_samp, in.uv, 0.0).rgb;
  let mapped = vec3f(1.0) - exp(-c * u.exposure);
  return vec4f(pow(max(mapped, vec3f(0.0)), vec3f(1.0 / 2.2)), 1.0);
}
