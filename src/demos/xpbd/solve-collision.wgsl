struct Params { gravity: f32, wind: f32, h: f32, radius: f32, count: u32, resolution: u32, _pad: vec2u };
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> starts: array<u32>;
@group(0) @binding(3) var<storage, read> indices: array<u32>;
@group(0) @binding(4) var<storage, read_write> deltas: array<atomic<i32>>;
@group(0) @binding(5) var<uniform> grid: SpatialHashGrid;
const SCALE = 100000.0;
@compute @workgroup_size(64) fn accumulate(@builtin(global_invocation_id) id: vec3u) {
 if (id.x >= p.count || pos[id.x].w == 0.0) { return; } let a = pos[id.x]; let c = cellCoord(a.xyz, grid);
 for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
  let cell = hashCell(c + vec3i(x,y,z), grid);
  for (var n = starts[cell]; n < starts[cell + 1u]; n++) { let j = indices[n]; if (j <= id.x) { continue; }
   let b = pos[j]; let d = b.xyz-a.xyz; let l=max(length(d),0.0001); if(l < 2.0*p.radius) { let q=(2.0*p.radius-l)*0.5*d/l;
    atomicAdd(&deltas[id.x*3u], i32(q.x*SCALE)); atomicAdd(&deltas[id.x*3u+1u],i32(q.y*SCALE)); atomicAdd(&deltas[id.x*3u+2u],i32(q.z*SCALE));
    atomicAdd(&deltas[j*3u],-i32(q.x*SCALE)); atomicAdd(&deltas[j*3u+1u],-i32(q.y*SCALE)); atomicAdd(&deltas[j*3u+2u],-i32(q.z*SCALE)); }
  } } } }
}
@compute @workgroup_size(64) fn apply(@builtin(global_invocation_id) id: vec3u) {
 if(id.x>=p.count){return;} let a=pos[id.x]; if(a.w==0.0){return;} var q=vec3f(f32(atomicExchange(&deltas[id.x*3u],0))/SCALE,f32(atomicExchange(&deltas[id.x*3u+1u],0))/SCALE,f32(atomicExchange(&deltas[id.x*3u+2u],0))/SCALE);
 var v=a.xyz+q; v.y=max(v.y,p.radius); let sphere=vec3f(0.0,0.75,0.0); let d=v-sphere; let l=max(length(d),.0001); if(l<.8+p.radius){v=sphere+d/l*(.8+p.radius);} pos[id.x]=vec4f(v,a.w);
}
