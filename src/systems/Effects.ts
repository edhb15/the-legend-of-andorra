import {
  Scene, ParticleSystem, DynamicTexture, Texture, Vector3, Color4, Color3, Mesh, MeshBuilder, StandardMaterial,
  PointLight, VertexData, AbstractMesh, TransformNode,
} from "@babylonjs/core";
import type { Game } from "../core/Game";
import { clamp01, lerp } from "../core/MathUtil";

type Updater = (dt: number) => boolean; // return false to remove

/** Visual effects helpers: particles, flashes, ground telegraphs, light pulses. */
export class Effects {
  softTex: Texture;
  sparkTex: Texture;
  smokeTex: Texture;
  starTex: Texture;
  private updaters: Updater[] = [];
  private lights: { l: PointLight; t: number; dur: number; i0: number }[] = [];
  private decalMats = new Map<string, StandardMaterial>();

  constructor(private game: Game, private scene: Scene) {
    this.softTex = this.makeTex("soft", (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.35, "rgba(255,255,255,0.6)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
    this.sparkTex = this.makeTex("spark", (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.15, "rgba(255,255,255,0.9)");
      g.addColorStop(0.4, "rgba(255,255,255,0.15)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
    this.smokeTex = this.makeTex("smoke", (ctx, s) => {
      for (let k = 0; k < 18; k++) {
        const x = s / 2 + (Math.random() - 0.5) * s * 0.4, y = s / 2 + (Math.random() - 0.5) * s * 0.4;
        const r = s * (0.15 + Math.random() * 0.2);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(255,255,255,0.35)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      }
    });
    this.starTex = this.makeTex("star", (ctx, s) => {
      ctx.translate(s / 2, s / 2);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      for (let k = 0; k < 4; k++) {
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-s / 2, -s * 0.03, s, s * 0.06);
      }
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private makeTex(name: string, draw: (ctx: CanvasRenderingContext2D, s: number) => void): Texture {
    const s = 64;
    const dt = new DynamicTexture("fx_" + name, { width: s, height: s }, this.scene, true);
    const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, s, s);
    draw(ctx, s);
    dt.update();
    dt.hasAlpha = true;
    return dt;
  }

  /** One-shot particle burst. */
  burst(pos: Vector3, opts: {
    count?: number; color1?: Color4; color2?: Color4; colorDead?: Color4; size?: [number, number]; life?: [number, number];
    speed?: [number, number]; gravity?: number; tex?: "soft" | "spark" | "smoke" | "star"; additive?: boolean; spread?: number; dir?: Vector3; radius?: number;
  } = {}): void {
    const count = opts.count ?? 30;
    const ps = new ParticleSystem("burst", count, this.scene);
    ps.particleTexture = opts.tex === "spark" ? this.sparkTex : opts.tex === "smoke" ? this.smokeTex : opts.tex === "star" ? this.starTex : this.softTex;
    ps.emitter = pos.clone();
    const r = opts.radius ?? 0.2;
    ps.minEmitBox = new Vector3(-r, -r, -r);
    ps.maxEmitBox = new Vector3(r, r, r);
    ps.color1 = opts.color1 ?? new Color4(1, 0.9, 0.6, 1);
    ps.color2 = opts.color2 ?? new Color4(1, 0.6, 0.2, 1);
    ps.colorDead = opts.colorDead ?? new Color4(0, 0, 0, 0);
    ps.minSize = opts.size?.[0] ?? 0.1;
    ps.maxSize = opts.size?.[1] ?? 0.4;
    ps.minLifeTime = opts.life?.[0] ?? 0.3;
    ps.maxLifeTime = opts.life?.[1] ?? 0.8;
    ps.minEmitPower = opts.speed?.[0] ?? 2;
    ps.maxEmitPower = opts.speed?.[1] ?? 6;
    const sp = opts.spread ?? 1;
    const d = opts.dir ?? new Vector3(0, 1, 0);
    ps.direction1 = new Vector3(d.x - sp, d.y - sp * 0.3, d.z - sp);
    ps.direction2 = new Vector3(d.x + sp, d.y + sp, d.z + sp);
    ps.gravity = new Vector3(0, opts.gravity ?? -6, 0);
    ps.blendMode = opts.additive === false ? ParticleSystem.BLENDMODE_STANDARD : ParticleSystem.BLENDMODE_ADD;
    ps.manualEmitCount = count;
    ps.minAngularSpeed = -3;
    ps.maxAngularSpeed = 3;
    ps.targetStopDuration = (opts.life?.[1] ?? 0.8) + 0.1;
    ps.disposeOnStop = true;
    ps.start();
  }

  /** Long-running emitter attached to a node or position. Returns the system (call stop()). */
  emitter(target: AbstractMesh | TransformNode | Vector3, opts: {
    rate?: number; color1?: Color4; color2?: Color4; colorDead?: Color4; size?: [number, number]; life?: [number, number];
    speed?: [number, number]; gravity?: number; tex?: "soft" | "spark" | "smoke" | "star"; additive?: boolean; box?: number; dir?: [Vector3, Vector3]; capacity?: number; boxY?: number;
  }): ParticleSystem {
    const ps = new ParticleSystem("emit", opts.capacity ?? 300, this.scene);
    ps.particleTexture = opts.tex === "spark" ? this.sparkTex : opts.tex === "smoke" ? this.smokeTex : opts.tex === "star" ? this.starTex : this.softTex;
    ps.emitter = target instanceof Vector3 ? target : (target as AbstractMesh);
    const b = opts.box ?? 0.3;
    const by = opts.boxY ?? b;
    ps.minEmitBox = new Vector3(-b, -by, -b);
    ps.maxEmitBox = new Vector3(b, by, b);
    ps.color1 = opts.color1 ?? new Color4(1, 1, 1, 1);
    ps.color2 = opts.color2 ?? new Color4(1, 1, 1, 0.6);
    ps.colorDead = opts.colorDead ?? new Color4(0, 0, 0, 0);
    ps.minSize = opts.size?.[0] ?? 0.1;
    ps.maxSize = opts.size?.[1] ?? 0.3;
    ps.minLifeTime = opts.life?.[0] ?? 0.5;
    ps.maxLifeTime = opts.life?.[1] ?? 1.2;
    ps.emitRate = opts.rate ?? 40;
    ps.minEmitPower = opts.speed?.[0] ?? 0.2;
    ps.maxEmitPower = opts.speed?.[1] ?? 1;
    ps.direction1 = opts.dir?.[0] ?? new Vector3(-0.3, 1, -0.3);
    ps.direction2 = opts.dir?.[1] ?? new Vector3(0.3, 1, 0.3);
    ps.gravity = new Vector3(0, opts.gravity ?? 0, 0);
    ps.blendMode = opts.additive === false ? ParticleSystem.BLENDMODE_STANDARD : ParticleSystem.BLENDMODE_ADD;
    ps.minAngularSpeed = -1;
    ps.maxAngularSpeed = 1;
    ps.start();
    return ps;
  }

  hitSpark(pos: Vector3, color = new Color4(1, 0.85, 0.5, 1), big = false): void {
    this.burst(pos, { count: big ? 40 : 18, color1: color, color2: new Color4(1, 1, 1, 1), tex: "spark", size: [0.05, big ? 0.35 : 0.2], life: [0.15, 0.4], speed: [3, big ? 12 : 7], gravity: -12, spread: 1.2 });
  }

  /** Dark smoke puff used when monsters die. */
  deathPuff(pos: Vector3, scale = 1, color = new Color4(0.15, 0.05, 0.2, 0.9)): void {
    this.burst(pos, { count: Math.round(40 * scale), color1: color, color2: new Color4(0.35, 0.1, 0.45, 0.7), tex: "smoke", size: [0.5 * scale, 1.6 * scale], life: [0.6, 1.4], speed: [0.5, 2.5 * scale], gravity: 1.5, additive: false, radius: 0.5 * scale });
    this.burst(pos, { count: Math.round(25 * scale), color1: new Color4(0.9, 0.4, 1, 1), color2: new Color4(1, 0.8, 1, 1), tex: "spark", size: [0.05, 0.2], life: [0.4, 1], speed: [2, 6 * scale], gravity: 2, radius: 0.4 * scale });
  }

  flashLight(pos: Vector3, color: Color3, intensity = 3, range = 15, dur = 0.4): void {
    const l = new PointLight("flash", pos.clone(), this.scene);
    l.diffuse = color;
    l.specular = color;
    l.intensity = intensity;
    l.range = range;
    this.lights.push({ l, t: 0, dur, i0: intensity });
  }

  /** Builds a mesh hugging the ground (terrain or cave floor). shape: disc | ring | cone(angle) | rect */
  groundDecal(x: number, z: number, opts: { radius: number; color: string; shape?: "disc" | "ring" | "cone" | "rect"; angle?: number; yaw?: number; inner?: number; alpha?: number; width?: number; length?: number }): Mesh {
    const shape = opts.shape ?? "disc";
    const seg = 28;
    const rings = 6;
    const positions: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];
    const phys = this.game.physics;
    const yaw = opts.yaw ?? 0;
    const pushV = (lx: number, lz: number, u: number, v: number) => {
      // rotate by yaw
      const wx = x + lx * Math.cos(yaw) + lz * Math.sin(yaw);
      const wz = z - lx * Math.sin(yaw) + lz * Math.cos(yaw);
      positions.push(wx, phys.groundHeight(wx, wz, 1e5) + 0.18, wz);
      uvs.push(u, v);
    };
    if (shape === "rect") {
      const w = opts.width ?? 3, L = opts.length ?? opts.radius;
      const nx = 3, nz = Math.max(2, Math.ceil(L / 2));
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) pushV((i / nx - 0.5) * w, (j / nz) * L, i / nx, j / nz);
      for (let j = 0; j < nz; j++)
        for (let i = 0; i < nx; i++) {
          const a = j * (nx + 1) + i;
          indices.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
        }
    } else {
      const a0 = shape === "cone" ? -(opts.angle ?? 0.6) : 0;
      const a1 = shape === "cone" ? opts.angle ?? 0.6 : Math.PI * 2;
      const r0 = shape === "ring" ? opts.inner ?? opts.radius * 0.8 : 0;
      for (let r = 0; r <= rings; r++) {
        const rr = lerp(r0, opts.radius, r / rings);
        for (let s = 0; s <= seg; s++) {
          const a = lerp(a0, a1, s / seg);
          pushV(Math.sin(a) * rr, Math.cos(a) * rr, s / seg, r / rings);
        }
      }
      for (let r = 0; r < rings; r++)
        for (let s = 0; s < seg; s++) {
          const a = r * (seg + 1) + s;
          indices.push(a, a + seg + 1, a + 1, a + 1, a + seg + 1, a + seg + 2);
        }
    }
    const m = new Mesh("decal", this.scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.uvs = uvs;
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    vd.normals = normals;
    vd.applyToMesh(m);
    let mat = this.decalMats.get(opts.color + (opts.alpha ?? 0.5));
    if (!mat) {
      mat = new StandardMaterial("decalMat", this.scene);
      const c = Color3.FromHexString(opts.color);
      mat.diffuseColor = c;
      mat.emissiveColor = c;
      mat.specularColor = Color3.Black();
      mat.alpha = opts.alpha ?? 0.5;
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mat.zOffset = -4;
      this.decalMats.set(opts.color + (opts.alpha ?? 0.5), mat);
    }
    m.material = mat;
    m.isPickable = false;
    return m;
  }

  /** Pulsing telegraph that fills over `delay` seconds then calls back and disappears. */
  telegraph(x: number, z: number, opts: { radius: number; delay: number; color?: string; shape?: "disc" | "cone" | "ring" | "rect"; angle?: number; yaw?: number; inner?: number; width?: number; length?: number }, onDone?: () => void): void {
    const outer = this.groundDecal(x, z, { ...opts, color: opts.color ?? "#ff3322", alpha: 0.22 });
    const inner = this.groundDecal(x, z, { ...opts, color: opts.color ?? "#ff3322", alpha: 0.45 });
    inner.scaling.set(0.01, 1, 0.01);
    const cx = x, cz = z;
    // scale about the centre: decal vertices are in world space, so use pivot
    inner.setPivotPoint(new Vector3(cx, inner.getBoundingInfo().boundingBox.center.y, cz));
    let t = 0;
    this.updaters.push((dt) => {
      t += dt;
      const k = clamp01(t / opts.delay);
      inner.scaling.set(Math.max(0.01, k), 1, Math.max(0.01, k));
      outer.visibility = 0.7 + 0.3 * Math.sin(t * 20);
      if (t >= opts.delay) {
        outer.dispose();
        inner.dispose();
        onDone?.();
        return false;
      }
      return true;
    });
  }

  /** Generic per-frame callback with lifetime. */
  addUpdater(fn: Updater): void {
    this.updaters.push(fn);
  }

  /** Spawn a temporary mesh animated by fn(t01, mesh); disposed afterwards. */
  animateMesh(mesh: Mesh, dur: number, fn: (k: number, m: Mesh) => void, dispose = true): void {
    let t = 0;
    this.updaters.push((dt) => {
      t += dt;
      const k = clamp01(t / dur);
      fn(k, mesh);
      if (k >= 1) {
        if (dispose) mesh.dispose();
        return false;
      }
      return true;
    });
  }

  shockRing(x: number, y: number, z: number, color: string, maxR: number, dur: number): void {
    const ring = MeshBuilder.CreateTorus("shock", { diameter: 2, thickness: 0.25, tessellation: 40 }, this.scene);
    ring.position.set(x, y + 0.4, z);
    const mat = new StandardMaterial("shockMat", this.scene);
    const c = Color3.FromHexString(color);
    mat.emissiveColor = c;
    mat.diffuseColor = c;
    mat.disableLighting = true;
    mat.alpha = 0.8;
    ring.material = mat;
    this.animateMesh(ring, dur, (k, m) => {
      const r = 0.5 + maxR * k;
      m.scaling.set(r, 1 + k * 2, r);
      mat.alpha = 0.8 * (1 - k);
    });
  }

  update(dt: number): void {
    for (let i = this.updaters.length - 1; i >= 0; i--) {
      let keep = false;
      try {
        keep = this.updaters[i](dt);
      } catch (e) {
        console.error(e);
      }
      if (!keep) this.updaters.splice(i, 1);
    }
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const f = this.lights[i];
      f.t += dt;
      const k = f.t / f.dur;
      f.l.intensity = f.i0 * Math.max(0, 1 - k);
      if (k >= 1) {
        f.l.dispose();
        this.lights.splice(i, 1);
      }
    }
  }
}
