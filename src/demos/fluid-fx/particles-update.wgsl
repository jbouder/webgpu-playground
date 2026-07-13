// Advances particles through a curl-noise flow field. Positions live in uv
// space ([0,1], y-down). Particles are respawned when they leave the frame or
// randomly age out, so the field keeps churning.

struct PU {
  mouse: vec2f,     // 0   uv, y-down
  time: f32,        // 8
  dt: f32,          // 12
  pressed: f32,     // 16
  count: f32,       // 20
  speed: f32,       // 24
  curlScale: f32,   // 28
  aspect: f32,      // 32
  _pad0: f32,       // 36
  _pad1: f32,       // 40
  _pad2: f32,       // 44
};

@group(0) @binding(0) var<uniform> u: PU;
@group(0) @binding(1) var<storage, read_write> particles: array<vec4f>;

fn respawn(i: f32, seed: f32) -> vec2f {
  return vec2f(hash2(vec2f(i * 0.37, seed)), hash2(vec2f(seed, i * 1.91)));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (f32(i) >= u.count) { return; }
  let p = particles[i];
  var pos = p.xy;
  var vel = p.zw;

  // Curl of fbm gives a smooth, swirling, divergence-free field.
  let sp = vec2f(pos.x * u.aspect, pos.y) * u.curlScale + vec2f(u.time * 0.05);
  var flow = curl(sp);

  // Pointer pushes particles radially outward when pressed.
  if (u.pressed > 0.5) {
    let dm = pos - u.mouse;
    let d2 = dot(dm, dm);
    flow = flow + normalize(dm + vec2f(1e-5)) * (0.12 / (d2 + 0.015));
  }

  vel = mix(vel, flow * u.speed, 0.08);
  pos = pos + vel * u.dt;

  let age = hash2(vec2f(f32(i) * 1.7, floor(u.time * 3.0)));
  if (pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0 || age > 0.994) {
    pos = respawn(f32(i), u.time);
    vel = vec2f(0.0, 0.0);
  }

  particles[i] = vec4f(pos, vel);
}
