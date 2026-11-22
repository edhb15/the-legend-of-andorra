import { Scene, Mesh, VertexData, StandardMaterial, Color3, MaterialPluginBase, Material, UniformBuffer, MaterialDefines, ShaderLanguage } from "@babylonjs/core";
import { WORLD } from "../config";
import { GLSL_NOISE, GLSL_POISON } from "./ShaderLib";
import { WorldShaderGlobals } from "./MaterialPlugins";
import type { Hydrology, River, Lake } from "./Hydrology";

class WaterPlugin extends MaterialPluginBase {
  constructor(material: Material, private flowing: boolean) {
    super(material, "LoaWater", 230, { LOA_WATER: false, LOA_FLOW: false });
    this._enable(true);
  }
  override prepareDefines(defines: MaterialDefines): void {
    defines["LOA_WATER"] = true;
    defines["LOA_FLOW"] = this.flowing;
  }
  override getClassName(): string {
    return "WaterPlugin";
  }
  override isCompatible(lang: ShaderLanguage): boolean {
    return lang === ShaderLanguage.GLSL;
  }
  override getSamplers(samplers: string[]): void {
    samplers.push("worldInfo");
  }
  override getUniforms() {
    const decl = `uniform vec4 poisonParams; uniform vec4 worldDims; uniform vec4 safeZones[8]; uniform vec4 worldMisc;`;
    return {
      ubo: [
        { name: "poisonParams", size: 4, type: "vec4" },
        { name: "worldDims", size: 4, type: "vec4" },
        { name: "safeZones", size: 4, type: "vec4", arraySize: 8 },
        { name: "worldMisc", size: 4, type: "vec4" },
      ],
      fragment: decl,
      vertex: decl,
    };
  }
  override bindForSubMesh(ub: UniformBuffer): void {
    const g = WorldShaderGlobals;
    ub.updateFloat4("poisonParams", g.threshold, g.time, g.edge, g.enabled);
    ub.updateFloat4("worldDims", WORLD.halfW, WORLD.halfD, WORLD.width, WORLD.depth);
    ub.updateFloatArray("safeZones", g.safeZones);
    ub.updateFloat4("worldMisc", g.doom, g.wind, g.px, g.pz);
    if (g.worldInfo) ub.setTexture("worldInfo", g.worldInfo);
  }
  override getCustomCode(shaderType: string): any {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
uniform sampler2D worldInfo;
${GLSL_NOISE}
${GLSL_POISON}
`,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `
{
  float t = poisonParams.y;
  vec2 p = vPositionW.xz;
#ifdef LOA_FLOW
  vec2 flowUV = vec2(vColor.r * 3.0, vColor.g * 0.25 - t * 0.9);
  float n1 = loa_vnoise(flowUV * vec2(2.0, 1.2));
  float n2 = loa_vnoise(flowUV * vec2(5.0, 2.5) + 7.3);
  float foam = smoothstep(0.62, 0.9, n1 * 0.6 + n2 * 0.5) * 0.5;
  foam += smoothstep(0.35, 0.5, abs(vColor.r - 0.5)) * 0.25 * n2;
#else
  float n1 = loa_vnoise(p * 0.15 + vec2(t * 0.05, t * 0.03));
  float n2 = loa_vnoise(p * 0.45 - vec2(t * 0.08, -t * 0.02));
  float foam = 0.0;
#endif
  vec3 nrm = normalize(vec3((n1 - 0.5) * 0.35 + (n2 - 0.5) * 0.25, 1.0, (n2 - 0.5) * 0.35 - (n1 - 0.5) * 0.15));
  normalW = normalize(mix(normalW, nrm, 0.85));
  vec3 deep = vec3(0.04, 0.16, 0.22);
  vec3 shallow = vec3(0.12, 0.34, 0.38);
  float fres = pow(1.0 - clamp(dot(normalize(vEyePosition.xyz - vPositionW), normalW), 0.0, 1.0), 3.0);
  vec3 col = mix(deep, shallow, n1 * 0.6) + vec3(0.25, 0.32, 0.38) * fres;
  col = mix(col, vec3(0.85, 0.92, 0.95), foam);
  float pc = loa_poisonCover(p);
  col = mix(col, vec3(0.16, 0.24, 0.08) + vec3(0.14, 0.0, 0.16) * n2, pc * 0.75);
  baseColor.rgb = col;
}
`,
    };
  }
}

export function waterMaterial(scene: Scene, flowing: boolean): StandardMaterial {
  const m = new StandardMaterial(flowing ? "riverMat" : "lakeMat", scene);
  m.diffuseColor = new Color3(1, 1, 1);
  m.specularColor = new Color3(0.9, 0.9, 0.85);
  m.specularPower = 96;
  m.alpha = flowing ? 0.86 : 0.82;
  m.backFaceCulling = false;
  new WaterPlugin(m, flowing);
  return m;
}

/** Build river ribbons (merged per region) and lake surfaces. */
export function buildWater(scene: Scene, hydro: Hydrology): Mesh[] {
  const meshes: Mesh[] = [];
  const riverMat = waterMaterial(scene, true);
  const lakeMat = waterMaterial(scene, false);
  // Rivers: one mesh per river.
  for (const r of hydro.rivers) {
    const m = riverMesh(scene, r);
    if (m) {
      m.material = riverMat;
      meshes.push(m);
    }
  }
  for (const l of hydro.lakes) {
    const m = lakeMesh(scene, l);
    m.material = lakeMat;
    meshes.push(m);
  }
  for (const m of meshes) {
    m.isPickable = false;
    m.receiveShadows = true;
    m.freezeWorldMatrix();
  }
  return meshes;
}

function riverMesh(scene: Scene, r: River): Mesh | null {
  const pts = r.pts;
  if (pts.length < 2) return null;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let dist = 0;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const nx = -dz, nz = dx;
    const hw = p.w * 0.5 + 0.4;
    if (k > 0) dist += Math.hypot(p.x - pts[k - 1].x, p.z - pts[k - 1].z);
    positions.push(p.x + nx * hw, p.y, p.z + nz * hw, p.x - nx * hw, p.y, p.z - nz * hw);
    colors.push(0, dist / 4, 0, 1, 1, dist / 4, 0, 1);
    if (k > 0) {
      const i = (k - 1) * 2;
      indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  const m = new Mesh("river", scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.colors = colors;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  for (let i = 0; i < normals.length; i += 3) {
    normals[i] = 0;
    normals[i + 1] = 1;
    normals[i + 2] = 0;
  }
  vd.normals = normals;
  vd.applyToMesh(m);
  return m;
}

function lakeMesh(scene: Scene, l: Lake): Mesh {
  const NX = WORLD.nx;
  const set = new Set<number>();
  for (const c of l.cells) set.add(c);
  const positions: number[] = [];
  const indices: number[] = [];
  const vmap = new Map<number, number>();
  const vid = (i: number, j: number) => {
    const key = j * NX + i;
    let v = vmap.get(key);
    if (v === undefined) {
      v = positions.length / 3;
      positions.push(i * WORLD.cell - WORLD.halfW, l.level, j * WORLD.cell - WORLD.halfD);
      vmap.set(key, v);
    }
    return v;
  };
  for (let j = l.minJ - 1; j <= l.maxJ; j++) {
    for (let i = l.minI - 1; i <= l.maxI; i++) {
      const a = j * NX + i;
      if (!(set.has(a) || set.has(a + 1) || set.has(a + NX) || set.has(a + NX + 1))) continue;
      const va = vid(i, j), vb = vid(i + 1, j), vc = vid(i, j + 1), vd2 = vid(i + 1, j + 1);
      indices.push(va, vb, vc, vb, vd2, vc);
    }
  }
  const m = new Mesh("lake", scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
  vd.applyToMesh(m);
  return m;
}
