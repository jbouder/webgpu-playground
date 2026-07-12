// Image-filter compute kernels. Each entry point reads one input texture and
// writes one output storage texture, both rgba16float. The host ping-pongs the
// two work textures, running one compute pass per enabled kernel (one pass per
// step keeps read-after-write ordering correct without intra-pass barriers).
//
// All kernels share one uniform layout (P) and one bind-group layout, so the
// host can drive any of them through the same pipeline layout.

struct P {
  brightness  : f32, // exposure in stops (0 = neutral)
  contrast    : f32, // 1 = neutral
  saturation  : f32, // 1 = neutral
  temperature : f32, // -1 cool .. +1 warm
  blurRadius  : f32, // gaussian radius in pixels
  dirX        : f32, // separable-blur direction (1,0) then (0,1)
  dirY        : f32,
  sharpen     : f32, // unsharp amount
  edges       : f32, // sobel mix 0..1
  vignette    : f32, // 0..1
  grayscale   : f32, // 0..1 mix
  _pad        : f32,
};

@group(0) @binding(0) var<uniform> p : P;
@group(0) @binding(1) var inTex : texture_2d<f32>;
@group(0) @binding(2) var outTex : texture_storage_2d<rgba16float, write>;

const LUMA = vec3f(0.2126, 0.7152, 0.0722);

// Clamped load, so neighbor taps at the image border repeat the edge pixel.
fn ld(c : vec2i) -> vec4f {
  let d = vec2i(textureDimensions(inTex));
  return textureLoad(inTex, clamp(c, vec2i(0), d - vec2i(1)), 0);
}

fn inBounds(gid : vec3u) -> bool {
  let d = textureDimensions(inTex);
  return gid.x < d.x && gid.y < d.y;
}

@compute @workgroup_size(8, 8)
fn color(@builtin(global_invocation_id) gid : vec3u) {
  if (!inBounds(gid)) { return; }
  let src = textureLoad(inTex, vec2i(gid.xy), 0);
  var rgb = src.rgb;
  rgb = rgb * pow(2.0, p.brightness);      // exposure
  rgb.r += p.temperature * 0.08;           // white-balance shift
  rgb.b -= p.temperature * 0.08;
  rgb = (rgb - 0.5) * p.contrast + 0.5;    // contrast about mid-gray
  let l = dot(rgb, LUMA);
  rgb = mix(vec3f(l), rgb, p.saturation);  // saturation
  textureStore(outTex, vec2i(gid.xy), vec4f(rgb, src.a));
}

@compute @workgroup_size(8, 8)
fn blur(@builtin(global_invocation_id) gid : vec3u) {
  if (!inBounds(gid)) { return; }
  let r = i32(p.blurRadius + 0.5);
  let sigma = max(1.0, p.blurRadius * 0.5);
  let stepv = vec2i(i32(p.dirX), i32(p.dirY));
  let base = vec2i(gid.xy);
  var acc = vec4f(0.0);
  var wsum = 0.0;
  for (var i = -r; i <= r; i = i + 1) {
    let w = exp(-f32(i * i) / (2.0 * sigma * sigma));
    acc += ld(base + stepv * i) * w;
    wsum += w;
  }
  textureStore(outTex, vec2i(gid.xy), acc / wsum);
}

@compute @workgroup_size(8, 8)
fn sharpen(@builtin(global_invocation_id) gid : vec3u) {
  if (!inBounds(gid)) { return; }
  let base = vec2i(gid.xy);
  let c = ld(base);
  let n = ld(base + vec2i(0, -1)) + ld(base + vec2i(0, 1))
        + ld(base + vec2i(-1, 0)) + ld(base + vec2i(1, 0));
  let a = p.sharpen;
  // Unsharp: add a scaled discrete Laplacian (4*c - neighbors).
  let rgb = c.rgb * (1.0 + 4.0 * a) - n.rgb * a;
  textureStore(outTex, vec2i(gid.xy), vec4f(rgb, c.a));
}

@compute @workgroup_size(8, 8)
fn sobel(@builtin(global_invocation_id) gid : vec3u) {
  if (!inBounds(gid)) { return; }
  let base = vec2i(gid.xy);
  let tl = dot(ld(base + vec2i(-1, -1)).rgb, LUMA);
  let t  = dot(ld(base + vec2i(0, -1)).rgb, LUMA);
  let tr = dot(ld(base + vec2i(1, -1)).rgb, LUMA);
  let l  = dot(ld(base + vec2i(-1, 0)).rgb, LUMA);
  let rt = dot(ld(base + vec2i(1, 0)).rgb, LUMA);
  let bl = dot(ld(base + vec2i(-1, 1)).rgb, LUMA);
  let b  = dot(ld(base + vec2i(0, 1)).rgb, LUMA);
  let br = dot(ld(base + vec2i(1, 1)).rgb, LUMA);
  let gx = (tr + 2.0 * rt + br) - (tl + 2.0 * l + bl);
  let gy = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);
  let mag = sqrt(gx * gx + gy * gy);
  let c = ld(base);
  textureStore(outTex, vec2i(gid.xy), vec4f(mix(c.rgb, vec3f(mag), p.edges), c.a));
}

@compute @workgroup_size(8, 8)
fn vignette(@builtin(global_invocation_id) gid : vec3u) {
  if (!inBounds(gid)) { return; }
  let d = textureDimensions(inTex);
  let c = textureLoad(inTex, vec2i(gid.xy), 0);
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(d);
  let dist = distance(uv, vec2f(0.5));
  let v = smoothstep(0.75, 0.35, dist);
  textureStore(outTex, vec2i(gid.xy), vec4f(c.rgb * mix(1.0, v, p.vignette), c.a));
}

@compute @workgroup_size(8, 8)
fn grayscale(@builtin(global_invocation_id) gid : vec3u) {
  if (!inBounds(gid)) { return; }
  let c = textureLoad(inTex, vec2i(gid.xy), 0);
  let l = dot(c.rgb, LUMA);
  textureStore(outTex, vec2i(gid.xy), vec4f(mix(c.rgb, vec3f(l), p.grayscale), c.a));
}
