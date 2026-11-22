import { MaterialPluginBase, Material, UniformBuffer, Scene, AbstractEngine, SubMesh, Texture, MaterialDefines, AbstractMesh, ShaderLanguage } from "@babylonjs/core";
import { WORLD } from "../config";
import { GLSL_NOISE, GLSL_POISON } from "./ShaderLib";

/** Global shader state shared by every world material (poison front, time, safe zones…). */
export const WorldShaderGlobals = {
  worldInfo: null as Texture | null,
  splat: null as Texture | null,
  threshold: -1000,
  time: 0,
  edge: 45,
  enabled: 1,
  doom: 0,
  wind: 1,
  safeZones: new Float32Array(32),
  /** player position for grass bending */
  px: 0,
  pz: 0,
};

const POISON_UBO = [
  { name: "poisonParams", size: 4, type: "vec4" },
  { name: "worldDims", size: 4, type: "vec4" },
  { name: "safeZones", size: 4, type: "vec4", arraySize: 8 },
  { name: "worldMisc", size: 4, type: "vec4" },
];
const POISON_DECL = `
uniform vec4 poisonParams;
uniform vec4 worldDims;
uniform vec4 safeZones[8];
uniform vec4 worldMisc;
`;

function bindPoison(ub: UniformBuffer): void {
  const g = WorldShaderGlobals;
  ub.updateFloat4("poisonParams", g.threshold, g.time, g.edge, g.enabled);
  ub.updateFloat4("worldDims", WORLD.halfW, WORLD.halfD, WORLD.width, WORLD.depth);
  ub.updateFloatArray("safeZones", g.safeZones);
  ub.updateFloat4("worldMisc", g.doom, g.wind, g.px, g.pz);
  if (g.worldInfo) ub.setTexture("worldInfo", g.worldInfo);
}

// =============================================================================================
// Terrain
// =============================================================================================
export class TerrainPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, "LoaTerrain", 200, { LOA_TERRAIN: false });
    this._enable(true);
  }
  override prepareDefines(defines: MaterialDefines): void {
    defines["LOA_TERRAIN"] = true;
  }
  override getClassName(): string {
    return "TerrainPlugin";
  }
  override isCompatible(lang: ShaderLanguage): boolean {
    return lang === ShaderLanguage.GLSL;
  }
  override getSamplers(samplers: string[]): void {
    samplers.push("worldInfo", "terrainSplat");
  }
  override getUniforms() {
    return { ubo: POISON_UBO, fragment: POISON_DECL, vertex: POISON_DECL };
  }
  override bindForSubMesh(ub: UniformBuffer): void {
    bindPoison(ub);
    if (WorldShaderGlobals.splat) ub.setTexture("terrainSplat", WorldShaderGlobals.splat);
  }
  override getCustomCode(shaderType: string): any {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
uniform sampler2D worldInfo;
uniform sampler2D terrainSplat;
${GLSL_NOISE}
${GLSL_POISON}
float loa_poisonAmt = 0.0;
float loa_vein = 0.0;
`,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `
{
  vec3 P = vPositionW;
  vec2 wuv = (P.xz + worldDims.xy) / worldDims.zw;
  vec4 splat = texture2D(terrainSplat, wuv);
  float slope = 1.0 - clamp(normalW.y, 0.0, 1.0);
  float n1 = loa_fbm2(P.xz * 0.012);
  float n2 = loa_vnoise(P.xz * 0.21);
  float n3 = loa_vnoise(P.xz * 1.7);
  float n4 = loa_vnoise(P.xz * 6.3);
  float h = P.y + (n1 - 0.5) * 40.0;
  vec3 grassLush = vec3(0.27, 0.44, 0.14);
  vec3 grassDry  = vec3(0.50, 0.52, 0.23);
  vec3 alpine    = vec3(0.44, 0.46, 0.30);
  vec3 forest    = vec3(0.16, 0.19, 0.08);
  vec3 rock      = mix(vec3(0.36, 0.34, 0.33), vec3(0.52, 0.50, 0.47), n3);
  vec3 scree     = vec3(0.55, 0.52, 0.48);
  vec3 snow      = vec3(0.93, 0.95, 1.0);
  vec3 dirt      = vec3(0.42, 0.33, 0.22);
  vec3 col = mix(grassLush, grassDry, smoothstep(0.35, 0.75, n1 + n2 * 0.25));
  col *= 0.85 + 0.3 * n4;
  col = mix(col, alpine, smoothstep(380.0, 470.0, h));
  col = mix(col, forest * (0.8 + 0.4 * n3), smoothstep(0.05, 0.6, splat.r));
  // wet river banks
  col = mix(col, col * vec3(0.7, 0.85, 0.7), splat.g);
  float rockAmt = smoothstep(0.30, 0.46, slope + (n2 - 0.5) * 0.14);
  rockAmt = max(rockAmt, smoothstep(450.0, 540.0, h) * smoothstep(0.02, 0.2, slope + n2 * 0.12));
  vec3 rockCol = mix(rock, scree, smoothstep(0.55, 0.8, n2) * (1.0 - smoothstep(0.45, 0.6, slope)));
  // rock strata
  rockCol *= 0.85 + 0.25 * loa_vnoise(vec2(P.y * 0.45, P.x * 0.02 + P.z * 0.02));
  col = mix(col, rockCol, rockAmt);
  // dirt around paths, cobbles in village plazas
  col = mix(col, dirt * (0.8 + 0.4 * n4), splat.a * 0.85);
  float cob = smoothstep(0.08, 0.0, abs(fract(P.x * 0.9 + 0.5 * floor(P.z * 0.9)) - 0.5) - 0.42) + smoothstep(0.08, 0.0, abs(fract(P.z * 0.9) - 0.5) - 0.42);
  vec3 cobble = vec3(0.50, 0.47, 0.43) * (0.85 + 0.3 * loa_hash12(floor(P.xz * 0.9))) * (1.0 - 0.35 * clamp(cob, 0.0, 1.0));
  col = mix(col, cobble, splat.b);
  // snow: high + north facing + gentle
  float snowPatch = smoothstep(0.45, 0.75, loa_fbm2(P.xz * 0.03) + n2 * 0.2);
  float snowAmt = smoothstep(540.0, 600.0, h + normalW.z * 30.0) * (1.0 - smoothstep(0.18, 0.42, slope)) * snowPatch * (1.0 - worldMisc.x * 0.5);
  col = mix(col, snow, snowAmt);
  // micro normal detail
  vec2 dn = vec2(loa_vnoise(P.xz * 1.3) - loa_vnoise(P.xz * 1.3 + vec2(3.7, 0.0)), loa_vnoise(P.xz * 1.3 + vec2(0.0, 5.1)) - loa_vnoise(P.xz * 1.3 + vec2(2.3, 7.1)));
  normalW = normalize(normalW + vec3(dn.x, 0.0, dn.y) * (0.12 + rockAmt * 0.35));
  // poison corruption
  loa_poisonAmt = loa_poisonCover(P.xz);
  if (loa_poisonAmt > 0.001) {
    vec3 dead = mix(vec3(0.20, 0.15, 0.20), vec3(0.32, 0.26, 0.22), n2) * (0.7 + 0.3 * n4);
    float veinN = loa_fbm2(P.xz * 0.08 + vec2(poisonParams.y * 0.01));
    loa_vein = smoothstep(0.035, 0.0, abs(veinN - 0.5)) * loa_poisonAmt;
    col = mix(col, mix(col * vec3(0.55, 0.45, 0.6), dead, 0.65), loa_poisonAmt);
  }
  baseColor.rgb = col;
}
`,
      CUSTOM_FRAGMENT_BEFORE_FOG: `
  color.rgb += vec3(0.35, 1.0, 0.25) * loa_vein * (0.35 + 0.25 * sin(poisonParams.y * 2.0 + vPositionW.x * 0.05));
`,
    };
  }
}

// =============================================================================================
// Poison tint (+ optional wind sway) for vegetation, rocks and buildings
// =============================================================================================
export class PoisonTintPlugin extends MaterialPluginBase {
  private wind: boolean;
  private windStrength: number;
  constructor(material: Material, opts: { wind?: boolean; windStrength?: number } = {}) {
    super(material, "LoaPoisonTint", 210, { LOA_TINT: false, LOA_WIND: false });
    this.wind = !!opts.wind;
    this.windStrength = opts.windStrength ?? 1;
    this._enable(true);
  }
  override prepareDefines(defines: MaterialDefines): void {
    defines["LOA_TINT"] = true;
    defines["LOA_WIND"] = this.wind;
  }
  override getClassName(): string {
    return "PoisonTintPlugin";
  }
  override isCompatible(lang: ShaderLanguage): boolean {
    return lang === ShaderLanguage.GLSL;
  }
  override getSamplers(samplers: string[]): void {
    samplers.push("worldInfo");
  }
  override getUniforms() {
    return {
      ubo: [...POISON_UBO, { name: "windParams", size: 4, type: "vec4" }],
      fragment: POISON_DECL + "uniform vec4 windParams;",
      vertex: POISON_DECL + "uniform vec4 windParams;",
    };
  }
  override bindForSubMesh(ub: UniformBuffer): void {
    bindPoison(ub);
    ub.updateFloat4("windParams", this.windStrength, 0, 0, 0);
  }
  override getCustomCode(shaderType: string): any {
    if (shaderType === "vertex") {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `
${GLSL_NOISE}
`,
        CUSTOM_VERTEX_UPDATE_WORLDPOS: `
#ifdef LOA_WIND
{
  float hgt = max(positionUpdated.y, 0.0);
  float t = poisonParams.y;
  float ph = worldPos.x * 0.13 + worldPos.z * 0.11;
  float gust = 0.6 + 0.4 * loa_vnoise(worldPos.xz * 0.01 + vec2(t * 0.15, 0.0));
  float sway = (sin(t * 1.7 + ph) * 0.6 + sin(t * 3.1 + ph * 1.7) * 0.25) * gust * windParams.x * worldMisc.y;
  worldPos.x += sway * hgt * 0.035;
  worldPos.z += sway * hgt * 0.022;
}
#endif
`,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
uniform sampler2D worldInfo;
${GLSL_NOISE}
${GLSL_POISON}
`,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `
{
  float pc = loa_poisonCover(vPositionW.xz);
  if (pc > 0.001) {
    float lum = dot(baseColor.rgb, vec3(0.3, 0.59, 0.11));
    vec3 sick = vec3(lum * 0.75, lum * 0.55, lum * 0.8) + vec3(0.06, 0.02, 0.08);
    baseColor.rgb = mix(baseColor.rgb, sick, pc * 0.85);
  }
}
`,
    };
  }
}

// =============================================================================================
// Grass: wind + player bending + poison tint, for thin-instanced grass clumps.
// =============================================================================================
export class GrassPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, "LoaGrass", 220, { LOA_GRASS: false });
    this._enable(true);
  }
  override prepareDefines(defines: MaterialDefines): void {
    defines["LOA_GRASS"] = true;
  }
  override getClassName(): string {
    return "GrassPlugin";
  }
  override isCompatible(lang: ShaderLanguage): boolean {
    return lang === ShaderLanguage.GLSL;
  }
  override getSamplers(samplers: string[]): void {
    samplers.push("worldInfo");
  }
  override getUniforms() {
    return { ubo: POISON_UBO, fragment: POISON_DECL, vertex: POISON_DECL };
  }
  override bindForSubMesh(ub: UniformBuffer): void {
    bindPoison(ub);
  }
  override getCustomCode(shaderType: string): any {
    if (shaderType === "vertex") {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `${GLSL_NOISE}
varying float vGrassH;`,
        CUSTOM_VERTEX_UPDATE_WORLDPOS: `
{
  float hgt = max(positionUpdated.y, 0.0);
  vGrassH = hgt;
  float t = poisonParams.y;
  float gust = loa_vnoise(worldPos.xz * 0.02 + vec2(t * 0.35, t * 0.1));
  vec2 wdir = normalize(vec2(1.0, 0.45));
  float sway = (sin(t * 2.3 + worldPos.x * 0.35 + worldPos.z * 0.2) * 0.35 + gust * 0.9) * worldMisc.y;
  worldPos.xz += wdir * sway * hgt * 0.45;
  vec2 toP = worldPos.xz - worldMisc.zw;
  float d = length(toP);
  float bend = (1.0 - smoothstep(0.3, 1.6, d)) * hgt * 0.9;
  worldPos.xz += (toP / max(d, 0.001)) * bend;
  worldPos.y -= bend * 0.4;
}
`,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
uniform sampler2D worldInfo;
varying float vGrassH;
${GLSL_NOISE}
${GLSL_POISON}
`,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `
{
  baseColor.rgb *= mix(0.45, 1.15, clamp(vGrassH / 0.7, 0.0, 1.0));
  float pc = loa_poisonCover(vPositionW.xz);
  baseColor.rgb = mix(baseColor.rgb, vec3(0.30, 0.22, 0.30) * (0.5 + vGrassH), pc * 0.9);
}
`,
    };
  }
}
