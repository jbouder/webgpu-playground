struct Uniforms {
  resolutionTimeFov: vec4f,
  originSteps: vec4f,
  forwardDensity: vec4f,
  rightHue: vec4f,
  upFresnel: vec4f,
  effects: vec4f,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  return vec4f(positions[vertexIndex], 0.0, 1.0);
}

fn smoothMin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

fn sceneSdf(p: vec3f, t: f32) -> f32 {
  let core = length(p) - 0.72;
  let orbitA = vec3f(cos(t * 0.8), sin(t * 1.1) * 0.45, sin(t * 0.8)) * 0.55;
  let orbitB = vec3f(sin(t * 0.65 + 2.1), cos(t * 0.9) * 0.38, cos(t * 0.65 + 2.1)) * 0.62;
  let a = length(p - orbitA) - 0.38;
  let b = length(p - orbitB) - 0.31;
  return smoothMin(smoothMin(core, a, 0.28), b, 0.24);
}

// swap point: replace this procedural body with a texture_3d sample later.
fn sampleDensity(p: vec3f, t: f32) -> f32 {
  let shell = exp(-abs(sceneSdf(p, t)) * 8.0);
  let lattice = 0.72 + 0.28 * sin(p.x * 11.0 + t) * sin(p.y * 9.0 - t) * sin(p.z * 10.0);
  return shell * lattice * u.forwardDensity.w;
}

fn palette(x: f32) -> vec3f {
  let phase = vec3f(0.0, 2.1, 4.2) + u.rightHue.w * 6.28318;
  return 0.5 + 0.5 * cos(vec3f(x * 5.0) + phase);
}

fn sphereIntersection(origin: vec3f, direction: vec3f) -> vec2f {
  let b = dot(origin, direction);
  let c = dot(origin, origin) - 2.25;
  let h = b * b - c;
  if (h < 0.0) {
    return vec2f(1.0, -1.0);
  }
  let root = sqrt(h);
  return vec2f(-b - root, -b + root);
}

@fragment
fn fs(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
  let resolution = max(u.resolutionTimeFov.xy, vec2f(1.0));
  let uv = (fragCoord.xy * 2.0 - resolution) / resolution.y;
  let origin = u.originSteps.xyz;
  let direction = normalize(
    u.forwardDensity.xyz
      + u.rightHue.xyz * uv.x * u.resolutionTimeFov.w
      - u.upFresnel.xyz * uv.y * u.resolutionTimeFov.w
  );
  let hit = sphereIntersection(origin, direction);
  let scan = 1.0 + sin(fragCoord.y * 0.55 + u.resolutionTimeFov.z * 7.0) * 0.08 * u.effects.x;
  let roll = 0.08 * u.effects.z * exp(-pow(fract(fragCoord.y / resolution.y - u.resolutionTimeFov.z * 0.08) - 0.5, 2.0) * 90.0);
  let vignette = 1.0 - 0.38 * smoothstep(0.35, 1.4, dot(uv, uv));
  let background = vec3f(0.004, 0.012, 0.025) * (scan + roll) * vignette;
  if (hit.x > hit.y) {
    return vec4f(background, 1.0);
  }

  let tNear = max(hit.x, 0.0);
  let stepLength = (hit.y - tNear) / max(u.originSteps.w, 1.0);
  var color = vec3f(0.0);
  var alpha = 0.0;
  let chromaOffset = direction * (0.012 * u.effects.y);
  for (var i = 0u; i < 192u; i++) {
    if (i >= u32(u.originSteps.w) || alpha > 0.99) {
      break;
    }
    let distance = tNear + (f32(i) + 0.5) * stepLength;
    let p = origin + direction * distance;
    let density = sampleDensity(p, u.resolutionTimeFov.z);
    let chromaDensity = vec3f(
      sampleDensity(p + chromaOffset, u.resolutionTimeFov.z),
      density,
      sampleDensity(p - chromaOffset, u.resolutionTimeFov.z),
    );
    let eps = 0.012;
    let normal = normalize(vec3f(
      sceneSdf(p + vec3f(eps, 0.0, 0.0), u.resolutionTimeFov.z) - sceneSdf(p - vec3f(eps, 0.0, 0.0), u.resolutionTimeFov.z),
      sceneSdf(p + vec3f(0.0, eps, 0.0), u.resolutionTimeFov.z) - sceneSdf(p - vec3f(0.0, eps, 0.0), u.resolutionTimeFov.z),
      sceneSdf(p + vec3f(0.0, 0.0, eps), u.resolutionTimeFov.z) - sceneSdf(p - vec3f(0.0, 0.0, eps), u.resolutionTimeFov.z),
    ));
    let rim = pow(1.0 - abs(dot(normal, direction)), 2.5) * u.upFresnel.w;
    let sampleColor = palette(density + distance * 0.32) * chromaDensity * (0.35 + rim * 2.2);
    let sampleAlpha = clamp(density * (0.055 + rim * 0.12) * scan, 0.0, 0.35);
    color += (1.0 - alpha) * sampleColor * sampleAlpha;
    alpha += (1.0 - alpha) * sampleAlpha;
  }
  let flicker = 1.0 + u.effects.z * (sin(u.resolutionTimeFov.z * 41.0) * 0.035 + sin(u.resolutionTimeFov.z * 2.7) * 0.06);
  return vec4f((background * (1.0 - alpha) + color) * flicker, 1.0);
}
