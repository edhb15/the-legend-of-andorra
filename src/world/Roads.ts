import { Scene, Mesh, VertexData, StandardMaterial, Color3 } from "@babylonjs/core";
import { WORLD } from "../config";
import type { TerrainManager } from "./TerrainManager";
import type { Hydrology } from "./Hydrology";
import { PoisonTintPlugin } from "./MaterialPlugins";

const G = 10; // grid cell size (m)
const GW = Math.floor(WORLD.width / G);
const GH = Math.floor(WORLD.depth / G);

export interface RoadPoint {
  x: number;
  z: number;
  y: number;
  river: boolean;
}

export interface Road {
  pts: RoadPoint[];
  width: number;
  kind: "road" | "trail";
}

/** A* pathfinding over the terrain to lay realistic valley roads and mountain trails. */
export class RoadPlanner {
  blocked = new Uint8Array(GW * GH);
  roadCost = new Float32Array(GW * GH); // existing roads are cheaper
  insideBorder: ((x: number, z: number) => boolean) | null = null;

  private hGrid = new Float32Array(GW * GH);
  private riverGrid = new Float32Array(GW * GH);
  private lakeGrid = new Uint8Array(GW * GH);
  private insideGrid = new Uint8Array(GW * GH).fill(1);

  constructor(private terrain: TerrainManager, private hydro: Hydrology) {}

  /** Cache heights / water distances on the coarse grid (call after hydrology). */
  prepare(): void {
    for (let j = 0; j < GH; j++)
      for (let i = 0; i < GW; i++) {
        const x = i * G - WORLD.halfW + G / 2, z = j * G - WORLD.halfD + G / 2;
        const p = j * GW + i;
        this.hGrid[p] = this.terrain.getHeight(x, z);
        this.lakeGrid[p] = this.hydro.isLake(x, z) ? 1 : 0;
        if (this.insideBorder) this.insideGrid[p] = this.insideBorder(x, z) ? 1 : 0;
        this.riverGrid[p] = 99;
      }
    for (const r of this.hydro.rivers) {
      for (const q of r.pts) {
        const rad = q.w * 0.5 + 10;
        const i0 = Math.floor((q.x - rad + WORLD.halfW) / G), i1 = Math.ceil((q.x + rad + WORLD.halfW) / G);
        const j0 = Math.floor((q.z - rad + WORLD.halfD) / G), j1 = Math.ceil((q.z + rad + WORLD.halfD) / G);
        for (let j = Math.max(0, j0); j <= Math.min(GH - 1, j1); j++)
          for (let i = Math.max(0, i0); i <= Math.min(GW - 1, i1); i++) {
            const x = i * G - WORLD.halfW + G / 2, z = j * G - WORLD.halfD + G / 2;
            const d = Math.hypot(x - q.x, z - q.z) - q.w * 0.5;
            const p = j * GW + i;
            if (d < this.riverGrid[p]) this.riverGrid[p] = d;
          }
      }
    }
  }

  private h(i: number, j: number): number {
    return this.hGrid[j * GW + i];
  }

  blockCircle(x: number, z: number, r: number): void {
    const i0 = Math.floor((x - r + WORLD.halfW) / G), i1 = Math.ceil((x + r + WORLD.halfW) / G);
    const j0 = Math.floor((z - r + WORLD.halfD) / G), j1 = Math.ceil((z + r + WORLD.halfD) / G);
    for (let j = Math.max(0, j0); j <= Math.min(GH - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(GW - 1, i1); i++) {
        const cx = i * G - WORLD.halfW + G / 2, cz = j * G - WORLD.halfD + G / 2;
        if (Math.hypot(cx - x, cz - z) <= r) this.blocked[j * GW + i] = 1;
      }
  }
  unblockCircle(x: number, z: number, r: number): void {
    const i0 = Math.floor((x - r + WORLD.halfW) / G), i1 = Math.ceil((x + r + WORLD.halfW) / G);
    const j0 = Math.floor((z - r + WORLD.halfD) / G), j1 = Math.ceil((z + r + WORLD.halfD) / G);
    for (let j = Math.max(0, j0); j <= Math.min(GH - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(GW - 1, i1); i++) {
        const cx = i * G - WORLD.halfW + G / 2, cz = j * G - WORLD.halfD + G / 2;
        if (Math.hypot(cx - x, cz - z) <= r) this.blocked[j * GW + i] = 0;
      }
  }

  findPath(ax: number, az: number, bx: number, bz: number, trail: boolean): { x: number; z: number }[] | null {
    const si = Math.round((ax + WORLD.halfW) / G - 0.5), sj = Math.round((az + WORLD.halfD) / G - 0.5);
    const ti = Math.round((bx + WORLD.halfW) / G - 0.5), tj = Math.round((bz + WORLD.halfD) / G - 0.5);
    const N = GW * GH;
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    // binary heap
    const hk: number[] = [], hv: number[] = [];
    const push = (k: number, v: number) => {
      hk.push(k);
      hv.push(v);
      let i = hk.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hk[p] <= hk[i]) break;
        [hk[p], hk[i]] = [hk[i], hk[p]];
        [hv[p], hv[i]] = [hv[i], hv[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = hv[0];
      const lk = hk.pop()!, lv = hv.pop()!;
      if (hk.length) {
        hk[0] = lk;
        hv[0] = lv;
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= hk.length) break;
          if (c + 1 < hk.length && hk[c + 1] < hk[c]) c++;
          if (hk[c] >= hk[i]) break;
          [hk[c], hk[i]] = [hk[i], hk[c]];
          [hv[c], hv[i]] = [hv[i], hv[c]];
          i = c;
        }
      }
      return top;
    };
    const s = sj * GW + si, t = tj * GW + ti;
    g[s] = 0;
    push(0, s);
    const DI = [1, -1, 0, 0, 1, 1, -1, -1];
    const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    let iter = 0;
    while (hk.length && iter++ < 400000) {
      const c = pop();
      if (c === t) break;
      if (closed[c]) continue;
      closed[c] = 1;
      const ci = c % GW, cj = (c / GW) | 0;
      const hc = this.h(ci, cj);
      for (let k = 0; k < 8; k++) {
        const ni = ci + DI[k], nj = cj + DJ[k];
        if (ni < 1 || nj < 1 || ni >= GW - 1 || nj >= GH - 1) continue;
        const n = nj * GW + ni;
        if (closed[n]) continue;
        if (this.blocked[n] && n !== t) continue;
        const dist = k < 4 ? G : G * 1.4142;
        const hn = this.h(ni, nj);
        const grade = Math.abs(hn - hc) / dist;
        const wx = ni * G - WORLD.halfW + G / 2, wz = nj * G - WORLD.halfD + G / 2;
        let cost = dist * (1 + grade * grade * (trail ? 25 : 60) + (grade > (trail ? 0.75 : 0.45) ? 40 : 0));
        if (this.lakeGrid[n]) cost += 2000;
        const rd = this.riverGrid[n];
        if (rd < 2) cost += trail ? 60 : 140; // crossing = bridge, discourage
        else if (rd < 8) cost += 8;
        if (!this.insideGrid[n]) cost += dist * 1.5;
        cost *= this.roadCost[n] > 0 ? 0.55 : 1;
        const ng = g[c] + cost;
        if (ng < g[n]) {
          g[n] = ng;
          came[n] = c;
          const hx = (ti - ni) * G, hz = (tj - nj) * G;
          push(ng + Math.hypot(hx, hz) * 1.0, n);
        }
      }
    }
    if (came[t] < 0 && t !== s) return null;
    const cells: number[] = [];
    let c = t;
    while (c >= 0 && c !== s) {
      cells.push(c);
      c = came[c];
    }
    cells.push(s);
    cells.reverse();
    for (const cc of cells) this.roadCost[cc] = 1;
    let pts = cells.map((cc) => ({ x: (cc % GW) * G - WORLD.halfW + G / 2, z: ((cc / GW) | 0) * G - WORLD.halfD + G / 2 }));
    pts[0] = { x: ax, z: az };
    pts[pts.length - 1] = { x: bx, z: bz };
    // Chaikin smoothing
    for (let it = 0; it < 3; it++) {
      const out = [pts[0]];
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k], b = pts[k + 1];
        out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    // resample every 2.5 m
    const res: { x: number; z: number }[] = [pts[0]];
    let acc = 0;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      let d = 2.5 - acc;
      while (d <= L) {
        const u = d / L;
        res.push({ x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u });
        d += 2.5;
      }
      acc = L - (d - 2.5);
    }
    res.push(pts[pts.length - 1]);
    return res;
  }

  /** Smooth heights along the path and cut a road bed into the terrain. */
  layRoad(path: { x: number; z: number }[], width: number, kind: "road" | "trail"): Road {
    const t = this.terrain;
    const raw = path.map((p) => t.getHeight(p.x, p.z));
    const river = path.map((p) => this.hydro.riverDistance(p.x, p.z) < 2.5 || this.hydro.isLake(p.x, p.z));
    const sm = raw.map((_, k) => {
      let s = 0, n = 0;
      for (let q = -4; q <= 4; q++) {
        const i = Math.max(0, Math.min(raw.length - 1, k + q));
        if (river[i]) continue;
        s += raw[i];
        n++;
      }
      return n ? s / n : raw[k];
    });
    path.forEach((p, k) => {
      if (river[k]) return;
      t.flattenCircle(p.x, p.z, width * 0.55, 3.0, sm[k]);
      t.paintSplat(3, p.x, p.z, width * 0.5 + 1.8, kind === "road" ? 0.95 : 0.7, 0.55);
    });
    return { pts: path.map((p, k) => ({ x: p.x, z: p.z, y: sm[k], river: river[k] })), width, kind };
  }
}

/** Ribbon meshes for roads (drawn slightly above the terrain). */
export function buildRoadMeshes(scene: Scene, roads: Road[], terrain: TerrainManager): Mesh[] {
  const mat = new StandardMaterial("roadMat", scene);
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0.02, 0.02, 0.02);
  mat.zOffset = -2;
  new PoisonTintPlugin(mat);
  const out: Mesh[] = [];
  for (const r of roads) {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const across = 4;
    let rows = 0;
    for (let k = 0; k < r.pts.length; k++) {
      const p = r.pts[k];
      if (p.river) {
        rows = 0;
        continue;
      }
      const a = r.pts[Math.max(0, k - 1)], b = r.pts[Math.min(r.pts.length - 1, k + 1)];
      let dx = b.x - a.x, dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const nx = -dz, nz = dx;
      const base = positions.length / 3;
      for (let q = 0; q <= across; q++) {
        const u = q / across - 0.5;
        const x = p.x + nx * u * r.width, z = p.z + nz * u * r.width;
        positions.push(x, terrain.getHeight(x, z) + 0.06, z);
        const edge = Math.abs(u) * 2;
        const n = 0.85 + ((k * 7 + q * 13) % 10) / 50;
        const c = r.kind === "road" ? [0.46 * n, 0.38 * n, 0.27 * n] : [0.42 * n, 0.35 * n, 0.24 * n];
        colors.push(c[0] * (1 - edge * 0.15), c[1] * (1 - edge * 0.12), c[2] * (1 - edge * 0.1), 1);
      }
      if (rows > 0) {
        const prev = base - (across + 1);
        for (let q = 0; q < across; q++) indices.push(prev + q, base + q, prev + q + 1, prev + q + 1, base + q, base + q + 1);
      }
      rows++;
    }
    if (!indices.length) continue;
    const m = new Mesh("road", scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.colors = colors;
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    vd.normals = normals;
    vd.applyToMesh(m);
    m.material = mat;
    m.isPickable = false;
    m.receiveShadows = true;
    m.freezeWorldMatrix();
    out.push(m);
  }
  return out;
}
