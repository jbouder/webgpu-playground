// Panel rendering for the crossfilter dashboard. One dynamic-offset uniform per
// panel selects what to draw; the host sets a viewport per panel and issues an
// instanced draw. Bars read the 1D histogram buffer, the heatmap reads the 2D
// density buffer, and the brush overlay shades the active range.

struct PanelU {
  bins: u32,
  regionOffset: u32, // start of this panel's slice in hist1d
  brushLo: u32,
  brushHi: u32,
  brushActive: u32,
  maxCount: f32,
  pad0: f32,
  pad1: f32,
  color: vec4f,
}

@group(0) @binding(0) var<storage, read> hist1d: array<u32>;
@group(0) @binding(1) var<storage, read> density: array<u32>;
@group(0) @binding(2) var<uniform> u: PanelU;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) color: vec4f,
}

// Unit-quad corners as two triangles.
fn corner(vi: u32) -> vec2f {
  var c = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
  );
  return c[vi];
}

fn clip(x: f32, y: f32) -> vec4f {
  // [0,1]² → clip space, with 10% headroom at the top.
  return vec4f(x * 2.0 - 1.0, (y * 0.9) * 2.0 - 1.0, 0.0, 1.0);
}

@vertex
fn vs_bars(@builtin(vertex_index) vi: u32, @builtin(instance_index) inst: u32) -> VSOut {
  let c = corner(vi);
  let count = f32(hist1d[u.regionOffset + inst]);
  let h = select(0.0, count / u.maxCount, u.maxCount > 0.0);
  let binsF = f32(u.bins);
  let gap = 0.15 / binsF;
  let x = mix(f32(inst) / binsF + gap, f32(inst + 1u) / binsF - gap, c.x);
  let y = c.y * h;

  var out: VSOut;
  out.pos = clip(x, y);
  let inside = u.brushActive == 0u || (inst >= u.brushLo && inst <= u.brushHi);
  out.color = select(u.color * vec4f(0.35, 0.35, 0.35, 1.0), u.color, inside);
  return out;
}

@vertex
fn vs_heat(@builtin(vertex_index) vi: u32, @builtin(instance_index) inst: u32) -> VSOut {
  let c = corner(vi);
  let binsF = f32(u.bins);
  let gx = f32(inst / u.bins);       // latency bin → X
  let gy = f32(inst % u.bins);       // cost bin → Y
  let x = mix(gx / binsF, (gx + 1.0) / binsF, c.x);
  let y = mix(gy / binsF, (gy + 1.0) / binsF, c.y);

  let d = f32(density[inst]);
  let t = select(0.0, log(1.0 + d) / log(1.0 + u.maxCount), u.maxCount > 0.0);
  let base = vec3f(0.03, 0.02, 0.09);
  let col = mix(base, u.color.rgb, sqrt(t)) + vec3f(t * t * 0.5);

  var out: VSOut;
  out.pos = clip(x, y);
  out.color = vec4f(col, 1.0);
  return out;
}

@vertex
fn vs_brush(@builtin(vertex_index) vi: u32) -> VSOut {
  let c = corner(vi);
  let binsF = f32(u.bins);
  let x = mix(f32(u.brushLo) / binsF, f32(u.brushHi + 1u) / binsF, c.x);
  let y = c.y;

  var out: VSOut;
  out.pos = clip(x, y);
  out.color = vec4f(0.42, 0.66, 1.0, 0.16);
  return out;
}

@fragment
fn fs_solid(in: VSOut) -> @location(0) vec4f {
  return in.color;
}
