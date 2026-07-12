// Animated plasma background (Phase 1 shader, extended with a configurable
// Inigo Quilez cosine palette): color(t) = a + b * cos(2π·(c·t + d + hue)).
// Drawn first in the composite pass; the fluid overlay is alpha-blended on top.

struct U {
  resolution : vec2f,
  time       : f32,
  hue        : f32,
  mouse      : vec2f,
  _pad       : vec2f,
  palA       : vec4f,  // .xyz used
  palB       : vec4f,
  palC       : vec4f,
  palD       : vec4f,
};

@group(0) @binding(0) var<uniform> u : U;

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vi], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) fragCoord : vec4f) -> @location(0) vec4f {
  let res = max(u.resolution, vec2f(1.0));
  var uv = (fragCoord.xy * 2.0 - res) / min(res.x, res.y);
  uv.y = -uv.y;

  let m = (u.mouse * 2.0 - res) / min(res.x, res.y);
  let mouse = vec2f(m.x, -m.y);

  let t = u.time;
  // Frequency, animation speed, and amplitude here make the plasma gently ripple.
  let wave = vec2f(
    sin(uv.y * 4.0 + t * 0.8),
    cos(uv.x * 4.0 - t * 0.7),
  ) * 0.08;
  var acc = 0.0;
  let q = (uv + wave) * 3.0;
  acc += sin(q.x + t);
  acc += sin(q.y * 1.3 + t * 1.1);
  acc += sin((q.x + q.y) * 0.7 + t * 0.7);
  let r = length(uv - mouse);
  acc += sin(r * 6.0 - t * 2.0) * 1.5;
  acc = acc * 0.25;

  let base = u.palA.xyz + u.palB.xyz * cos(
    6.28318 * (u.palC.xyz * acc + u.palD.xyz + u.hue)
  );

  let glow = 0.12 / (r * r + 0.05);
  var col = base + glow * vec3f(0.15, 0.25, 0.4);
  // CRT-style scanlines and a soft vignette give the field more depth.
  let scanline = 0.92 + 0.08 * sin(fragCoord.y * 1.8 + t * 3.0);
  let vignette = 1.0 - 0.28 * smoothstep(0.35, 1.4, dot(uv, uv));
  col *= scanline * vignette;

  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
