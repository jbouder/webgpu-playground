struct Render { viewProj:mat4x4f, light:vec4f };
@group(0) @binding(0) var<uniform> r:Render; @group(0) @binding(1) var<storage,read> pos:array<vec4f>; @group(0) @binding(2) var<storage,read> normals:array<vec4f>;
struct Out{@builtin(position) position:vec4f,@location(0) normal:vec3f,@location(1) world:vec3f};
@vertex fn vs(@builtin(vertex_index) i:u32)->Out{var o:Out;let p=pos[i].xyz;o.position=r.viewProj*vec4f(p,1.0);o.normal=normals[i].xyz;o.world=p;return o;}
@fragment fn fs(i:Out)->@location(0) vec4f{let l=normalize(r.light.xyz-i.world);let lit=.2+.8*abs(dot(normalize(i.normal),l));let rim=pow(1.0-abs(i.normal.y),2.0);return vec4f(vec3f(.08,.42,.72)*lit+rim*.12,1.0);}
