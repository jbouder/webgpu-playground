@group(0) @binding(0) var<uniform> grid : SpatialHashGrid;
@group(0) @binding(1) var<storage, read> counts : array<u32>;
@group(0) @binding(2) var<storage, read_write> starts : array<u32>;
@compute @workgroup_size(1)
fn main() {
  var total = 0u;
  for (var i = 0u; i < grid.cellCount; i++) { starts[i] = total; total += counts[i]; }
  starts[grid.cellCount] = total;
}
