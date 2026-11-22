import { WORLD } from "../config";
import { TerrainManager } from "./TerrainManager";

export interface RiverPoint {
  x: number;
  z: number;
  y: number; // water surface
  w: number; // width
}
export interface River {
  pts: RiverPoint[];
  flow: number;
}
export interface Lake {
  x: number;
  z: number;
  radius: number;
  level: number;
  cells: Int32Array; // full-res vertex indices inside the lake
  minI: number;
  maxI: number;
  minJ: number;
  maxJ: number;
}

const NX = WORLD.nx, NZ = WORLD.nz, CELL = WORLD.cell;

/** Min-heap keyed by float priority. */
class Heap {
  private keys: Float64Array;
  private vals: Int32Array;
  size = 0;
  constructor(cap: number) {
    this.keys = new Float64Array(cap);
    this.vals = new Int32Array(cap);
  }
  push(k: number, v: number) {
    let i = this.size++;
    const K = this.keys, V = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= k) break;
      K[i] = K[p];
      V[i] = V[p];
      i = p;
    }
    K[i] = k;
    V[i] = v;
  }
  pop(): number {
    const K = this.keys, V = this.vals;
    const top = V[0];
    const k = K[--this.size], v = V[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && K[c + 1] < K[c]) c++;
      if (K[c] >= k) break;
      K[i] = K[c];
      V[i] = V[c];
      i = c;
    }
    K[i] = k;
    V[i] = v;
    return top;
  }
}

export class Hydrology {
  rivers: River[] = [];
  lakes: Lake[] = [];
  /** full-res mask: 1 = lake water */
  lakeMask = new Uint8Array(NX * NZ);
  private lakeLevel = new Float32Array(0);
  private lakeIndex = new Int16Array(NX * NZ).fill(-1);
  private riverHash = new Map<number, RiverPoint[]>();

  constructor(private terrain: TerrainManager) {}

  /** Must be called on raw real-elevation data (before vertical scaling) for lake detection. */
  detectLakes(real: Float32Array): void {
    const flat = new Uint8Array(NX * NZ);
    for (let j = 1; j < NZ - 1; j++) {
      for (let i = 1; i < NX - 1; i++) {
        const p = j * NX + i;
        if (real[p] < 1500) continue;
        let mn = Infinity, mx = -Infinity;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const h = real[p + dj * NX + di];
            if (h < mn) mn = h;
            if (h > mx) mx = h;
          }
        if (mx - mn < 0.8) flat[p] = 1;
      }
    }
    const seen = new Uint8Array(NX * NZ);
    const stack: number[] = [];
    for (let p = 0; p < NX * NZ; p++) {
      if (!flat[p] || seen[p]) continue;
      const cells: number[] = [];
      stack.push(p);
      seen[p] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        cells.push(c);
        const ci = c % NX, cj = (c / NX) | 0;
        const nb = [ci > 0 ? c - 1 : -1, ci < NX - 1 ? c + 1 : -1, cj > 0 ? c - NX : -1, cj < NZ - 1 ? c + NX : -1];
        for (const n of nb) if (n >= 0 && flat[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
      if (cells.length < 8 || cells.length > 4000) continue;
      // dilate by one cell to cover the lake edge
      const set = new Set(cells);
      for (const c of cells) {
        for (const d of [-1, 1, -NX, NX, -NX - 1, -NX + 1, NX - 1, NX + 1]) set.add(c + d);
      }
      const arr = Int32Array.from(set);
      let sx = 0, sz = 0, sh = 0, minI = NX, maxI = 0, minJ = NZ, maxJ = 0;
      for (const c of cells) {
        const i = c % NX, j = (c / NX) | 0;
        sx += i;
        sz += j;
        sh += real[c];
      }
      for (const c of arr) {
        const i = c % NX, j = (c / NX) | 0;
        minI = Math.min(minI, i);
        maxI = Math.max(maxI, i);
        minJ = Math.min(minJ, j);
        maxJ = Math.max(maxJ, j);
      }
      const n = cells.length;
      const levelReal = sh / n;
      this.lakes.push({
        x: (sx / n) * CELL - WORLD.halfW,
        z: (sz / n) * CELL - WORLD.halfD,
        radius: Math.sqrt(n / Math.PI) * CELL,
        level: (levelReal - WORLD.elevBase) * WORLD.vScale + 0.35,
        cells: arr,
        minI,
        maxI,
        minJ,
        maxJ,
      });
    }
    this.lakeLevel = new Float32Array(this.lakes.length);
    this.lakes.forEach((l, k) => {
      this.lakeLevel[k] = l.level;
      for (const c of l.cells) {
        this.lakeMask[c] = 1;
        this.lakeIndex[c] = k;
      }
    });
  }

  /** Carve lake beds (after vertical scaling). */
  carveLakes(): void {
    const H = this.terrain.heights;
    for (const l of this.lakes) {
      for (const c of l.cells) {
        const target = l.level - 1.6;
        if (H[c] > target - 0.0 && H[c] < l.level + 1.2) H[c] = Math.min(H[c], target);
      }
    }
  }

  computeRivers(): void {
    // Half-resolution grid.
    const W = (NX + 1) >> 1, Hh = (NZ + 1) >> 1;
    const N = W * Hh;
    const h = new Float32Array(N);
    const H = this.terrain.heights;
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) h[j * W + i] = H[Math.min(NZ - 1, j * 2) * NX + Math.min(NX - 1, i * 2)];

    // Priority-flood depression filling.
    const filled = new Float32Array(N);
    const closed = new Uint8Array(N);
    const heap = new Heap(N);
    for (let i = 0; i < W; i++) {
      for (const j of [0, Hh - 1]) {
        const p = j * W + i;
        if (!closed[p]) {
          closed[p] = 1;
          filled[p] = h[p];
          heap.push(h[p], p);
        }
      }
    }
    for (let j = 0; j < Hh; j++) {
      for (const i of [0, W - 1]) {
        const p = j * W + i;
        if (!closed[p]) {
          closed[p] = 1;
          filled[p] = h[p];
          heap.push(h[p], p);
        }
      }
    }
    const DI = [1, -1, 0, 0, 1, 1, -1, -1];
    const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    while (heap.size) {
      const c = heap.pop();
      const ci = c % W, cj = (c / W) | 0;
      for (let k = 0; k < 8; k++) {
        const ni = ci + DI[k], nj = cj + DJ[k];
        if (ni < 0 || nj < 0 || ni >= W || nj >= Hh) continue;
        const n = nj * W + ni;
        if (closed[n]) continue;
        closed[n] = 1;
        filled[n] = Math.max(h[n], filled[c] + 0.0005);
        heap.push(filled[n], n);
      }
    }

    // D8 flow direction (steepest descent on filled surface).
    const down = new Int32Array(N).fill(-1);
    for (let j = 1; j < Hh - 1; j++) {
      for (let i = 1; i < W - 1; i++) {
        const p = j * W + i;
        let best = -1, bestDrop = 0;
        for (let k = 0; k < 8; k++) {
          const n = (j + DJ[k]) * W + (i + DI[k]);
          const dist = k < 4 ? 1 : 1.4142;
          const drop = (filled[p] - filled[n]) / dist;
          if (drop > bestDrop) {
            bestDrop = drop;
            best = n;
          }
        }
        down[p] = best;
      }
    }
    // Accumulation (process high -> low).
    const order = new Uint32Array(N);
    for (let p = 0; p < N; p++) order[p] = p;
    order.sort((a, b) => filled[b] - filled[a]);
    const acc = new Float32Array(N).fill(1);
    for (let k = 0; k < N; k++) {
      const p = order[k];
      const d = down[p];
      if (d >= 0) acc[d] += acc[p];
    }
    // River extraction.
    const T = 900; // ~2.2 km² real catchment
    const isRiver = (p: number) => acc[p] >= T;
    const hasRiverUpstream = new Uint8Array(N);
    for (let p = 0; p < N; p++) if (isRiver(p) && down[p] >= 0) hasRiverUpstream[down[p]] = 1;
    const visited = new Uint8Array(N);
    const toWorld = (p: number) => ({ x: (p % W) * 2 * CELL - WORLD.halfW, z: ((p / W) | 0) * 2 * CELL - WORLD.halfD });
    const rivers: River[] = [];
    for (let p = 0; p < N; p++) {
      if (!isRiver(p) || hasRiverUpstream[p]) continue;
      const pts: RiverPoint[] = [];
      let c = p;
      let guard = 0;
      while (c >= 0 && guard++ < 5000) {
        const w = toWorld(c);
        const width = Math.min(9, 1.6 + 0.85 * Math.sqrt(acc[c] / T));
        pts.push({ x: w.x, z: w.z, y: filled[c], w: width });
        if (visited[c]) break;
        visited[c] = 1;
        c = down[c];
      }
      if (pts.length >= 4) rivers.push({ pts, flow: acc[pts[pts.length - 1] ? p : p] });
    }
    // Smooth + monotone surfaces.
    for (const r of rivers) {
      let pts = r.pts;
      for (let it = 0; it < 2; it++) {
        const out: RiverPoint[] = [pts[0]];
        for (let k = 0; k < pts.length - 1; k++) {
          const a = pts[k], b = pts[k + 1];
          out.push(
            { x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25, y: a.y * 0.75 + b.y * 0.25, w: a.w * 0.75 + b.w * 0.25 },
            { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75, y: a.y * 0.25 + b.y * 0.75, w: a.w * 0.25 + b.w * 0.75 },
          );
        }
        out.push(pts[pts.length - 1]);
        pts = out;
      }
      let prev = Infinity;
      for (const q of pts) {
        const ground = this.terrain.getHeight(q.x, q.z);
        q.y = Math.min(q.y, ground + 0.4, prev);
        prev = q.y;
      }
      r.pts = pts;
      r.flow = Math.max(...pts.map((q) => q.w));
    }
    this.rivers = rivers;
    // Spatial hash for water queries.
    for (const r of rivers) {
      for (const q of r.pts) {
        const key = this.hashKey(q.x, q.z);
        let arr = this.riverHash.get(key);
        if (!arr) this.riverHash.set(key, (arr = []));
        arr.push(q);
      }
    }
  }

  private hashKey(x: number, z: number): number {
    return Math.floor((x + 4000) / 25) * 4096 + Math.floor((z + 4000) / 25);
  }

  /** Lower the terrain under rivers and paint wet banks. */
  carveRivers(): void {
    const t = this.terrain;
    // villages, roads and arenas reshaped the land: re-derive the water surfaces first
    for (const r of this.rivers) {
      let prev = Infinity;
      for (let k = 0; k < r.pts.length; k++) {
        const q = r.pts[k];
        const a = r.pts[Math.max(0, k - 1)], b = r.pts[Math.min(r.pts.length - 1, k + 1)];
        let dx = b.x - a.x, dz = b.z - a.z;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        const e = q.w * 0.5 + 0.6;
        const centre = t.getHeight(q.x, q.z);
        const left = t.getHeight(q.x - dz * e, q.z + dx * e);
        const right = t.getHeight(q.x + dz * e, q.z - dx * e);
        q.y = Math.min(prev, centre - 0.35, left - 0.12, right - 0.12);
        prev = q.y;
      }
    }
    for (const r of this.rivers) {
      for (let k = 0; k < r.pts.length - 1; k++) {
        const a = r.pts[k], b = r.pts[k + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const steps = Math.max(1, Math.ceil(len / 2.5));
        for (let s = 0; s < steps; s++) {
          const u = s / steps;
          const x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u;
          const y = a.y + (b.y - a.y) * u, w = a.w + (b.w - a.w) * u;
          const depth = 0.7 + w * 0.12;
          // carve only the channel itself so the banks stay above the water surface
          t.flattenCircle(x, z, Math.max(0.6, w * 0.5 - 0.4), 1.0, y - depth, "lower");
          t.flattenCircle(x, z, w * 0.5 + 0.2, 0.6, y - 0.05, "lower");
          t.paintSplat(1, x, z, w * 0.5 + 6, 0.9, 0.7);
        }
      }
    }
    // final pass: other rivers' channels may have lowered these banks (confluences)
    for (const r of this.rivers) {
      let prev = Infinity;
      for (let k = 0; k < r.pts.length; k++) {
        const q = r.pts[k];
        const a = r.pts[Math.max(0, k - 1)], b = r.pts[Math.min(r.pts.length - 1, k + 1)];
        let dx = b.x - a.x, dz = b.z - a.z;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        const e = q.w * 0.5 + 0.9;
        const left = t.getHeight(q.x - dz * e, q.z + dx * e);
        const right = t.getHeight(q.x + dz * e, q.z - dx * e);
        q.y = Math.min(prev, q.y, left - 0.08, right - 0.08);
        prev = q.y;
      }
    }
  }

  /** Water surface height at (x,z), or -Infinity if not in water. */
  waterLevel(x: number, z: number): number {
    let best = -Infinity;
    const gi = Math.round((x + WORLD.halfW) / CELL), gj = Math.round((z + WORLD.halfD) / CELL);
    if (gi >= 0 && gj >= 0 && gi < NX && gj < NZ) {
      const li = this.lakeIndex[gj * NX + gi];
      if (li >= 0) best = this.lakeLevel[li];
    }
    const cx = Math.floor((x + 4000) / 25), cz = Math.floor((z + 4000) / 25);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = this.riverHash.get((cx + dx) * 4096 + cz + dz);
        if (!arr) continue;
        for (const q of arr) {
          const d = Math.hypot(q.x - x, q.z - z);
          if (d < q.w * 0.5 + 0.6 && q.y > best) best = q.y;
        }
      }
    }
    return best;
  }

  /** Distance to the nearest river centreline (approx, within 60 m), else Infinity. */
  riverDistance(x: number, z: number): number {
    let best = Infinity;
    const cx = Math.floor((x + 4000) / 25), cz = Math.floor((z + 4000) / 25);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const arr = this.riverHash.get((cx + dx) * 4096 + cz + dz);
        if (!arr) continue;
        for (const q of arr) {
          const d = Math.hypot(q.x - x, q.z - z) - q.w * 0.5;
          if (d < best) best = d;
        }
      }
    }
    return best;
  }

  isLake(x: number, z: number): boolean {
    const gi = Math.round((x + WORLD.halfW) / CELL), gj = Math.round((z + WORLD.halfD) / CELL);
    if (gi < 0 || gj < 0 || gi >= NX || gj >= NZ) return false;
    return this.lakeMask[gj * NX + gi] === 1;
  }
}
