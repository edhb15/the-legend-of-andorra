import { Scene, Mesh, VertexData, StandardMaterial, Color3, RawTexture, Texture, Engine, Vector3 } from "@babylonjs/core";
import { WORLD } from "../config";
import { clamp, smoothstep } from "../core/MathUtil";
import { TerrainPlugin, WorldShaderGlobals } from "./MaterialPlugins";

const NX = WORLD.nx;
const NZ = WORLD.nz;
const CELL = WORLD.cell;
const CH = WORLD.chunkCells;
const LOD_STEPS = [1, 2, 4, 8, 16];

interface Chunk {
  cx: number;
  cz: number;
  centerX: number;
  centerZ: number;
  centerY: number;
  lods: (Mesh | null)[];
  active: number; // current LOD index or -1
}

/**
 * Heightfield terrain built from real elevation data. Provides exact height sampling (matching
 * the rendered triangles) for physics, plus chunked LOD meshes for rendering.
 */
export class TerrainManager {
  heights = new Float32Array(NX * NZ);
  minY = 0;
  maxY = 0;
  chunks: Chunk[] = [];
  material!: StandardMaterial;
  /** splat layers, full heightmap resolution (cells) */
  splatData = new Uint8Array((NX - 1) * (NZ - 1) * 4);
  splatTex: RawTexture | null = null;
  private visible = true;
  lodDistances = [520, 1100, 1900, 3200];
  shadowCasterHook: ((m: Mesh) => void) | null = null;

  constructor(private scene: Scene) {}

  setElevation(real: Float32Array): void {
    let mn = Infinity, mx = -Infinity;
    for (let p = 0; p < real.length; p++) {
      const y = (real[p] - WORLD.elevBase) * WORLD.vScale;
      this.heights[p] = y;
      if (y < mn) mn = y;
      if (y > mx) mx = y;
    }
    this.minY = mn;
    this.maxY = mx;
  }

  // ------------------------------------------------------------------ sampling
  inBounds(x: number, z: number): boolean {
    return x > -WORLD.halfW && x < WORLD.halfW && z > -WORLD.halfD && z < WORLD.halfD;
  }

  hAt(i: number, j: number): number {
    i = i < 0 ? 0 : i >= NX ? NX - 1 : i;
    j = j < 0 ? 0 : j >= NZ ? NZ - 1 : j;
    return this.heights[j * NX + i];
  }

  /** Exact height of the rendered (LOD0) surface. */
  getHeight(x: number, z: number): number {
    const gx = (x + WORLD.halfW) / CELL;
    const gz = (z + WORLD.halfD) / CELL;
    let i = Math.floor(gx), j = Math.floor(gz);
    if (i < 0) i = 0;
    if (j < 0) j = 0;
    if (i > NX - 2) i = NX - 2;
    if (j > NZ - 2) j = NZ - 2;
    const fx = clamp(gx - i, 0, 1), fz = clamp(gz - j, 0, 1);
    const H = this.heights;
    const a = H[j * NX + i], b = H[j * NX + i + 1], c = H[(j + 1) * NX + i], d = H[(j + 1) * NX + i + 1];
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  getNormal(x: number, z: number, out = new Vector3()): Vector3 {
    const e = CELL * 0.75;
    const hl = this.getHeight(x - e, z), hr = this.getHeight(x + e, z);
    const hd = this.getHeight(x, z - e), hu = this.getHeight(x, z + e);
    out.set(hl - hr, 2 * e, hd - hu);
    return out.normalize();
  }

  /** Slope in degrees. */
  getSlope(x: number, z: number): number {
    const n = this.getNormal(x, z, TMP_N);
    return (Math.acos(clamp(n.y, -1, 1)) * 180) / Math.PI;
  }

  /** Smoothed height (average over a radius), useful for placing large objects. */
  getAvgHeight(x: number, z: number, r: number): number {
    let s = 0, n = 0;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      s += this.getHeight(x + Math.cos(ang) * r, z + Math.sin(ang) * r);
      n++;
    }
    return (s + this.getHeight(x, z) * 2) / (n + 2);
  }

  // ------------------------------------------------------------------ modification
  /** Blend terrain toward targetY inside radius (full) with smooth falloff over `blend`. */
  flattenCircle(x: number, z: number, radius: number, blend: number, targetY: number, mode: "set" | "lower" | "raise" = "set"): void {
    const r2 = radius + blend;
    const i0 = Math.max(0, Math.floor((x - r2 + WORLD.halfW) / CELL));
    const i1 = Math.min(NX - 1, Math.ceil((x + r2 + WORLD.halfW) / CELL));
    const j0 = Math.max(0, Math.floor((z - r2 + WORLD.halfD) / CELL));
    const j1 = Math.min(NZ - 1, Math.ceil((z + r2 + WORLD.halfD) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const wx = i * CELL - WORLD.halfW, wz = j * CELL - WORLD.halfD;
        const d = Math.hypot(wx - x, wz - z);
        if (d > r2) continue;
        const t = d <= radius ? 1 : 1 - smoothstep(0, 1, (d - radius) / blend);
        const p = j * NX + i;
        const cur = this.heights[p];
        let target = targetY;
        if (mode === "lower") target = Math.min(cur, targetY);
        if (mode === "raise") target = Math.max(cur, targetY);
        this.heights[p] = cur + (target - cur) * t;
      }
    }
  }

  /** Flatten an oriented rectangle (building pad). */
  flattenRect(x: number, z: number, hw: number, hd: number, rot: number, blend: number, targetY: number): void {
    const r = Math.hypot(hw, hd) + blend;
    const c = Math.cos(rot), s = Math.sin(rot);
    const i0 = Math.max(0, Math.floor((x - r + WORLD.halfW) / CELL));
    const i1 = Math.min(NX - 1, Math.ceil((x + r + WORLD.halfW) / CELL));
    const j0 = Math.max(0, Math.floor((z - r + WORLD.halfD) / CELL));
    const j1 = Math.min(NZ - 1, Math.ceil((z + r + WORLD.halfD) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const wx = i * CELL - WORLD.halfW - x, wz = j * CELL - WORLD.halfD - z;
        // local coords (rotation about Y by rot: local x axis = (cos, -sin)?) use inverse rotation
        const lx = wx * c - wz * s;
        const lz = wx * s + wz * c;
        const dx = Math.max(0, Math.abs(lx) - hw), dz = Math.max(0, Math.abs(lz) - hd);
        const d = Math.hypot(dx, dz);
        if (d > blend) continue;
        const t = d <= 0 ? 1 : 1 - smoothstep(0, 1, d / blend);
        const p = j * NX + i;
        this.heights[p] += (targetY - this.heights[p]) * t;
      }
    }
  }

  /** Find a flat-ish spot near (x,z) suitable for a structure of the given radius. */
  findFlatSpot(x: number, z: number, search: number, footprint: number, step = 10): { x: number; z: number; y: number; slope: number } {
    let best = { x, z, y: this.getHeight(x, z), slope: 90 };
    let bestScore = Infinity;
    for (let dz = -search; dz <= search; dz += step) {
      for (let dx = -search; dx <= search; dx += step) {
        const d = Math.hypot(dx, dz);
        if (d > search) continue;
        const px = x + dx, pz = z + dz;
        if (!this.inBounds(px, pz)) continue;
        let mn = Infinity, mx = -Infinity;
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2;
          for (const rr of [footprint * 0.5, footprint]) {
            const h = this.getHeight(px + Math.cos(ang) * rr, pz + Math.sin(ang) * rr);
            mn = Math.min(mn, h);
            mx = Math.max(mx, h);
          }
        }
        const relief = mx - mn;
        const score = relief + d * 0.04;
        if (score < bestScore) {
          bestScore = score;
          best = { x: px, z: pz, y: this.getHeight(px, pz), slope: (Math.atan2(relief, footprint * 2) * 180) / Math.PI };
        }
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ splat layers
  /** layer: 0 forest, 1 wet, 2 cobble, 3 path dirt */
  paintSplat(layer: number, x: number, z: number, radius: number, value: number, soft = 0.5): void {
    const W = NX - 1, H = NZ - 1;
    const r = radius;
    const i0 = Math.max(0, Math.floor((x - r + WORLD.halfW) / CELL));
    const i1 = Math.min(W - 1, Math.ceil((x + r + WORLD.halfW) / CELL));
    const j0 = Math.max(0, Math.floor((z - r + WORLD.halfD) / CELL));
    const j1 = Math.min(H - 1, Math.ceil((z + r + WORLD.halfD) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const wx = (i + 0.5) * CELL - WORLD.halfW, wz = (j + 0.5) * CELL - WORLD.halfD;
        const d = Math.hypot(wx - x, wz - z) / r;
        if (d > 1) continue;
        const t = d < 1 - soft ? 1 : 1 - (d - (1 - soft)) / soft;
        const p = (j * W + i) * 4 + layer;
        this.splatData[p] = Math.max(this.splatData[p], Math.round(value * t * 255));
      }
    }
  }

  setSplatCell(layer: number, i: number, j: number, v: number): void {
    const W = NX - 1;
    if (i < 0 || j < 0 || i >= W || j >= NZ - 1) return;
    const p = (j * W + i) * 4 + layer;
    this.splatData[p] = Math.max(this.splatData[p], v);
  }

  uploadSplat(): void {
    const W = NX - 1, H = NZ - 1;
    if (this.splatTex) this.splatTex.dispose();
    this.splatTex = new RawTexture(this.splatData, W, H, Engine.TEXTUREFORMAT_RGBA, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    this.splatTex.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.splatTex.wrapV = Texture.CLAMP_ADDRESSMODE;
    WorldShaderGlobals.splat = this.splatTex;
  }

  // ------------------------------------------------------------------ meshes
  createMaterial(): void {
    const m = new StandardMaterial("terrainMat", this.scene);
    m.diffuseColor = new Color3(1, 1, 1);
    m.specularColor = new Color3(0.04, 0.04, 0.04);
    m.specularPower = 16;
    new TerrainPlugin(m);
    this.material = m;
  }

  buildChunks(): void {
    const ncx = (NX - 1) / CH, ncz = (NZ - 1) / CH;
    for (let cz = 0; cz < ncz; cz++) {
      for (let cx = 0; cx < ncx; cx++) {
        const ci = cx * CH + CH / 2, cj = cz * CH + CH / 2;
        this.chunks.push({
          cx,
          cz,
          centerX: ci * CELL - WORLD.halfW,
          centerZ: cj * CELL - WORLD.halfD,
          centerY: this.hAt(ci, cj),
          lods: new Array(LOD_STEPS.length).fill(null),
          active: -1,
        });
      }
    }
  }

  private buildChunkMesh(c: Chunk, lod: number): Mesh {
    const step = LOD_STEPS[lod];
    const n = CH / step + 1;
    const skirt = 4 * n; // skirt verts
    const positions = new Float32Array((n * n + skirt) * 3);
    const normals = new Float32Array((n * n + skirt) * 3);
    const i0 = c.cx * CH, j0 = c.cz * CH;
    const H = this.heights;
    const nrm = (i: number, j: number, o: number) => {
      const hl = this.hAt(i - 1, j), hr = this.hAt(i + 1, j), hd = this.hAt(i, j - 1), hu = this.hAt(i, j + 1);
      let nx = hl - hr, ny = 2 * CELL, nz = hd - hu;
      const l = Math.hypot(nx, ny, nz);
      normals[o] = nx / l;
      normals[o + 1] = ny / l;
      normals[o + 2] = nz / l;
    };
    let v = 0;
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < n; a++) {
        const i = i0 + a * step, j = j0 + b * step;
        positions[v * 3] = i * CELL - WORLD.halfW;
        positions[v * 3 + 1] = H[j * NX + i];
        positions[v * 3 + 2] = j * CELL - WORLD.halfD;
        nrm(i, j, v * 3);
        v++;
      }
    }
    const indices: number[] = [];
    for (let b = 0; b < n - 1; b++) {
      for (let a = 0; a < n - 1; a++) {
        const ia = b * n + a, ib = ia + 1, ic = ia + n, id = ic + 1;
        indices.push(ia, ib, ic, ib, id, ic);
      }
    }
    // Skirts: duplicate edge vertices pushed down to hide LOD cracks.
    const depth = 3 + step * 2.5;
    const edge = (list: number[]) => {
      const start = v;
      for (const e of list) {
        positions[v * 3] = positions[e * 3];
        positions[v * 3 + 1] = positions[e * 3 + 1] - depth;
        positions[v * 3 + 2] = positions[e * 3 + 2];
        normals[v * 3] = normals[e * 3];
        normals[v * 3 + 1] = normals[e * 3 + 1];
        normals[v * 3 + 2] = normals[e * 3 + 2];
        v++;
      }
      return start;
    };
    const south: number[] = [], north: number[] = [], west: number[] = [], east: number[] = [];
    for (let a = 0; a < n; a++) {
      south.push(a);
      north.push((n - 1) * n + a);
      west.push(a * n);
      east.push(a * n + n - 1);
    }
    const addSkirt = (list: number[], flip: boolean) => {
      const s = edge(list);
      for (let k = 0; k < list.length - 1; k++) {
        const t0 = list[k], t1 = list[k + 1], b0 = s + k, b1 = s + k + 1;
        if (flip) indices.push(t0, b1, t1, t0, b0, b1);
        else indices.push(t0, t1, b1, t0, b1, b0);
      }
    };
    addSkirt(south, true);
    addSkirt(north, false);
    addSkirt(west, false);
    addSkirt(east, true);

    const mesh = new Mesh(`terrain_${c.cx}_${c.cz}_L${lod}`, this.scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.indices = indices;
    vd.applyToMesh(mesh, false);
    mesh.material = this.material;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    mesh.doNotSyncBoundingInfo = true;
    mesh.freezeWorldMatrix();
    mesh.alwaysSelectAsActiveMesh = false;
    (mesh as any).loaTerrain = true;
    if (lod <= 1 && this.shadowCasterHook) this.shadowCasterHook(mesh);
    return mesh;
  }

  /** Rebuild every mesh that already exists (after terrain modifications). */
  disposeMeshes(): void {
    for (const c of this.chunks) {
      for (let l = 0; l < c.lods.length; l++) {
        c.lods[l]?.dispose();
        c.lods[l] = null;
      }
      c.active = -1;
    }
  }

  setVisible(v: boolean): void {
    this.visible = v;
    for (const c of this.chunks) {
      if (c.active >= 0 && c.lods[c.active]) c.lods[c.active]!.setEnabled(v);
    }
  }

  /** Select LODs for the current camera position. Builds meshes lazily. */
  update(camX: number, camY: number, camZ: number, budget = 4): void {
    if (!this.visible) return;
    let built = 0;
    for (const c of this.chunks) {
      const dx = Math.max(0, Math.abs(camX - c.centerX) - CH * CELL * 0.5);
      const dz = Math.max(0, Math.abs(camZ - c.centerZ) - CH * CELL * 0.5);
      const d = Math.hypot(dx, dz, (camY - c.centerY) * 0.3);
      let lod = LOD_STEPS.length - 1;
      for (let k = 0; k < this.lodDistances.length; k++) {
        if (d < this.lodDistances[k]) {
          lod = k;
          break;
        }
      }
      // hysteresis: keep current if close to threshold
      if (c.active >= 0 && Math.abs(lod - c.active) === 1) {
        const thr = this.lodDistances[Math.min(lod, c.active)];
        if (Math.abs(d - thr) < 40) lod = c.active;
      }
      if (lod === c.active) continue;
      if (!c.lods[lod]) {
        if (built >= budget && c.active >= 0) continue;
        c.lods[lod] = this.buildChunkMesh(c, lod);
        built++;
      }
      if (c.active >= 0 && c.lods[c.active]) c.lods[c.active]!.setEnabled(false);
      c.lods[lod]!.setEnabled(true);
      c.active = lod;
    }
  }

  allActiveMeshes(): Mesh[] {
    const out: Mesh[] = [];
    for (const c of this.chunks) if (c.active >= 0 && c.lods[c.active]) out.push(c.lods[c.active]!);
    return out;
  }
}

const TMP_N = new Vector3();
