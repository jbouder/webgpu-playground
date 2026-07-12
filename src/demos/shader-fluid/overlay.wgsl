// Fluid overlay: samples the reaction-diffusion field and draws it as a
// translucent layer over the plasma background. Alpha comes from chemical B, so
// the shader shows through wherever the fluid is thin.

struct R {
  resolution : vec2f,
  time       : f32,
  scroll     : f32,
  warp       : f32,
  _pad0      : f32,
  _pad1      : f32,
  _pad2      : f32,
};

@group(0) @binding(0) var<uniform> u : R;
@group(0) @binding(1) var field : texture_2d<f32>;
@group(0) @binding(2) var samp : sampler;

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv        : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let xy = p[vi];
  var out : VSOut;
  out.pos = vec4f(xy, 0.0, 1.0);
  out.uv = vec2f(xy.x * 0.5 + 0.5, 1.0 - (xy.y * 0.5 + 0.5));
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4f {
  var uv = in.uv;
  uv += vec2f(
    sin(uv.y * 7.0 + u.time * 0.3) * 0.012 * u.warp,
    cos(uv.x * 7.0 - u.scroll * 0.05) * 0.012 * u.warp,
  );
  uv = clamp(uv, vec2f(0.0), vec2f(1.0));

  let b = textureSampleLevel(field, samp, uv, 0.0).y;
  let t = smoothstep(0.12, 0.5, b);

  // Overlay color: a scroll-shifted ramp, distinct from the background.
  let hue = u.scroll * 0.02 + u.time * 0.03 + 0.4;
  let ramp = 0.5 + 0.5 * cos(vec3f(hue) + vec3f(0.0, 2.094, 4.188) + t * 2.5);

  // Transparent where the fluid is thin so the plasma shows through.
  let alpha = smoothstep(0.1, 0.45, b);
  return vec4f(ramp * (0.4 + 0.6 * t), alpha);
}
