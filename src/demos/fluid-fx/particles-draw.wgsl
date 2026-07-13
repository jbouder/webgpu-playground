// Draws each particle as a soft round point (an instanced quad). Color comes
// from the particle's speed mapped through the shared palette; blended
// additively into the HDR trail texture by the host.

struct DU {
  resolution: vec2f, // 0
  hue: f32,          // 8
  pointSize: f32,    // 12  pixels
  palA: vec4f,       // 16
  palB: vec4f,       // 32
  palC: vec4f,       // 48
  palD: vec4f,       // 64
};

@group(0) @binding(0) var<uniform> u: DU;
@group(0) @binding(1) var<storage, read> particles: array<vec4f>;

struct PtOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec3f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> PtOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vi];
  let p = particles[ii];
  let uv = p.xy;                 // [0,1], y-down
  let speed = length(p.zw);

  // uv → clip space (flip y).
  let center = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let px = (u.pointSize / max(u.resolution, vec2f(1.0))) * 2.0;

  var out: PtOut;
  out.pos = vec4f(center + corner * px, 0.0, 1.0);
  out.local = corner;
  out.color = palette(clamp(speed * 6.0, 0.0, 1.0) + u.hue,
    u.palA.xyz, u.palB.xyz, u.palC.xyz, u.palD.xyz);
  return out;
}

@fragment
fn fs(in: PtOut) -> @location(0) vec4f {
  // Soft circular falloff; premultiplied so additive blend stays clean.
  let a = smoothstep(1.0, 0.0, length(in.local));
  return vec4f(in.color * a, a);
}
