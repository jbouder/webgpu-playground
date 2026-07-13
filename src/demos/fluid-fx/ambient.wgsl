// Ambient generative field: domain-warped fbm mapped through the cosine
// palette. Passive — animates on time alone; the pointer adds a gentle warp.

struct U {
  resolution: vec2f,  // 0
  time: f32,          // 8
  hue: f32,           // 12
  mouse: vec2f,       // 16  (uv, y-down, [0,1])
  speed: f32,         // 24
  warp: f32,          // 28
  palA: vec4f,        // 32
  palB: vec4f,        // 48
  palC: vec4f,        // 64
  palD: vec4f,        // 80
};

@group(0) @binding(0) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let res = max(u.resolution, vec2f(1.0));
  // Aspect-correct, centered coordinates.
  var p = (in.pos.xy * 2.0 - res) / min(res.x, res.y);
  let t = u.time * u.speed;

  // Two-level domain warp: q warps p, r warps q. Classic IQ warped fbm.
  let q = vec2f(
    fbm(p + vec2f(0.0, 0.0) + t * 0.15),
    fbm(p + vec2f(5.2, 1.3) - t * 0.12),
  );
  let m = (u.mouse * 2.0 - vec2f(1.0)) * vec2f(1.0, -1.0);
  let mp = p - m;
  let mouseWarp = mp / (dot(mp, mp) + 0.4) * u.warp;
  let r = vec2f(
    fbm(p + u.warp * q + vec2f(1.7, 9.2) + t * 0.2 + mouseWarp),
    fbm(p + u.warp * q + vec2f(8.3, 2.8) - t * 0.18 + mouseWarp),
  );
  let f = fbm(p + u.warp * r);

  var col = palette(f + t * 0.05 + u.hue, u.palA.xyz, u.palB.xyz, u.palC.xyz, u.palD.xyz);
  // Fold in the warp magnitude for depth, and a soft vignette.
  col = col * (0.65 + 0.6 * f) + 0.12 * length(q);
  let vig = 1.0 - 0.35 * smoothstep(0.4, 1.6, dot(p, p));
  col = col * vig;

  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
