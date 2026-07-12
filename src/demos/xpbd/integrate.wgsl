struct Params { gravity: f32, wind: f32, h: f32, radius: f32, count: u32, resolution: u32, _pad: vec2u };
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> prev: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> vel: array<vec4f>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
 if (id.x >= p.count) { return; } let x = pos[id.x]; if (x.w == 0.0) { return; }
 prev[id.x] = x; var v = vel[id.x].xyz;
 v += vec3f(sin(x.z * 1.7 + x.y) * p.wind, -p.gravity, cos(x.x * 1.3) * p.wind) * p.h;
 vel[id.x] = vec4f(v, 0.0); pos[id.x] = vec4f(x.xyz + v * p.h, x.w);
}
