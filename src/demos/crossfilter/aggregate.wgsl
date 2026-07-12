// Crossfilter aggregation. One thread per row, one pass over the whole dataset.
// For each 1D panel we count rows that pass every OTHER panel's brush (the
// standard crossfilter "all-except-self" view), so brushing any panel refilters
// all the others. The scatter density counts rows passing every brush.
//
// This is the brute-force backbone: correct and compound at any number of
// simultaneous brushes, and fast enough for 60fps at ~1M rows. The Falcon
// prefix-sum fast path (engine.ts) accelerates live dragging on top of it.

const BINS = 64u;

struct Filter {
  n: u32,
  llo: u32, lhi: u32,   // latency brush (bin range, inclusive)
  clo: u32, chi: u32,   // cost
  tlo: u32, thi: u32,   // tokens
  mlo: u32, mhi: u32,   // time
}

@group(0) @binding(0) var<storage, read> rows: array<u32>;
@group(0) @binding(1) var<uniform> f: Filter;
// hist1d holds the four 1D panels back to back: panel p occupies [p*BINS, p*BINS+BINS).
@group(0) @binding(2) var<storage, read_write> hist1d: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> density: array<atomic<u32>>;

fn inRange(bin: u32, lo: u32, hi: u32) -> bool {
  return bin >= lo && bin <= hi;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= f.n) { return; }

  let packed = rows[i];
  let lb = packed & 63u;
  let cb = (packed >> 6u) & 63u;
  let tb = (packed >> 12u) & 63u;
  let mb = (packed >> 18u) & 63u;

  let pl = inRange(lb, f.llo, f.lhi);
  let pc = inRange(cb, f.clo, f.chi);
  let pt = inRange(tb, f.tlo, f.thi);
  let pm = inRange(mb, f.mlo, f.mhi);

  // Each panel's histogram excludes its own brush from the filter.
  if (pc && pt && pm) { atomicAdd(&hist1d[0u * BINS + lb], 1u); }
  if (pl && pt && pm) { atomicAdd(&hist1d[1u * BINS + cb], 1u); }
  if (pl && pc && pm) { atomicAdd(&hist1d[2u * BINS + tb], 1u); }
  if (pl && pc && pt) { atomicAdd(&hist1d[3u * BINS + mb], 1u); }

  // Scatter density (latency × cost) counts rows passing every brush.
  if (pl && pc && pt && pm) { atomicAdd(&density[lb * BINS + cb], 1u); }
}
