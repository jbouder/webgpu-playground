// Stable-fluids (Navier–Stokes) solver on a fixed grid. Each stage is a compute
// entry point that reads sampled/loaded textures and writes a storage texture;
// the host ping-pongs the fields between stages. Fields are rgba16float:
//   velocity → .xy (grid cells / second)   dye → .rgb   pressure/divergence → .x
//
// All resources live in one module, so every binding number is globally unique
// (WGSL forbids reusing a @group/@binding pair even across entry points). Each
// pipeline uses layout:'auto', which derives its bind-group layout from only the
// bindings its entry point references — so the host binds the matching numbers.

struct U {
  texel: vec2f,        // 0   1/dims
  dt: f32,             // 8
  time: f32,           // 12
  pointer: vec2f,      // 16  uv, y-down [0,1]
  pointerDelta: vec2f, // 24  force to inject (grid cells / second)
  splatRadius: f32,    // 32
  velDissipation: f32, // 36  per-frame multiplier ≤ 1
  dyeDissipation: f32, // 40
  pressed: f32,        // 44  1 = inject this frame
  splatColor: vec4f,   // 48  .rgb dye color
  dims: vec2f,         // 64
  _pad: vec2f,         // 72
};

@group(0) @binding(0) var<uniform> u: U;

fn idims() -> vec2i { return vec2i(i32(u.dims.x), i32(u.dims.y)); }
fn clampCoord(c: vec2i) -> vec2i { return clamp(c, vec2i(0, 0), idims() - vec2i(1, 1)); }
fn inBounds(gid: vec3u) -> bool { return i32(gid.x) < idims().x && i32(gid.y) < idims().y; }

// ---- Splat: inject velocity + dye under the pointer -------------------------
@group(0) @binding(1) var splat_vel_in: texture_2d<f32>;
@group(0) @binding(2) var splat_dye_in: texture_2d<f32>;
@group(0) @binding(3) var splat_vel_out: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var splat_dye_out: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn splat(@builtin(global_invocation_id) gid: vec3u) {
  if (!inBounds(gid)) { return; }
  let c = vec2i(gid.xy);
  var vel = textureLoad(splat_vel_in, c, 0).xy;
  var dye = textureLoad(splat_dye_in, c, 0).xyz;

  let uv = (vec2f(c) + 0.5) * u.texel;
  var d = uv - u.pointer;
  d.x = d.x * (u.dims.x / u.dims.y); // aspect-correct so the splat is round
  let g = exp(-dot(d, d) / max(u.splatRadius, 1e-4)) * u.pressed;

  vel = vel + u.pointerDelta * g;
  dye = dye + u.splatColor.xyz * g;

  textureStore(splat_vel_out, c, vec4f(vel, 0.0, 1.0));
  textureStore(splat_dye_out, c, vec4f(dye, 1.0));
}

// ---- Advect velocity (semi-Lagrangian backtrace) ----------------------------
@group(0) @binding(5) var av_samp: sampler;
@group(0) @binding(6) var av_vel_in: texture_2d<f32>;
@group(0) @binding(7) var av_vel_out: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn advectVel(@builtin(global_invocation_id) gid: vec3u) {
  if (!inBounds(gid)) { return; }
  let c = vec2i(gid.xy);
  let coord = vec2f(c) + 0.5;
  let v = textureLoad(av_vel_in, c, 0).xy;
  let prev = (coord - u.dt * v) * u.texel;
  let result = textureSampleLevel(av_vel_in, av_samp, prev, 0.0).xy * u.velDissipation;
  textureStore(av_vel_out, c, vec4f(result, 0.0, 1.0));
}

// ---- Divergence of the velocity field ---------------------------------------
@group(0) @binding(8) var dv_vel_in: texture_2d<f32>;
@group(0) @binding(9) var dv_out: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn divergence(@builtin(global_invocation_id) gid: vec3u) {
  if (!inBounds(gid)) { return; }
  let c = vec2i(gid.xy);
  let l = textureLoad(dv_vel_in, clampCoord(c - vec2i(1, 0)), 0).x;
  let r = textureLoad(dv_vel_in, clampCoord(c + vec2i(1, 0)), 0).x;
  let b = textureLoad(dv_vel_in, clampCoord(c - vec2i(0, 1)), 0).y;
  let t = textureLoad(dv_vel_in, clampCoord(c + vec2i(0, 1)), 0).y;
  let div = 0.5 * ((r - l) + (t - b));
  textureStore(dv_out, c, vec4f(div, 0.0, 0.0, 1.0));
}

// ---- Pressure (Jacobi iteration) --------------------------------------------
@group(0) @binding(10) var pr_p_in: texture_2d<f32>;
@group(0) @binding(11) var pr_div: texture_2d<f32>;
@group(0) @binding(12) var pr_out: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn pressure(@builtin(global_invocation_id) gid: vec3u) {
  if (!inBounds(gid)) { return; }
  let c = vec2i(gid.xy);
  let l = textureLoad(pr_p_in, clampCoord(c - vec2i(1, 0)), 0).x;
  let r = textureLoad(pr_p_in, clampCoord(c + vec2i(1, 0)), 0).x;
  let b = textureLoad(pr_p_in, clampCoord(c - vec2i(0, 1)), 0).x;
  let t = textureLoad(pr_p_in, clampCoord(c + vec2i(0, 1)), 0).x;
  let div = textureLoad(pr_div, c, 0).x;
  let p = (l + r + b + t - div) * 0.25;
  textureStore(pr_out, c, vec4f(p, 0.0, 0.0, 1.0));
}

// ---- Subtract pressure gradient (project to divergence-free) -----------------
@group(0) @binding(13) var gs_vel_in: texture_2d<f32>;
@group(0) @binding(14) var gs_p_in: texture_2d<f32>;
@group(0) @binding(15) var gs_out: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn gradSub(@builtin(global_invocation_id) gid: vec3u) {
  if (!inBounds(gid)) { return; }
  let c = vec2i(gid.xy);
  let l = textureLoad(gs_p_in, clampCoord(c - vec2i(1, 0)), 0).x;
  let r = textureLoad(gs_p_in, clampCoord(c + vec2i(1, 0)), 0).x;
  let b = textureLoad(gs_p_in, clampCoord(c - vec2i(0, 1)), 0).x;
  let t = textureLoad(gs_p_in, clampCoord(c + vec2i(0, 1)), 0).x;
  var v = textureLoad(gs_vel_in, c, 0).xy;
  v.x = v.x - 0.5 * (r - l);
  v.y = v.y - 0.5 * (t - b);
  textureStore(gs_out, c, vec4f(v, 0.0, 1.0));
}

// ---- Advect dye along the (projected) velocity ------------------------------
@group(0) @binding(16) var ad_samp: sampler;
@group(0) @binding(17) var ad_dye_in: texture_2d<f32>;
@group(0) @binding(18) var ad_vel_in: texture_2d<f32>;
@group(0) @binding(19) var ad_dye_out: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn advectDye(@builtin(global_invocation_id) gid: vec3u) {
  if (!inBounds(gid)) { return; }
  let c = vec2i(gid.xy);
  let coord = vec2f(c) + 0.5;
  let v = textureLoad(ad_vel_in, c, 0).xy;
  let prev = (coord - u.dt * v) * u.texel;
  let result = textureSampleLevel(ad_dye_in, ad_samp, prev, 0.0).xyz * u.dyeDissipation;
  textureStore(ad_dye_out, c, vec4f(result, 1.0));
}
