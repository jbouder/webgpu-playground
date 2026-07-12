// One Gray-Scott reaction-diffusion step. Reads the source field, writes the
// next. Scroll velocity adds an advection term so scrolling pushes the field.

struct Sim {
  dims : vec2f,
  feed : f32,
  kill : f32,
  dA   : f32,
  dB   : f32,
  dt   : f32,
  velX : f32,
  velY : f32,
};

@group(0) @binding(0) var<uniform> s : Sim;
@group(0) @binding(1) var src : texture_2d<f32>;
@group(0) @binding(2) var dst : texture_storage_2d<rgba16float, write>;

fn samp(p : vec2i) -> vec2f {
  let d = vec2i(i32(s.dims.x), i32(s.dims.y));
  // Toroidal wrap so the field tiles seamlessly.
  let c = (p + d) % d;
  return textureLoad(src, c, 0).xy;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (gid.x >= u32(s.dims.x) || gid.y >= u32(s.dims.y)) {
    return;
  }
  let p = vec2i(i32(gid.x), i32(gid.y));
  let c = samp(p);

  // Weighted 3x3 Laplacian.
  var lap = c * -1.0;
  lap += (samp(p + vec2i(-1, 0)) + samp(p + vec2i(1, 0))
        + samp(p + vec2i(0, -1)) + samp(p + vec2i(0, 1))) * 0.2;
  lap += (samp(p + vec2i(-1, -1)) + samp(p + vec2i(1, -1))
        + samp(p + vec2i(-1, 1)) + samp(p + vec2i(1, 1))) * 0.05;

  // Central-difference gradient for the scroll-driven advection term.
  let gx = (samp(p + vec2i(1, 0)) - samp(p + vec2i(-1, 0))) * 0.5;
  let gy = (samp(p + vec2i(0, 1)) - samp(p + vec2i(0, -1))) * 0.5;
  let adv = gx * s.velX + gy * s.velY;

  let a = c.x;
  let b = c.y;
  let reaction = a * b * b;

  let da = s.dA * lap.x - reaction + s.feed * (1.0 - a) - adv.x;
  let db = s.dB * lap.y + reaction - (s.kill + s.feed) * b - adv.y;

  let outA = clamp(a + da * s.dt, 0.0, 1.0);
  let outB = clamp(b + db * s.dt, 0.0, 1.0);
  textureStore(dst, gid.xy, vec4f(outA, outB, 0.0, 1.0));
}
