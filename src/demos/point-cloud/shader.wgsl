// Instanced billboard point cloud. Each point is expanded into a screen-facing
// quad in the vertex shader (constant pixel size), then masked to a soft disc
// in the fragment shader. Depth testing gives correct occlusion.

struct Uniforms {
  viewProj   : mat4x4f,
  resolution : vec2f,
  pointSize  : f32,   // diameter in device pixels
  _pad       : f32,
};

@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) corner    : vec2f,  // [-1,1] within the quad
  @location(1) color     : vec3f,
  @location(2) depth01   : f32,    // 0 near .. 1 far, for subtle shading
};

@vertex
fn vs(
  @builtin(vertex_index) vi : u32,
  @location(0) inPos : vec3f,
  @location(1) inCol : vec3f,
) -> VSOut {
  // Two triangles forming a quad, in local [-1,1] space.
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0,  1.0), vec2f(1.0, -1.0), vec2f( 1.0, 1.0),
  );
  let corner = corners[vi];

  var clip = u.viewProj * vec4f(inPos, 1.0);

  // Offset by a constant pixel size. Multiply by clip.w so the offset survives
  // the perspective divide as the intended NDC delta.
  let px = corner * (u.pointSize * 0.5);
  clip.x += (px.x / u.resolution.x) * 2.0 * clip.w;
  clip.y += (px.y / u.resolution.y) * 2.0 * clip.w;

  var out : VSOut;
  out.pos = clip;
  out.corner = corner;
  out.color = inCol;
  out.depth01 = clamp(clip.z / clip.w, 0.0, 1.0);
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4f {
  // Round point with a soft edge; discard the corners of the quad.
  let r = length(in.corner);
  if (r > 1.0) {
    discard;
  }
  let edge = smoothstep(1.0, 0.75, r);
  // Fake lighting: brighten the disc center, dim with depth.
  let shade = mix(1.0, 0.55, in.depth01);
  let core = mix(0.75, 1.15, 1.0 - r);
  let col = in.color * shade * core;
  return vec4f(col, edge);
}
