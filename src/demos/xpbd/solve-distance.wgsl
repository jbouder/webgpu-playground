struct Params { gravity: f32, wind: f32, h: f32, radius: f32, count: u32, resolution: u32, _pad: vec2u };
struct Distance { i: u32, j: u32, rest: f32, compliance: f32 };
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> constraints: array<Distance>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
 if (id.x >= arrayLength(&constraints)) { return; } let c = constraints[id.x];
 let a = pos[c.i]; let b = pos[c.j]; let d = b.xyz - a.xyz; let len = max(length(d), 0.00001);
 let w = a.w + b.w; if (w == 0.0) { return; }
 let lambda = (len - c.rest) / (w + c.compliance / (p.h * p.h));
 let correction = lambda * d / len; pos[c.i] = vec4f(a.xyz + correction * a.w, a.w); pos[c.j] = vec4f(b.xyz - correction * b.w, b.w);
}
