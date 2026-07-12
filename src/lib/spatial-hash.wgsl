// Shared uniform-grid helpers. Consumers provide @group/@binding grid : SpatialHashGrid.
struct SpatialHashGrid {
  origin : vec3f,
  cellSize : f32,
  dimensions : vec3u,
  cellCount : u32,
};

fn cellCoord(position : vec3f, grid : SpatialHashGrid) -> vec3i {
  return vec3i(floor((position - grid.origin) / grid.cellSize));
}

fn hashCell(coord : vec3i, grid : SpatialHashGrid) -> u32 {
  let high = vec3i(grid.dimensions) - vec3i(1);
  let c = clamp(coord, vec3i(0), high);
  return u32(c.x) + u32(c.y) * grid.dimensions.x + u32(c.z) * grid.dimensions.x * grid.dimensions.y;
}

// Callers iterate offsets -1..1 around cellCoord(position, grid), then use
// cellStart[cell]..cellStart[cell + 1] as ranges in sortedIndices.
