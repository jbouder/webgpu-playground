// Audio-reactive visualizer for the sound mixer. Reads the master FFT spectrum
// (storage buffer, uploaded each frame by AudioAnalyserBridge) and the coarse
// bass/mid/treble bands (uniforms) to drive a radial spectrum analyzer over a
// band-tinted plasma, with a bass-pulsing core.

struct U {
  res: vec2f,
  time: f32,
  bass: f32,
  mid: f32,
  treble: f32,
  level: f32,
  sens: f32,
  bins: f32,
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> freq: array<f32>;

const PI = 3.14159265;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  // Fullscreen triangle.
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

// Inigo Quilez cosine palette.
fn pal(t: f32) -> vec3f {
  return 0.5 + 0.5 * cos(6.28318 * (vec3f(1.0, 1.0, 1.0) * t + vec3f(0.0, 0.33, 0.67)));
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / u.res;
  var p = (uv - vec2f(0.5)) * 2.0;
  p.x *= u.res.x / max(u.res.y, 1.0); // aspect correct
  p.y = -p.y;                         // y up

  let r = length(p);
  let ang = atan2(p.y, p.x);          // -PI..PI

  // Map |angle| to a spectrum bin — mirrored top/bottom like a symmetric EQ.
  // Bins are spread on a perceptual (power) axis so the loud low end fans out
  // across the ring instead of piling up at one point.
  let usable = u.bins * 0.7;
  let a01 = abs(ang) / PI;            // 0 at the right edge, 1 at the left
  let idx = u32(clamp(pow(a01, 1.8) * usable, 0.0, u.bins - 1.0));
  let mag = sqrt(freq[idx]) * u.sens; // sqrt: lift quiet bins so the ring fills

  // Radial bar: an annulus from `base` outward, its length set by the bin's
  // magnitude. Glows with an exponential falloff on either side.
  let base = 0.30 + u.bass * 0.05 * u.sens;
  let outer = base + mag * 0.42;
  var d = 0.0;
  if (r < base) { d = base - r; }
  else if (r > outer) { d = r - outer; }
  let bar = exp(-d * 60.0) * (0.35 + mag);

  // Bass-pulsing core.
  let core = exp(-r * 6.0) * (0.4 + u.bass * 1.3 * u.sens);

  // Slow plasma, modulated by mids/treble, as a subtle background wash.
  let t = u.time;
  let plasma = 0.5 + 0.5 * sin(p.x * 3.0 + t + u.mid * 5.0) * cos(p.y * 3.0 - t * 0.7 + u.treble * 5.0);

  let hue = a01 * 0.5 + t * 0.04 + u.bass * 0.15;
  var col = pal(hue) * (bar + core);
  col += vec3f(u.bass, u.mid * 0.9, u.treble * 1.2) * plasma * 0.10;

  // Vignette.
  col *= 1.0 - 0.28 * r;
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
