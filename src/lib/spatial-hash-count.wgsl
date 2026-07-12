@group(0) @binding(0) var<uniform> grid : SpatialHashGrid;
@group(0) @binding(1) var<storage, read> positions : array<vec4f>;
@group(0) @binding(2) var<storage, read_write> counts : array<atomic<u32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= arrayLength(&positions)) { return; }
  atomicAdd(&counts[hashCell(cellCoord(positions[id.x].xyz, grid), grid)], 1u);
}
