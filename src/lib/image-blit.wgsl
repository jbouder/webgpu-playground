// Display pass: draws a processed image texture to the canvas with an
// aspect-preserving "contain" fit (letterbox/pillarbox), optionally split
// against the original for a before/after wipe.

struct B {
  canvas : vec2f, // backing-store size in device pixels
  image  : vec2f, // source image size in pixels
  split  : f32,   // <0 = show processed everywhere; else wipe position 0..1
  mirror : f32,   // >0.5 flips the sampled image horizontally (selfie view)
  _p1 : f32,
  _p2 : f32,
};

@group(0) @binding(0) var<uniform> u : B;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var original : texture_2d<f32>;
@group(0) @binding(3) var processed : texture_2d<f32>;

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let xy = p[vi];
  var out : VSOut;
  out.pos = vec4f(xy, 0.0, 1.0);
  out.uv = vec2f(xy.x * 0.5 + 0.5, 1.0 - (xy.y * 0.5 + 0.5));
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4f {
  let bg = vec3f(0.03, 0.04, 0.06);
  let ca = u.canvas.x / u.canvas.y;
  let ia = u.image.x / u.image.y;
  // Shrink whichever axis is proportionally too large, centering the image.
  var s = vec2f(1.0, 1.0);
  if (ia > ca) { s.y = ca / ia; } else { s.x = ia / ca; }
  let centered = (in.uv - 0.5) / s + 0.5;
  if (centered.x < 0.0 || centered.x > 1.0 || centered.y < 0.0 || centered.y > 1.0) {
    return vec4f(bg, 1.0);
  }

  var sampleUv = centered;
  if (u.mirror > 0.5) { sampleUv.x = 1.0 - centered.x; }

  var col : vec3f;
  if (u.split >= 0.0 && in.uv.x < u.split) {
    col = textureSampleLevel(original, samp, sampleUv, 0.0).rgb;
  } else {
    col = textureSampleLevel(processed, samp, sampleUv, 0.0).rgb;
  }
  // Thin handle line at the wipe boundary.
  if (u.split >= 0.0 && abs(in.uv.x - u.split) < 0.0016) {
    col = vec3f(0.95);
  }
  return vec4f(col, 1.0);
}
