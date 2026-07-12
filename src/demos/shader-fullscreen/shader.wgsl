// Shadertoy-style animated fullscreen shader.
// No geometry: a single oversized triangle covers the viewport, and all the
// interesting work happens per-fragment.

struct Uniforms {
  resolution : vec2f,   // device pixels
  time       : f32,     // seconds since init
  _pad0      : f32,
  mouse      : vec2f,   // device pixels, origin top-left
};

@group(0) @binding(0) var<uniform> u : Uniforms;

// Fullscreen triangle. Three vertices in clip space, no vertex buffer.
@vertex
fn vs(@builtin(vertex_index) vi : u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0),
  );
  return vec4f(p[vi], 0.0, 1.0);
}

// A cheap, pleasant plasma that reacts to the pointer.
@fragment
fn fs(@builtin(position) fragCoord : vec4f) -> @location(0) vec4f {
  let res = max(u.resolution, vec2f(1.0));
  // Aspect-correct, centered coordinates in roughly [-1, 1].
  var uv = (fragCoord.xy * 2.0 - res) / min(res.x, res.y);
  uv.y = -uv.y;

  let m = (u.mouse * 2.0 - res) / min(res.x, res.y);
  let mouse = vec2f(m.x, -m.y);

  let t = u.time;
  var acc = 0.0;
  var q = uv * 3.0;
  // A few layered sine fields — classic demoscene plasma.
  acc += sin(q.x + t);
  acc += sin(q.y * 1.3 + t * 1.1);
  acc += sin((q.x + q.y) * 0.7 + t * 0.7);
  let r = length(uv - mouse);
  acc += sin(r * 6.0 - t * 2.0) * 1.5;
  acc = acc * 0.25;

  // Map the accumulated field to a smooth color ramp.
  let base = vec3f(0.5) + 0.5 * cos(
    vec3f(acc * 3.14159) + vec3f(0.0, 2.094, 4.188) + t * 0.2
  );

  // Soft pointer glow.
  let glow = 0.12 / (r * r + 0.05);
  let col = base + glow * vec3f(0.15, 0.25, 0.4);

  return vec4f(pow(clamp(col, vec3f(0.0), vec3f(1.0)), vec3f(0.4545)), 1.0);
}
