import { Vector3 } from "@babylonjs/core";
import type { TerrainManager } from "../world/TerrainManager";
import type { Hydrology } from "../world/Hydrology";

export interface Collider {
  kind: "circle" | "box";
  x: number;
  z: number;
  r: number; // circle radius
  hw: number; // box half width (local X)
  hd: number; // box half depth (local Z)
  cos: number;
  sin: number;
  y0: number;
  y1: number;
  tag?: string;
  owner?: any;
  enabled: boolean;
  keys?: number[];
}

export interface Platform {
  x: number;
  z: number;
  hw: number;
  hd: number;
  cos: number;
  sin: number;
  y0: number;
  top: (lx: number, lz: number) => number;
  enabled: boolean;
  keys?: number[];
}

export interface InteriorCollision {
  isSolid(x: number, z: number): boolean;
  floorAt(x: number, z: number): number;
  ceilingAt(x: number, z: number): number;
  cell: number;
}

const HCELL = 16;

/**
 * Static collision world: terrain heightfield + spatial hash of circles/boxes + walkable
 * platforms (bridges, floors, stairs) + grid-based interior caves.
 */
export class CollisionWorld {
  private hash = new Map<number, Collider[]>();
  private phash = new Map<number, Platform[]>();
  interior: InteriorCollision | null = null;
  /** dynamic barriers (boss arena rings): centre, radius, inside=true keeps the player inside */
  rings: { x: number; z: number; r: number; inside: boolean; enabled: boolean }[] = [];

  constructor(public terrain: TerrainManager, public hydro: Hydrology) {}

  private key(ix: number, iz: number): number {
    return (ix + 1000) * 4096 + (iz + 1000);
  }

  private insert<T extends { keys?: number[] }>(map: Map<number, T[]>, item: T, x: number, z: number, radius: number): void {
    const i0 = Math.floor((x - radius) / HCELL), i1 = Math.floor((x + radius) / HCELL);
    const j0 = Math.floor((z - radius) / HCELL), j1 = Math.floor((z + radius) / HCELL);
    item.keys = [];
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let arr = map.get(k);
        if (!arr) map.set(k, (arr = []));
        arr.push(item);
        item.keys.push(k);
      }
  }

  addCircle(x: number, z: number, r: number, y0 = -1e5, y1 = 1e5, tag?: string, owner?: any): Collider {
    const c: Collider = { kind: "circle", x, z, r, hw: 0, hd: 0, cos: 1, sin: 0, y0, y1, tag, owner, enabled: true };
    this.insert(this.hash, c, x, z, r);
    return c;
  }

  /** Oriented box; rot = mesh rotation.y */
  addBox(x: number, z: number, hw: number, hd: number, rot: number, y0 = -1e5, y1 = 1e5, tag?: string, owner?: any): Collider {
    const c: Collider = { kind: "box", x, z, r: Math.hypot(hw, hd), hw, hd, cos: Math.cos(rot), sin: Math.sin(rot), y0, y1, tag, owner, enabled: true };
    this.insert(this.hash, c, x, z, c.r);
    return c;
  }

  addPlatform(x: number, z: number, hw: number, hd: number, rot: number, y0: number, top: (lx: number, lz: number) => number): Platform {
    const p: Platform = { x, z, hw, hd, cos: Math.cos(rot), sin: Math.sin(rot), y0, top, enabled: true };
    this.insert(this.phash, p, x, z, Math.hypot(hw, hd));
    return p;
  }

  remove(c: Collider): void {
    if (!c.keys) return;
    for (const k of c.keys) {
      const arr = this.hash.get(k);
      if (arr) {
        const i = arr.indexOf(c);
        if (i >= 0) arr.splice(i, 1);
      }
    }
    c.keys = [];
  }

  /** Ground height under (x,z) for an entity whose feet are at y. */
  groundHeight(x: number, z: number, y: number, step = 0.65): number {
    if (this.interior) return this.interior.floorAt(x, z);
    let g = this.terrain.getHeight(x, z);
    const arr = this.phash.get(this.key(Math.floor(x / HCELL), Math.floor(z / HCELL)));
    if (arr) {
      for (const p of arr) {
        if (!p.enabled) continue;
        const dx = x - p.x, dz = z - p.z;
        const lx = dx * p.cos - dz * p.sin;
        const lz = dx * p.sin + dz * p.cos;
        if (Math.abs(lx) > p.hw || Math.abs(lz) > p.hd) continue;
        const top = p.top(lx, lz);
        if (top <= y + step && top > g) g = top;
      }
    }
    return g;
  }

  /** Terrain only (ignores platforms). */
  terrainHeight(x: number, z: number): number {
    if (this.interior) return this.interior.floorAt(x, z);
    return this.terrain.getHeight(x, z);
  }

  waterLevel(x: number, z: number): number {
    if (this.interior) return -Infinity;
    return this.hydro.waterLevel(x, z);
  }

  /**
   * Push a vertical cylinder (feet at pos.y) out of static colliders. Returns true if it hit.
   */
  resolve(pos: Vector3, radius: number, height: number): boolean {
    let hit = false;
    if (this.interior) {
      hit = this.resolveInterior(pos, radius);
    } else {
      const ix = Math.floor(pos.x / HCELL), iz = Math.floor(pos.z / HCELL);
      for (let pass = 0; pass < 2; pass++) {
        for (let di = -1; di <= 1; di++)
          for (let dj = -1; dj <= 1; dj++) {
            const arr = this.hash.get(this.key(ix + di, iz + dj));
            if (!arr) continue;
            for (const c of arr) {
              if (!c.enabled) continue;
              if (pos.y + height < c.y0 || pos.y > c.y1) continue;
              if (this.pushOut(pos, radius, c)) hit = true;
            }
          }
      }
      // keep inside world
      const lim = 3500 - 20;
      if (pos.x < -lim) pos.x = -lim;
      if (pos.x > lim) pos.x = lim;
      if (pos.z < -3180) pos.z = -3180;
      if (pos.z > 3180) pos.z = 3180;
    }
    for (const ring of this.rings) {
      if (!ring.enabled) continue;
      const dx = pos.x - ring.x, dz = pos.z - ring.z;
      const d = Math.hypot(dx, dz);
      if (ring.inside && d > ring.r - radius) {
        const k = (ring.r - radius) / d;
        pos.x = ring.x + dx * k;
        pos.z = ring.z + dz * k;
        hit = true;
      }
    }
    return hit;
  }

  private pushOut(pos: Vector3, radius: number, c: Collider): boolean {
    if (c.kind === "circle") {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const d2 = dx * dx + dz * dz;
      const rr = radius + c.r;
      if (d2 >= rr * rr) return false;
      const d = Math.sqrt(d2) || 0.0001;
      const push = rr - d;
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
      return true;
    }
    const dx = pos.x - c.x, dz = pos.z - c.z;
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    if (Math.abs(lx) > c.hw + radius || Math.abs(lz) > c.hd + radius) return false;
    const qx = Math.max(-c.hw, Math.min(c.hw, lx));
    const qz = Math.max(-c.hd, Math.min(c.hd, lz));
    let nx = lx - qx, nz = lz - qz;
    let d = Math.hypot(nx, nz);
    let plx = lx, plz = lz;
    if (d > 0.00001) {
      if (d >= radius) return false;
      const push = radius - d;
      plx += (nx / d) * push;
      plz += (nz / d) * push;
    } else {
      // inside the box: push out along the axis of least penetration
      const px = c.hw - Math.abs(lx), pz = c.hd - Math.abs(lz);
      if (px < pz) plx = Math.sign(lx || 1) * (c.hw + radius);
      else plz = Math.sign(lz || 1) * (c.hd + radius);
    }
    // back to world
    pos.x = c.x + plx * c.cos + plz * c.sin;
    pos.z = c.z - plx * c.sin + plz * c.cos;
    return true;
  }

  private resolveInterior(pos: Vector3, radius: number): boolean {
    const it = this.interior!;
    const cs = it.cell;
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      const ci = Math.floor(pos.x / cs), cj = Math.floor(pos.z / cs);
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) {
          const x0 = (ci + di) * cs, z0 = (cj + dj) * cs;
          if (!it.isSolid(x0 + cs * 0.5, z0 + cs * 0.5)) continue;
          const qx = Math.max(x0, Math.min(x0 + cs, pos.x));
          const qz = Math.max(z0, Math.min(z0 + cs, pos.z));
          const nx = pos.x - qx, nz = pos.z - qz;
          const d = Math.hypot(nx, nz);
          if (d >= radius) continue;
          hit = true;
          if (d > 1e-5) {
            pos.x += (nx / d) * (radius - d);
            pos.z += (nz / d) * (radius - d);
          } else {
            pos.x += (pos.x - (x0 + cs / 2)) > 0 ? radius : -radius;
          }
        }
    }
    return hit;
  }

  /** Is there clear line between two points (used for camera + line of sight)? Returns hit fraction 0..1. */
  raycast(from: Vector3, to: Vector3, clearance = 0.4): number {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    const steps = Math.max(2, Math.ceil(len / (this.interior ? 0.4 : 1.5)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = from.x + dx * t, y = from.y + dy * t, z = from.z + dz * t;
      if (this.interior) {
        if (this.interior.isSolid(x, z) || y > this.interior.ceilingAt(x, z) - clearance || y < this.interior.floorAt(x, z) + clearance) return Math.max(0, (s - 1) / steps);
      } else {
        if (y < this.terrain.getHeight(x, z) + clearance) return Math.max(0, (s - 1) / steps);
        const arr = this.hash.get(this.key(Math.floor(x / HCELL), Math.floor(z / HCELL)));
        if (arr) {
          for (const c of arr) {
            if (!c.enabled || c.tag === "tree" || c.tag === "small") continue;
            if (y < c.y0 || y > c.y1) continue;
            if (c.kind === "circle") {
              if (Math.hypot(x - c.x, z - c.z) < c.r) return Math.max(0, (s - 1) / steps);
            } else {
              const lx = (x - c.x) * c.cos - (z - c.z) * c.sin;
              const lz = (x - c.x) * c.sin + (z - c.z) * c.cos;
              if (Math.abs(lx) < c.hw && Math.abs(lz) < c.hd) return Math.max(0, (s - 1) / steps);
            }
          }
        }
      }
    }
    return 1;
  }

  /** Colliders near a point (for interactions). */
  queryNear(x: number, z: number, r: number, tag?: string): Collider[] {
    const out: Collider[] = [];
    const i0 = Math.floor((x - r) / HCELL), i1 = Math.floor((x + r) / HCELL);
    const j0 = Math.floor((z - r) / HCELL), j1 = Math.floor((z + r) / HCELL);
    const seen = new Set<Collider>();
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const arr = this.hash.get(this.key(i, j));
        if (!arr) continue;
        for (const c of arr) {
          if (seen.has(c) || !c.enabled) continue;
          seen.add(c);
          if (tag && c.tag !== tag) continue;
          if (Math.hypot(c.x - x, c.z - z) < r + c.r) out.push(c);
        }
      }
    return out;
  }
}
