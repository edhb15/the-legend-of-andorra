/** Shared GLSL snippets. */
export const GLSL_NOISE = /* glsl */ `
float loa_hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float loa_hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float loa_vnoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(loa_hash12(i),loa_hash12(i+vec2(1.,0.)),u.x), mix(loa_hash12(i+vec2(0.,1.)),loa_hash12(i+vec2(1.,1.)),u.x),u.y); }
float loa_fbm2(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*loa_vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=.5;} return s; }
float loa_vnoise3(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); vec3 u=f*f*(3.-2.*f);
  float a=loa_hash13(i), b=loa_hash13(i+vec3(1,0,0)), c=loa_hash13(i+vec3(0,1,0)), d=loa_hash13(i+vec3(1,1,0));
  float e=loa_hash13(i+vec3(0,0,1)), f1=loa_hash13(i+vec3(1,0,1)), g=loa_hash13(i+vec3(0,1,1)), h=loa_hash13(i+vec3(1,1,1));
  return mix(mix(mix(a,b,u.x),mix(c,d,u.x),u.y), mix(mix(e,f1,u.x),mix(g,h,u.x),u.y), u.z); }
float loa_fbm3(vec3 p){ float s=0., a=.5; for(int i=0;i<3;i++){ s+=a*loa_vnoise3(p); p=p*2.07+vec3(3.1,1.7,5.3); a*=.5;} return s; }
`;

/**
 * Poison coverage helper. Requires uniforms:
 *  - sampler2D worldInfo  (R = signed distance to Andorra's border, encoded)
 *  - vec4 poisonParams    (x = threshold distance, y = time, z = edge width, w = enabled)
 *  - vec4 safeZones[8]    (xz = centre, z = radius, w = strength)
 *  - vec4 worldDims       (x = halfW, y = halfD, z = width, w = depth)
 */
export const GLSL_POISON = /* glsl */ `
float loa_decodeDist(float r){ return r * 2600.0 - 600.0; }
float loa_poisonCover(vec2 xz){
  vec2 uv = (xz + worldDims.xy) / worldDims.zw;
  float bd;
  if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) bd = -600.0;
  else bd = loa_decodeDist(texture2D(worldInfo, uv).r);
  float wob = (loa_vnoise(xz * 0.012 + vec2(poisonParams.y * 0.03, 0.)) - 0.5) * 70.0;
  float c = 1.0 - smoothstep(poisonParams.x - poisonParams.z, poisonParams.x + poisonParams.z, bd + wob);
  for (int k = 0; k < 8; k++) {
    vec4 s = safeZones[k];
    if (s.w > 0.0) {
      float d = length(xz - s.xy);
      c *= 1.0 - s.w * (1.0 - smoothstep(s.z * 0.75, s.z, d));
    }
  }
  return c * poisonParams.w;
}
`;
