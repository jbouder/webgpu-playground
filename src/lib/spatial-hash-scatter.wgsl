@group(0) @binding(0) var<uniform> grid : SpatialHashGrid;
@group(0) @binding(1) var<storage, read> positions : array<vec4f>;
@group(0) @binding(2) var<storage, read> starts : array<u32>;
@group(0) @binding(3) var<storage, read_write> cursors : array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> indices : array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= arrayLength(&positions)) { return; }
  let cell = hashCell(cellCoord(positions[id.x].xyz, grid), grid);
  let slot = starts[cell] + atomicAdd(&cursors[cell], 1u);
  indices[slot] = id.x;
}
