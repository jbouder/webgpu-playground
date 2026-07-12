// Seed the reaction-diffusion field: chemical A fills the plane, chemical B is
// scattered in a jittered grid of blobs. Runs once (and on reseed).

struct Seed {
  dims : vec2f,
  seed : f32,
  _pad : f32,
};

@group(0) @binding(0) var<uniform> s : Seed;
@group(0) @binding(1) var dst : texture_storage_2d<rgba16float, write>;

fn hash21(p : vec2f) -> f32 {
  var h = fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
  return h;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = vec2u(u32(s.dims.x), u32(s.dims.y));
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }

  let uv = vec2f(f32(gid.x) / s.dims.x, f32(gid.y) / s.dims.y);
  let cells = 9.0;
  let cell = floor(uv * cells);
  let local = fract(uv * cells) - 0.5;
  let h = hash21(cell + s.seed * 7.13);

  var b = 0.0;
  if (h > 0.55 && length(local) < 0.22) {
    b = 1.0;
  }
  // A always present; B seeded in blobs.
  textureStore(dst, gid.xy, vec4f(1.0, b, 0.0, 1.0));
}
