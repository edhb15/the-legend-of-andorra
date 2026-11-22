import { PostProcess, Effect, RawTexture, Engine, Texture, Matrix, Vector3, Color4, ParticleSystem, DepthRenderer, Camera } from "@babylonjs/core";
import type { Game } from "../core/Game";
import { WORLD } from "../config";
import { clamp01, smoothstep, lerp, distToSegment } from "../core/MathUtil";
import { GLSL_NOISE } from "../world/ShaderLib";
import { WorldShaderGlobals } from "../world/MaterialPlugins";

Effect.ShadersStore["loaPoisonFogFragmentShader"] = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D depthSampler;
uniform sampler2D worldInfo;
uniform mat4 invViewProj;
uniform vec3 camPos;
uniform vec3 camFwd;
uniform vec4 poisonParams;
uniform vec4 worldDims;
uniform vec4 safeZones[8];
uniform vec4 fogLight;
uniform vec4 extra;
${GLSL_NOISE}
float coverFrom(float r, vec2 xz, vec2 uv){
  float bd = (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) ? -600.0 : r * 2600.0 - 600.0;
  float wob = (loa_vnoise(xz * 0.012 + vec2(poisonParams.y * 0.03, 0.)) - 0.5) * 70.0;
  float c = 1.0 - smoothstep(poisonParams.x - poisonParams.z, poisonParams.x + poisonParams.z, bd + wob);
  for (int k = 0; k < 8; k++) {
    vec4 s = safeZones[k];
    if (s.w > 0.0) {
      float d = length(xz - s.xy);
      c *= 1.0 - s.w * (1.0 - smoothstep(s.z * 0.75, s.z, d));
    }
  }
  return c;
}
void main(void){
  vec4 sceneCol = texture2D(textureSampler, vUV);
  if (poisonParams.w < 0.5) { gl_FragColor = sceneCol; return; }
  float vz = texture2D(depthSampler, vUV).r;
  vec4 wp = invViewProj * vec4(vUV * 2.0 - 1.0, 1.0, 1.0);
  wp.xyz /= wp.w;
  vec3 dir = normalize(wp.xyz - camPos);
  float dist = vz <= 0.01 ? 4200.0 : vz / max(dot(dir, camFwd), 0.05);
  float maxD = min(dist, 4200.0);
  int steps = int(extra.x);
  float jitter = loa_hash12(gl_FragCoord.xy + fract(poisonParams.y) * 37.0);
  float T = 1.0;
  vec3 acc = vec3(0.0);
  float prevT = 0.0;
  for (int i = 1; i <= 64; i++) {
    if (i > steps) break;
    float f = (float(i) - 1.0 + jitter) / float(steps);
    float t = maxD * f * f;
    float dt = t - prevT;
    prevT = t;
    vec3 p = camPos + dir * t;
    vec2 uv = (p.xz + worldDims.xy) / worldDims.zw;
    vec4 info = texture2D(worldInfo, clamp(uv, 0.001, 0.999));
    float c = coverFrom(info.r, p.xz, uv);
    if (c < 0.01) continue;
    float ground = info.g * 700.0 - 20.0;
    float hAbove = p.y - ground;
    float top = 55.0 + 95.0 * c + 70.0 * loa_vnoise(p.xz * 0.003 + poisonParams.y * 0.008);
    float hk = clamp(hAbove / top, 0.0, 1.0);
    float hd = exp(-hk * 2.2) * (1.0 - smoothstep(0.75, 1.0, hk)) * smoothstep(-8.0, 1.0, hAbove);
    if (hd <= 0.001) continue;
    vec3 q = p * 0.012 + vec3(poisonParams.y * 0.04, -poisonParams.y * 0.015, poisonParams.y * 0.03);
    float nn = loa_fbm3(q);
    float billow = smoothstep(0.25, 0.75, nn + (1.0 - hk) * 0.25);
    float dens = c * hd * (0.15 + billow * 1.7) * 0.0055 * extra.y;
    float a = 1.0 - exp(-dens * dt);
    vec3 low = mix(vec3(0.30, 0.10, 0.40), vec3(0.22, 0.48, 0.12), smoothstep(0.4, 0.75, nn));
    vec3 high = mix(vec3(0.78, 0.66, 0.88), vec3(0.70, 0.86, 0.62), smoothstep(0.45, 0.8, nn));
    vec3 col = mix(low, high, smoothstep(0.1, 0.85, hk));
    col *= fogLight.rgb * (0.7 + 0.45 * hk);
    col += vec3(0.05, 0.14, 0.04) * fogLight.a;
    acc += T * a * col;
    T *= 1.0 - a;
    if (T < 0.02) break;
  }
  gl_FragColor = vec4(sceneCol.rgb * T + acc, sceneCol.a);
}`;

export interface SafeZone {
  id: string;
  x: number;
  z: number;
  r: number;
  strength: number;
}

/**
 * The poisonous cloud. It starts outside Andorra's real border and advances inward by distance from
 * the border, so that the whole country is consumed exactly 14 in-game days after it is released.
 */
export class PoisonCloudSystem {
  readonly DW = 704;
  readonly DH = 640;
  dist!: Float32Array; // signed border distance per cell (m), positive inside
  private quantiles!: Float32Array;
  maxInside = 2000;
  threshold = -150;
  texture: RawTexture | null = null;
  post: PostProcess | null = null;
  depth: DepthRenderer | null = null;
  safeZones: SafeZone[] = [];
  /** 0..1 coverage at the player */
  playerCover = 0;
  exposure = 0;
  immuneMinutes = 0;
  private motes: ParticleSystem | null = null;
  private frontMotes: ParticleSystem | null = null;
  private steps = 28;
  enabled = true;
  /** set true after Zorg dies: the cloud dissipates */
  cleansing = 0;

  constructor(private game: Game) {}

  /** Fraction of Andorra's area covered after `days` days (0..14). */
  static coverageFraction(days: number): number {
    const pts: [number, number][] = [[0, 0], [1, 0.03], [4, 0.2], [7, 0.45], [10, 0.7], [13, 0.93], [14, 1.0]];
    if (days <= 0) return 0;
    if (days >= 14) return 1;
    for (let i = 1; i < pts.length; i++) {
      if (days <= pts[i][0]) {
        const [d0, f0] = pts[i - 1], [d1, f1] = pts[i];
        return f0 + ((f1 - f0) * (days - d0)) / (d1 - d0);
      }
    }
    return 1;
  }

  init(): void {
    const g = this.game;
    const border = g.world.border;
    const n = border.length / 2;
    const DW = this.DW, DH = this.DH;
    this.dist = new Float32Array(DW * DH);
    const inside: number[] = [];
    for (let j = 0; j < DH; j++) {
      const z = ((j + 0.5) / DH) * WORLD.depth - WORLD.halfD;
      for (let i = 0; i < DW; i++) {
        const x = ((i + 0.5) / DW) * WORLD.width - WORLD.halfW;
        let d = Infinity;
        for (let k = 0; k < n; k++) {
          const k2 = (k + 1) % n;
          const s = distToSegment(x, z, border[k * 2], border[k * 2 + 1], border[k2 * 2], border[k2 * 2 + 1]);
          if (s < d) d = s;
        }
        const ins = g.world.isInsideAndorra(x, z);
        const sd = ins ? d : -d;
        this.dist[j * DW + i] = sd;
        if (ins) inside.push(sd);
      }
    }
    inside.sort((a, b) => a - b);
    this.maxInside = inside[inside.length - 1];
    this.quantiles = new Float32Array(inside);
    // world info texture: R = border distance, G = terrain height
    const data = new Uint8Array(DW * DH * 4);
    for (let j = 0; j < DH; j++)
      for (let i = 0; i < DW; i++) {
        const p = j * DW + i;
        const x = ((i + 0.5) / DW) * WORLD.width - WORLD.halfW, z = ((j + 0.5) / DH) * WORLD.depth - WORLD.halfD;
        data[p * 4] = Math.round(clamp01((this.dist[p] + 600) / 2600) * 255);
        data[p * 4 + 1] = Math.round(clamp01((g.terrain.getHeight(x, z) + 20) / 700) * 255);
        data[p * 4 + 2] = 0;
        data[p * 4 + 3] = 255;
      }
    this.texture = new RawTexture(data, DW, DH, Engine.TEXTUREFORMAT_RGBA, g.scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
    this.texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    WorldShaderGlobals.worldInfo = this.texture;
    this.setupPost();
    this.update(0);
  }

  onQualityChanged(): void {
    const q = this.game.settings.quality;
    this.steps = q === "high" ? 40 : q === "medium" ? 28 : 16;
  }

  private setupPost(): void {
    const g = this.game;
    const cam = g.camera.camera;
    this.onQualityChanged();
    this.depth = g.scene.enableDepthRenderer(cam, false, true, undefined, true);
    const pp = new PostProcess("poisonFog", "loaPoisonFog", ["invViewProj", "camPos", "camFwd", "poisonParams", "worldDims", "safeZones", "fogLight", "extra"], ["depthSampler", "worldInfo"], 1.0, cam);
    const inv = new Matrix();
    pp.onApply = (effect) => {
      const c: Camera = cam;
      c.getTransformationMatrix().invertToRef(inv);
      effect.setMatrix("invViewProj", inv);
      effect.setVector3("camPos", c.globalPosition);
      effect.setVector3("camFwd", c.getDirection(Vector3.Forward()));
      const G = WorldShaderGlobals;
      const on = this.enabled && !g.interiors.current ? 1 : 0;
      effect.setFloat4("poisonParams", G.threshold, G.time, G.edge, on);
      effect.setFloat4("worldDims", WORLD.halfW, WORLD.halfD, WORLD.width, WORLD.depth);
      effect.setFloatArray4("safeZones", G.safeZones);
      const day = g.env.daylight;
      const l = lerp(0.22, 1.05, day);
      effect.setFloat4("fogLight", l * 0.95, l, l * 1.05, 1 - day);
      effect.setFloat4("extra", this.steps, 1 - this.cleansing, 0, 0);
      effect.setTexture("depthSampler", this.depth!.getDepthMap());
      effect.setTexture("worldInfo", this.texture!);
    };
    this.post = pp;
  }

  /** Signed distance to the border (bilinear), positive inside. */
  borderDist(x: number, z: number): number {
    const fx = ((x + WORLD.halfW) / WORLD.width) * this.DW - 0.5;
    const fz = ((z + WORLD.halfD) / WORLD.depth) * this.DH - 0.5;
    const i = Math.max(0, Math.min(this.DW - 2, Math.floor(fx))), j = Math.max(0, Math.min(this.DH - 2, Math.floor(fz)));
    const u = clamp01(fx - i), v = clamp01(fz - j);
    const D = this.dist, W = this.DW;
    if (x < -WORLD.halfW || x > WORLD.halfW || z < -WORLD.halfD || z > WORLD.halfD) return -600;
    return D[j * W + i] * (1 - u) * (1 - v) + D[j * W + i + 1] * u * (1 - v) + D[(j + 1) * W + i] * (1 - u) * v + D[(j + 1) * W + i + 1] * u * v;
  }

  thresholdForDays(days: number): number {
    const f = PoisonCloudSystem.coverageFraction(days);
    if (f <= 0) return -150;
    if (f >= 1) return this.maxInside + 250;
    const q = this.quantiles;
    const idx = Math.min(q.length - 1, Math.floor(f * q.length));
    return q[idx];
  }

  /** 0..1 poison density at a ground position. */
  coverageAt(x: number, z: number): number {
    const bd = this.borderDist(x, z);
    let c = 1 - smoothstep(this.threshold - WorldShaderGlobals.edge, this.threshold + WorldShaderGlobals.edge, bd);
    for (const s of this.safeZones) {
      if (s.strength <= 0) continue;
      const d = Math.hypot(x - s.x, z - s.z);
      c *= 1 - s.strength * (1 - smoothstep(s.r * 0.75, s.r, d));
    }
    return c * (1 - this.cleansing);
  }

  /** Days until the cloud reaches (x,z) from now (0 if already covered). */
  daysUntilCovered(x: number, z: number): number {
    const bd = this.borderDist(x, z);
    const now = this.game.time.daysElapsed;
    if (bd < this.threshold) return 0;
    for (let d = Math.max(0, now); d <= 14; d += 0.05) if (this.thresholdForDays(d) >= bd) return d - now;
    return 14 - now;
  }

  setSafeZone(id: string, x: number, z: number, r: number, strength: number): void {
    let s = this.safeZones.find((q) => q.id === id);
    if (!s) {
      s = { id, x, z, r, strength };
      this.safeZones.push(s);
    }
    s.x = x;
    s.z = z;
    s.r = r;
    s.strength = strength;
  }
  removeSafeZone(id: string): void {
    this.safeZones = this.safeZones.filter((s) => s.id !== id);
  }

  update(dt: number): void {
    const g = this.game;
    const days = g.time.daysElapsed;
    this.threshold = this.thresholdForDays(days);
    const G = WorldShaderGlobals;
    G.threshold = this.threshold;
    G.enabled = this.cleansing >= 1 ? 0 : 1 - this.cleansing;
    // pack safe zones (strongest 8)
    G.safeZones.fill(0);
    const zones = [...this.safeZones].sort((a, b) => b.strength - a.strength).slice(0, 8);
    zones.forEach((s, k) => {
      G.safeZones[k * 4] = s.x;
      G.safeZones[k * 4 + 1] = s.z;
      G.safeZones[k * 4 + 2] = s.r;
      G.safeZones[k * 4 + 3] = s.strength;
    });
    if (!g.player || g.state === "title" || g.state === "loading") return;
    // ---- player exposure
    const p = g.player.position;
    const inside = !g.interiors.current;
    this.playerCover = inside ? this.coverageAt(p.x, p.z) : 0;
    const immune = this.immuneMinutes > 0;
    if (immune) this.immuneMinutes = Math.max(0, this.immuneMinutes - dt * g.time.gameMinutesPerSecond());
    const poisoned = this.playerCover > 0.35 && !immune && g.state === "playing";
    if (poisoned) {
      this.exposure += dt;
      let dps = 2.5 + Math.min(10, this.exposure * 0.22);
      dps *= this.playerCover;
      dps *= g.player.poisonResistance();
      g.player.takePoison(dps * dt);
    } else {
      this.exposure = Math.max(0, this.exposure - dt * 2);
    }
    g.ui.setPoison(poisoned ? clamp01(0.35 + this.playerCover * 0.4 + this.exposure * 0.02) : 0, poisoned, immune && this.playerCover > 0.35);
    g.audio.setPoisonLevel(poisoned ? clamp01(0.4 + this.exposure * 0.03) : 0);
    g.env.fogBoost = inside ? this.playerCover * 0.0035 : 0;
    g.env.poisonTint = inside ? this.playerCover : 0;
    // particles around the player
    if (!this.motes) {
      this.motes = g.fx.emitter(g.player.root as any, {
        rate: 0, color1: new Color4(0.55, 0.2, 0.7, 0.8), color2: new Color4(0.3, 0.8, 0.25, 0.7), colorDead: new Color4(0.2, 0.1, 0.2, 0),
        size: [0.15, 0.6], life: [1.5, 3], speed: [0.1, 0.5], box: 9, boxY: 2.5, capacity: 400, gravity: 0.2,
      });
      this.frontMotes = g.fx.emitter(g.player.root as any, {
        rate: 0, color1: new Color4(0.5, 0.25, 0.65, 0.35), color2: new Color4(0.35, 0.6, 0.3, 0.3), colorDead: new Color4(0.2, 0.1, 0.2, 0),
        size: [2, 6], life: [3, 6], speed: [0.1, 0.4], tex: "smoke", additive: false, box: 30, boxY: 3, capacity: 160,
      });
    }
    const near = inside ? clamp01(1 - (this.borderDist(p.x, p.z) - this.threshold) / 160) : 0;
    this.motes.emitRate = inside ? this.playerCover * 120 : 0;
    this.frontMotes!.emitRate = inside ? near * 18 * (1 - this.cleansing) : 0;
  }

  serialize() {
    return { immune: this.immuneMinutes, cleansing: this.cleansing };
  }
  deserialize(d: any) {
    if (!d) return;
    this.immuneMinutes = d.immune ?? 0;
    this.cleansing = d.cleansing ?? 0;
  }
}
