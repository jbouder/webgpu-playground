// Shared WGSL helpers, prepended (in JS) to every module in this demo. WGSL has
// no imports, so unused functions here are simply stripped per module.

const TAU = 6.28318530718;

// Inigo Quilez cosine palette: a + b·cos(2π(c·t + d)). Drives every mode's
// color, so a single palette picker recolors the whole demo.
fn palette(t: f32, a: vec3f, b: vec3f, c: vec3f, d: vec3f) -> vec3f {
  return a + b * cos(TAU * (c * t + d));
}

// Cheap hash → value noise → fbm, used by the ambient warp and the curl flow.
fn hash2(p: vec2f) -> f32 {
  let h = dot(p, vec2f(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash2(i);
  let b = hash2(i + vec2f(1.0, 0.0));
  let c = hash2(i + vec2f(0.0, 1.0));
  let d = hash2(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p0: vec2f) -> f32 {
  var p = p0;
  var amp = 0.5;
  var sum = 0.0;
  for (var i = 0; i < 5; i = i + 1) {
    sum = sum + amp * noise2(p);
    p = p * 2.02;
    amp = amp * 0.5;
  }
  return sum;
}

// Curl of an fbm scalar potential → a smooth, divergence-free flow field.
fn curl(p: vec2f) -> vec2f {
  let e = 0.05;
  let dx = fbm(p + vec2f(e, 0.0)) - fbm(p - vec2f(e, 0.0));
  let dy = fbm(p + vec2f(0.0, e)) - fbm(p - vec2f(0.0, e));
  return vec2f(dy, -dx) / (2.0 * e);
}

// Full-screen triangle shared by every fragment stage.
struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn fullscreen_vs(@builtin(vertex_index) vi: u32) -> VsOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: VsOut;
  let xy = p[vi];
  out.pos = vec4f(xy, 0.0, 1.0);
  // uv in [0,1], y down (texture space).
  out.uv = vec2f(xy.x * 0.5 + 0.5, 1.0 - (xy.y * 0.5 + 0.5));
  return out;
}
