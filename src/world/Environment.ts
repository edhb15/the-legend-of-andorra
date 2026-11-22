import {
  Scene, Mesh, MeshBuilder, ShaderMaterial, Effect, Vector3, Color3, Color4, DirectionalLight, HemisphericLight,
  CascadedShadowGenerator, ShadowGenerator, AbstractMesh, Scalar, Vector4,
} from "@babylonjs/core";
import { clamp01, lerp, smoothstep } from "../core/MathUtil";
import { GLSL_NOISE } from "./ShaderLib";
import type { Quality } from "../config";

Effect.ShadersStore["loaSkyVertexShader"] = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = worldViewProjection * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

Effect.ShadersStore["loaSkyFragmentShader"] = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 sunDir;
uniform vec3 moonDir;
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 sunColor;
uniform vec4 params; // x time, y doom, z stars, w cloudCover
uniform vec4 params2; // x victory, y daylight
${GLSL_NOISE}
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float t = params.x;
  float doom = params.y;
  vec3 col = mix(horizon, zenith, pow(clamp(y + 0.02, 0.0, 1.0), 0.5));
  // below horizon: darker haze
  col = mix(col, horizon * 0.55, smoothstep(0.0, -0.2, y));
  float sd = max(dot(d, sunDir), 0.0);
  float sunVis = smoothstep(-0.12, 0.02, sunDir.y);
  col += sunColor * (pow(sd, 1200.0) * 25.0 + pow(sd, 16.0) * 0.35 + pow(sd, 3.0) * 0.12) * sunVis;
  // moon
  float md = max(dot(d, moonDir), 0.0);
  float night = params.z;
  col += vec3(0.88, 0.92, 1.0) * (smoothstep(0.99955, 0.99975, md) * 1.6 + pow(md, 80.0) * 0.25) * night;
  // stars
  vec3 sp = d * 260.0;
  vec3 cell = floor(sp);
  float hs = loa_hash13(cell);
  float star = step(0.9972, hs) * (1.0 - smoothstep(0.08, 0.32, length(fract(sp) - 0.5)));
  float tw = 0.6 + 0.4 * sin(t * (2.0 + hs * 4.0) + hs * 80.0);
  col += vec3(0.9, 0.95, 1.0) * star * tw * night * smoothstep(0.02, 0.25, y) * (1.0 - doom * 0.6);
  // milky band
  col += vec3(0.25, 0.28, 0.4) * loa_fbm2(d.xz * 6.0 / (abs(d.y) + 0.6)) * night * 0.12 * smoothstep(0.1, 0.5, y);
  // clouds
  if (y > -0.02) {
    vec2 uv = d.xz / (y + 0.13);
    float cn = loa_fbm2(uv * 1.15 + vec2(t * 0.006, t * 0.002));
    float cn2 = loa_fbm2(uv * 3.1 - vec2(t * 0.01, 0.0));
    float cov = params.w;
    float c = smoothstep(1.0 - cov - 0.08, 1.0 - cov + 0.3, cn * 0.8 + cn2 * 0.35);
    float lit = 0.55 + 0.45 * pow(sd, 4.0);
    vec3 cloudDay = mix(vec3(0.92, 0.93, 0.96), sunColor, 0.25) * lit;
    vec3 cloudCol = mix(horizon * 0.45 + vec3(0.02), cloudDay, params2.y);
    // ominous tint
    cloudCol = mix(cloudCol, vec3(0.22, 0.14, 0.26) + vec3(0.06, 0.14, 0.04) * cn2, doom * 0.75);
    col = mix(col, cloudCol, c * smoothstep(-0.02, 0.12, y) * 0.9);
  }
  // apocalypse colour grading + green glow at the horizon
  col = mix(col, col * vec3(0.72, 0.58, 0.82), doom * 0.55);
  col += vec3(0.10, 0.22, 0.06) * doom * (1.0 - smoothstep(0.0, 0.25, abs(y))) * (0.6 + 0.4 * sin(t * 0.3 + d.x * 3.0));
  // victory: rainbow-tinted brilliance
  if (params2.x > 0.0) {
    float ang = atan(d.z, d.x);
    vec3 rb = 0.5 + 0.5 * cos(6.2831 * (ang / 6.2831 * 2.0 + vec3(0.0, 0.33, 0.67)));
    float arc = smoothstep(0.06, 0.0, abs(acos(clamp(dot(d, -sunDir), -1.0, 1.0)) - 0.72));
    col += rb * arc * params2.x * 0.35 * smoothstep(0.0, 0.1, y);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export interface SkyState {
  hour: number;
  doom: number;
  victory: number;
  time: number;
  interior: boolean;
}

/** Sky dome, sun/moon light, ambient, scene fog, shadows. */
export class Environment {
  sky: Mesh;
  skyMat: ShaderMaterial;
  sun: DirectionalLight;
  hemi: HemisphericLight;
  shadows: CascadedShadowGenerator | ShadowGenerator | null = null;
  sunDir = new Vector3(0, 1, 0);
  moonDir = new Vector3(0, 1, 0);
  fogColor = new Color3(0.6, 0.7, 0.8);
  horizon = new Color3();
  zenith = new Color3();
  daylight = 1;
  /** extra fog density from gameplay (poison proximity) */
  fogBoost = 0;
  /** 0..1 tint of the fog when the player stands inside the poison cloud */
  poisonTint = 0;
  interiorMode = false;
  private casters = new Set<AbstractMesh>();
  private v4a = new Vector4();
  private v4b = new Vector4();

  constructor(private scene: Scene, quality: Quality) {
    this.sky = MeshBuilder.CreateSphere("sky", { diameter: 9000, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
    this.sky.infiniteDistance = true;
    this.sky.isPickable = false;
    this.skyMat = new ShaderMaterial("skyMat", scene, { vertex: "loaSky", fragment: "loaSky" }, {
      attributes: ["position"],
      uniforms: ["worldViewProjection", "sunDir", "moonDir", "zenith", "horizon", "sunColor", "params", "params2"],
    });
    this.skyMat.backFaceCulling = false;
    this.skyMat.disableDepthWrite = true;
    this.sky.material = this.skyMat;
    this.sky.renderingGroupId = 0;
    this.sky.applyFog = false;

    this.sun = new DirectionalLight("sun", new Vector3(-0.3, -1, 0.2), scene);
    this.sun.intensity = 2.2;
    this.hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
    this.hemi.intensity = 0.55;

    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.00035;
    scene.fogColor = this.fogColor;
    scene.clearColor = new Color4(0.5, 0.6, 0.7, 1);
    scene.ambientColor = new Color3(0.25, 0.25, 0.28);

    this.setQuality(quality);
  }

  setQuality(q: Quality): void {
    if (this.shadows) {
      this.shadows.dispose();
      this.shadows = null;
    }
    if (q === "low") return;
    const csm = new CascadedShadowGenerator(q === "high" ? 2048 : 1024, this.sun);
    csm.numCascades = q === "high" ? 3 : 2;
    csm.lambda = 0.82;
    csm.shadowMaxZ = q === "high" ? 260 : 160;
    csm.stabilizeCascades = true;
    csm.autoCalcDepthBounds = false;
    csm.usePercentageCloserFiltering = true;
    csm.filteringQuality = q === "high" ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
    csm.bias = 0.004;
    csm.normalBias = 0.02;
    csm.darkness = 0.15;
    csm.cascadeBlendPercentage = 0.1;
    csm.depthClamp = true;
    this.shadows = csm;
    for (const m of this.casters) csm.addShadowCaster(m, false);
  }

  addCaster(m: AbstractMesh, children = true): void {
    this.casters.add(m);
    if (children) for (const c of m.getChildMeshes(false)) this.casters.add(c);
    if (this.shadows) this.shadows.addShadowCaster(m, children);
  }
  removeCaster(m: AbstractMesh): void {
    this.casters.delete(m);
    for (const c of m.getChildMeshes(false)) this.casters.delete(c);
    if (this.shadows) this.shadows.removeShadowCaster(m, true);
  }

  setInterior(on: boolean, ambient = new Color3(0.08, 0.07, 0.1)): void {
    this.interiorMode = on;
    this.sky.setEnabled(!on);
    if (on) {
      this.scene.fogMode = Scene.FOGMODE_EXP2;
      this.scene.fogDensity = 0.018;
      this.scene.fogColor = ambient.scale(0.6);
      this.scene.clearColor = new Color4(ambient.r * 0.5, ambient.g * 0.5, ambient.b * 0.5, 1);
      this.hemi.intensity = 0.7;
      this.hemi.diffuse = ambient.scale(4).add(new Color3(0.22, 0.22, 0.24)).clampToRef(0, 1, new Color3());
      this.hemi.groundColor = ambient.scale(2).add(new Color3(0.06, 0.06, 0.07));
      this.sun.intensity = 0;
    }
  }

  update(s: SkyState): void {
    if (this.interiorMode) return;
    const h = s.hour;
    // Sun path: rises in the east (+X) at 06:00, sets in the west at 20:30, crosses the south.
    const theta = ((h - 6) / 14.5) * Math.PI;
    const maxElev = 1.1;
    this.sunDir.set(Math.cos(theta), Math.sin(theta) * Math.sin(maxElev), -Math.sin(theta) * Math.cos(maxElev) - 0.25).normalize();
    // Moon roughly opposite, kept a bit higher.
    const mt = theta + Math.PI;
    this.moonDir.set(Math.cos(mt) * 0.8, Math.abs(Math.sin(mt)) * 0.75 + 0.15, 0.35).normalize();

    const e = this.sunDir.y; // -1..1
    const dayK = smoothstep(-0.05, 0.35, e);
    const twilight = Math.max(0, 1 - Math.abs(e - 0.02) / 0.22);
    const nightK = 1 - smoothstep(-0.25, 0.02, e);
    this.daylight = dayK;

    const zNight = new Color3(0.012, 0.018, 0.045), zDay = new Color3(0.2, 0.42, 0.82);
    const hNight = new Color3(0.04, 0.05, 0.1), hDay = new Color3(0.66, 0.78, 0.92), hTw = new Color3(0.98, 0.52, 0.28);
    Color3.LerpToRef(zNight, zDay, dayK, this.zenith);
    Color3.LerpToRef(hNight, hDay, dayK, this.horizon);
    Color3.LerpToRef(this.horizon, hTw, twilight * 0.85, this.horizon);
    Color3.LerpToRef(this.zenith, new Color3(0.25, 0.22, 0.45), twilight * 0.35, this.zenith);
    // doom darkening
    const doom = s.doom * (1 - s.victory);
    Color3.LerpToRef(this.zenith, new Color3(0.07, 0.04, 0.1), doom * 0.55, this.zenith);
    Color3.LerpToRef(this.horizon, new Color3(0.28, 0.2, 0.3), doom * 0.5, this.horizon);
    if (s.victory > 0) {
      Color3.LerpToRef(this.zenith, new Color3(0.25, 0.5, 0.95), s.victory * 0.4, this.zenith);
    }

    const sunColor = new Color3(1, 0.96, 0.88);
    Color3.LerpToRef(sunColor, new Color3(1, 0.55, 0.25), twilight, sunColor);
    Color3.LerpToRef(sunColor, new Color3(0.85, 0.7, 0.9), doom * 0.4, sunColor);

    this.skyMat.setVector3("sunDir", this.sunDir);
    this.skyMat.setVector3("moonDir", this.moonDir);
    this.skyMat.setColor3("zenith", this.zenith);
    this.skyMat.setColor3("horizon", this.horizon);
    this.skyMat.setColor3("sunColor", sunColor);
    const cloudCover = 0.38 + doom * 0.4;
    this.skyMat.setVector4("params", this.v4a.set(s.time, doom, nightK, cloudCover));
    this.skyMat.setVector4("params2", this.v4b.set(s.victory, dayK, 0, 0));

    // Lights: sun by day, moon by night.
    const sunI = smoothstep(-0.02, 0.18, e);
    const moonI = nightK;
    if (sunI > 0.01) {
      this.sun.direction.copyFrom(this.sunDir).scaleInPlace(-1);
      this.sun.diffuse.copyFrom(sunColor);
      this.sun.intensity = lerp(0, 2.4, sunI) * (1 - doom * 0.35);
    } else {
      this.sun.direction.copyFrom(this.moonDir).scaleInPlace(-1);
      this.sun.diffuse.set(0.55, 0.65, 0.95);
      this.sun.intensity = 0.38 * moonI * (1 - doom * 0.3);
    }
    this.sun.specular.copyFrom(this.sun.diffuse);
    this.hemi.intensity = lerp(0.36, 0.85, dayK) * (1 - doom * 0.25);
    this.hemi.diffuse.copyFrom(Color3.Lerp(new Color3(0.35, 0.42, 0.7), new Color3(0.75, 0.82, 0.95), dayK));
    this.hemi.groundColor.copyFrom(Color3.Lerp(new Color3(0.08, 0.08, 0.12), new Color3(0.28, 0.26, 0.2), dayK));
    if (doom > 0) {
      Color3.LerpToRef(this.hemi.diffuse, new Color3(0.55, 0.45, 0.65), doom * 0.4, this.hemi.diffuse);
    }

    // Fog follows the horizon colour.
    Color3.LerpToRef(this.horizon, new Color3(0.35, 0.3, 0.38), doom * 0.3, this.fogColor);
    Color3.LerpToRef(this.fogColor, new Color3(0.3, 0.4, 0.22), this.poisonTint * 0.75, this.fogColor);
    this.scene.fogColor = this.fogColor;
    this.scene.fogDensity = (0.00028 + doom * 0.00028 + this.fogBoost) * (1 + nightK * 0.3);
    this.scene.clearColor.set(this.horizon.r, this.horizon.g, this.horizon.b, 1);
  }
}

void Scalar;
void clamp01;
