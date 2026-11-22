import { Mesh, VertexData, StandardMaterial, Color3, PointLight, Vector3, Color4, MeshBuilder, TransformNode } from "@babylonjs/core";
import type { Game } from "../core/Game";
import type { InteriorCollision } from "../systems/Physics";
import { PartBuilder, glowMaterial } from "../entities/CharacterKit";
import { NOISE } from "../core/Noise";
import { RNG, clamp01, distToSegment, hashString } from "../core/MathUtil";

export type CaveTheme = "fire" | "ice" | "dark" | "earth" | "crystal";

interface RoomDef {
  x: number;
  z: number;
  r: number;
  floor: number;
  ceil: number;
}
interface InteriorDef {
  id: string;
  name: string;
  theme: CaveTheme;
  siteId: string;
  rooms: RoomDef[];
  tunnels: [number, number, number][];
  arenaRoom?: number;
  gate?: [number, number]; // tunnel sealed by a dark barrier (requires the Rainbow Sword)
}

export const INTERIORS: InteriorDef[] = [
  {
    id: "flame_cave", name: "Cave of the Black Peak", theme: "fire", siteId: "boss_flame",
    rooms: [{ x: 0, z: 0, r: 7, floor: 0, ceil: 7 }, { x: 4, z: 28, r: 10, floor: -3, ceil: 10 }, { x: 22, z: 52, r: 8, floor: -5, ceil: 9 }, { x: 4, z: 84, r: 23, floor: -8, ceil: 22 }],
    tunnels: [[0, 1, 5], [1, 2, 5], [2, 3, 6]], arenaRoom: 3,
  },
  {
    id: "frost_cave", name: "Frozen Hollow of l'Estanyó", theme: "ice", siteId: "boss_frost",
    rooms: [{ x: 0, z: 0, r: 7, floor: 0, ceil: 8 }, { x: -14, z: 26, r: 10, floor: -2, ceil: 12 }, { x: 4, z: 50, r: 8, floor: -4, ceil: 10 }, { x: 0, z: 84, r: 25, floor: -6, ceil: 24 }],
    tunnels: [[0, 1, 5], [1, 2, 5], [2, 3, 6]], arenaRoom: 3,
  },
  {
    id: "zorg_cave", name: "Zorg's Cave", theme: "dark", siteId: "zorgcave",
    rooms: [
      { x: 0, z: 0, r: 8, floor: 0, ceil: 9 },
      { x: 16, z: 30, r: 13, floor: -4, ceil: 15 },
      { x: -8, z: 64, r: 15, floor: -8, ceil: 17 },
      { x: 14, z: 94, r: 8, floor: -10, ceil: 11 },
      { x: 0, z: 118, r: 10, floor: -12, ceil: 13 },
      { x: 0, z: 160, r: 29, floor: -14, ceil: 30 },
    ],
    tunnels: [[0, 1, 6], [1, 2, 6], [2, 3, 5], [3, 4, 5], [4, 5, 7]], arenaRoom: 5, gate: [4, 5],
  },
  {
    id: "hidden1", name: "Smugglers' Grotto", theme: "earth", siteId: "cave_hidden1",
    rooms: [{ x: 0, z: 0, r: 6, floor: 0, ceil: 6 }, { x: 10, z: 20, r: 9, floor: -2, ceil: 9 }], tunnels: [[0, 1, 4]],
  },
  {
    id: "hidden2", name: "Crystal Hollow", theme: "crystal", siteId: "cave_hidden2",
    rooms: [{ x: 0, z: 0, r: 6, floor: 0, ceil: 7 }, { x: -8, z: 18, r: 7, floor: -1, ceil: 8 }, { x: 8, z: 34, r: 11, floor: -3, ceil: 12 }], tunnels: [[0, 1, 4], [1, 2, 4]],
  },
  {
    id: "vault", name: "Vault of the Old Kings", theme: "dark", siteId: "ruins_engolasters",
    rooms: [{ x: 0, z: 0, r: 5, floor: 0, ceil: 6 }, { x: 0, z: 18, r: 9, floor: -2, ceil: 9 }], tunnels: [[0, 1, 3.5]],
  },
];

const THEME = {
  fire: { floor: [0.22, 0.14, 0.12], wall: [0.16, 0.1, 0.09], light: "#ff7a2a", ambient: new Color3(0.14, 0.06, 0.04), crystal: "#ff5a1a" },
  ice: { floor: [0.62, 0.72, 0.8], wall: [0.45, 0.58, 0.7], light: "#7fd4ff", ambient: new Color3(0.08, 0.12, 0.18), crystal: "#8fe0ff" },
  dark: { floor: [0.16, 0.14, 0.18], wall: [0.12, 0.1, 0.14], light: "#b34dff", ambient: new Color3(0.07, 0.05, 0.1), crystal: "#a23cff" },
  earth: { floor: [0.3, 0.26, 0.2], wall: [0.22, 0.19, 0.15], light: "#ffcf7a", ambient: new Color3(0.08, 0.07, 0.06), crystal: "#7affc8" },
  crystal: { floor: [0.22, 0.22, 0.3], wall: [0.18, 0.18, 0.26], light: "#7affea", ambient: new Color3(0.06, 0.08, 0.12), crystal: "#5affd8" },
};

const CELL = 2;

export class InteriorLevel implements InteriorCollision {
  cell = CELL;
  ox: number;
  oy: number;
  oz: number;
  W = 0;
  H = 0;
  minX = 0;
  minZ = 0;
  solid!: Uint8Array;
  cFloor!: Float32Array;
  cCeil!: Float32Array;
  vFloor!: Float32Array;
  vCeil!: Float32Array;
  meshes: Mesh[] = [];
  lights: PointLight[] = [];
  root: TransformNode;
  built = false;
  gateBarrier: Mesh | null = null;
  gateOpen = false;
  gateSeg: { ax: number; az: number; bx: number; bz: number } | null = null;

  constructor(public game: Game, public def: InteriorDef, index: number) {
    this.ox = 6500 + index * 700;
    this.oy = -400;
    this.oz = 0;
    this.root = new TransformNode("interior_" + def.id, game.scene);
    this.rasterize();
  }

  /** World position of a room centre (floor level). */
  roomPos(i: number): Vector3 {
    const r = this.def.rooms[i];
    return new Vector3(this.ox + r.x, this.floorAt(this.ox + r.x, this.oz + r.z), this.oz + r.z);
  }
  get entrance(): Vector3 {
    const r = this.def.rooms[0];
    const p = new Vector3(this.ox + r.x, 0, this.oz + r.z - r.r * 0.4);
    p.y = this.floorAt(p.x, p.z);
    return p;
  }
  get exitPoint(): Vector3 {
    const r = this.def.rooms[0];
    const p = new Vector3(this.ox + r.x, 0, this.oz + r.z - r.r + 1.5);
    p.y = this.floorAt(p.x, p.z);
    return p;
  }
  get arena(): { center: Vector3; r: number } | null {
    if (this.def.arenaRoom === undefined) return null;
    const r = this.def.rooms[this.def.arenaRoom];
    return { center: this.roomPos(this.def.arenaRoom), r: r.r - 3 };
  }

  private rasterize(): void {
    const d = this.def;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const r of d.rooms) {
      minX = Math.min(minX, r.x - r.r);
      maxX = Math.max(maxX, r.x + r.r);
      minZ = Math.min(minZ, r.z - r.r);
      maxZ = Math.max(maxZ, r.z + r.r);
    }
    minX -= 10;
    minZ -= 10;
    maxX += 10;
    maxZ += 10;
    this.minX = minX;
    this.minZ = minZ;
    this.W = Math.ceil((maxX - minX) / CELL);
    this.H = Math.ceil((maxZ - minZ) / CELL);
    const W = this.W, H = this.H;
    this.solid = new Uint8Array(W * H).fill(1);
    this.cFloor = new Float32Array(W * H);
    this.cCeil = new Float32Array(W * H);
    const seed = hashString(d.id) % 1000;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x = minX + (i + 0.5) * CELL, z = minZ + (j + 0.5) * CELL;
        const n = NOISE.fbm2(x * 0.08 + seed, z * 0.08, 3);
        let best = -Infinity, fl = 0, ce = 0;
        for (const r of d.rooms) {
          const k = 1 - Math.hypot(x - r.x, z - r.z) / (r.r * (1 + n * 0.25));
          if (k > best) {
            best = k;
            fl = r.floor;
            ce = r.ceil;
          }
        }
        for (const [a, b, w] of d.tunnels) {
          const A = d.rooms[a], B = d.rooms[b];
          const dist = distToSegment(x, z, A.x, A.z, B.x, B.z);
          const k = 1 - dist / ((w / 2) * (1 + n * 0.3));
          if (k > 0 && k > best - 0.3) {
            const vx = B.x - A.x, vz = B.z - A.z;
            const tt = clamp01(((x - A.x) * vx + (z - A.z) * vz) / (vx * vx + vz * vz));
            const tfl = A.floor + (B.floor - A.floor) * tt;
            if (k > best) {
              best = k;
              fl = tfl;
              ce = tfl + 6 + w * 0.3;
            }
          }
        }
        const p = j * W + i;
        if (best > 0) {
          this.solid[p] = 0;
          this.cFloor[p] = fl + NOISE.noise2(x * 0.2, z * 0.2) * 0.25;
          this.cCeil[p] = Math.max(fl + 4, ce * (0.85 + 0.25 * clamp01(best * 2)) + NOISE.noise2(x * 0.15 + 9, z * 0.15) * 1.5);
        }
      }
    }
    // dilate values into solid cells
    for (let pass = 0; pass < 6; pass++) {
      for (let j = 0; j < H; j++)
        for (let i = 0; i < W; i++) {
          const p = j * W + i;
          if (!this.solid[p] || this.cCeil[p] !== 0) continue;
          let sf = 0, sc = 0, n = 0;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
            const q = jj * W + ii;
            if (this.cCeil[q] !== 0) {
              sf += this.cFloor[q];
              sc += this.cCeil[q];
              n++;
            }
          }
          if (n) {
            this.cFloor[p] = sf / n;
            this.cCeil[p] = sc / n;
          }
        }
    }
    // vertex heights
    this.vFloor = new Float32Array((W + 1) * (H + 1));
    this.vCeil = new Float32Array((W + 1) * (H + 1));
    for (let j = 0; j <= H; j++)
      for (let i = 0; i <= W; i++) {
        let cnt = 0, sf = 0, sc = 0, tf = 0, tc = 0, tn = 0;
        for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
          const q = jj * W + ii;
          tf += this.cFloor[q];
          tc += this.cCeil[q] || this.cFloor[q] + 6;
          tn++;
          if (!this.solid[q]) {
            cnt++;
            sf += this.cFloor[q];
            sc += this.cCeil[q];
          }
        }
        const v = j * (W + 1) + i;
        if (cnt === 4) {
          this.vFloor[v] = sf / 4;
          this.vCeil[v] = sc / 4;
        } else if (cnt > 0) {
          const f = sf / cnt, c = sc / cnt;
          const s = (4 - cnt) / 4;
          this.vFloor[v] = f + Math.pow(s, 1.3) * (c - f) * 0.95;
          this.vCeil[v] = c - s * (c - f) * 0.35;
        } else {
          const f = tn ? tf / tn : 0, c = tn ? tc / tn : 6;
          this.vFloor[v] = c + 1.5;
          this.vCeil[v] = f - 1.5;
        }
      }
  }

  private cellOf(x: number, z: number): number {
    const i = Math.floor((x - this.ox - this.minX) / CELL);
    const j = Math.floor((z - this.oz - this.minZ) / CELL);
    if (i < 0 || j < 0 || i >= this.W || j >= this.H) return -1;
    return j * this.W + i;
  }

  isSolid(x: number, z: number): boolean {
    const p = this.cellOf(x, z);
    if (p < 0 || this.solid[p] === 1) return true;
    if (this.gateSeg && !this.gateOpen) {
      const g = this.gateSeg;
      if (distToSegment(x, z, g.ax, g.az, g.bx, g.bz) < 1.2) return true;
    }
    return false;
  }

  private bilinear(arr: Float32Array, x: number, z: number): number {
    const fx = (x - this.ox - this.minX) / CELL, fz = (z - this.oz - this.minZ) / CELL;
    const i = Math.max(0, Math.min(this.W - 1, Math.floor(fx))), j = Math.max(0, Math.min(this.H - 1, Math.floor(fz)));
    const u = clamp01(fx - i), v = clamp01(fz - j);
    const W1 = this.W + 1;
    const a = arr[j * W1 + i], b = arr[j * W1 + i + 1], c = arr[(j + 1) * W1 + i], d = arr[(j + 1) * W1 + i + 1];
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }

  floorAt(x: number, z: number): number {
    const p = this.cellOf(x, z);
    if (p >= 0 && !this.solid[p]) {
      // floor cells: use cell-based smooth floor (not the wall-rising mesh)
      return this.oy + this.smoothFloor(x, z);
    }
    return this.oy + this.bilinear(this.vFloor, x, z);
  }

  private smoothFloor(x: number, z: number): number {
    const fx = (x - this.ox - this.minX) / CELL - 0.5, fz = (z - this.oz - this.minZ) / CELL - 0.5;
    const i = Math.max(0, Math.min(this.W - 2, Math.floor(fx))), j = Math.max(0, Math.min(this.H - 2, Math.floor(fz)));
    const u = clamp01(fx - i), v = clamp01(fz - j);
    const W = this.W;
    const g = (ii: number, jj: number) => {
      const q = jj * W + ii;
      return this.cFloor[q];
    };
    return g(i, j) * (1 - u) * (1 - v) + g(i + 1, j) * u * (1 - v) + g(i, j + 1) * (1 - u) * v + g(i + 1, j + 1) * u * v;
  }

  ceilingAt(x: number, z: number): number {
    return this.oy + this.bilinear(this.vCeil, x, z);
  }

  build(): void {
    if (this.built) return;
    this.built = true;
    const g = this.game;
    const th = THEME[this.def.theme];
    const W = this.W, H = this.H, W1 = W + 1;
    // which vertices are near walkable space (skip deep rock)
    const near = new Uint8Array((W + 1) * (H + 1));
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        if (this.solid[j * W + i]) continue;
        for (let dj = -2; dj <= 3; dj++)
          for (let di = -2; di <= 3; di++) {
            const ii = i + di, jj = j + dj;
            if (ii >= 0 && jj >= 0 && ii <= W && jj <= H) near[jj * W1 + ii] = 1;
          }
      }
    const mk = (ceiling: boolean) => {
      const positions: number[] = [];
      const colors: number[] = [];
      const indices: number[] = [];
      const vmap = new Int32Array((W + 1) * (H + 1)).fill(-1);
      for (let j = 0; j <= H; j++)
        for (let i = 0; i <= W; i++) {
          const v = j * W1 + i;
          if (!near[v]) continue;
          const x = this.minX + i * CELL, z = this.minZ + j * CELL;
          const y = ceiling ? this.vCeil[v] : this.vFloor[v];
          const fl = this.vFloor[v];
          const wall = ceiling ? 1 : clamp01((y - this.minFloorAround(i, j)) / 4);
          const jx = NOISE.noise2(x * 0.4, z * 0.4 + (ceiling ? 50 : 0)) * 0.9 * (ceiling ? 1 : wall);
          const jz = NOISE.noise2(x * 0.4 + 31, z * 0.4) * 0.9 * (ceiling ? 1 : wall);
          positions.push(this.ox + x + jx, this.oy + y + NOISE.noise2(x * 0.7, z * 0.7) * (0.25 + wall * 0.6), this.oz + z + jz);
          const n = 0.75 + 0.5 * (NOISE.noise2(x * 0.3, z * 0.3 + y) * 0.5 + 0.5);
          const base = ceiling || wall > 0.3 ? th.wall : th.floor;
          let r = base[0] * n, gg = base[1] * n, b = base[2] * n;
          if (this.def.theme === "fire" && !ceiling && wall < 0.2 && NOISE.noise2(x * 0.15, z * 0.15) > 0.35) {
            r = 0.9;
            gg = 0.35;
            b = 0.08;
          }
          void fl;
          colors.push(r, gg, b, 1);
          vmap[v] = positions.length / 3 - 1;
        }
      for (let j = 0; j < H; j++)
        for (let i = 0; i < W; i++) {
          const a = vmap[j * W1 + i], b = vmap[j * W1 + i + 1], c = vmap[(j + 1) * W1 + i], d = vmap[(j + 1) * W1 + i + 1];
          if (a < 0 || b < 0 || c < 0 || d < 0) continue;
          if (ceiling) indices.push(a, c, b, b, c, d);
          else indices.push(a, b, c, b, d, c);
        }
      const m = new Mesh(this.def.id + (ceiling ? "_ceil" : "_floor"), g.scene);
      const vd = new VertexData();
      vd.positions = positions;
      vd.indices = indices;
      vd.colors = colors;
      const normals: number[] = [];
      VertexData.ComputeNormals(positions, indices, normals);
      vd.normals = normals;
      vd.applyToMesh(m);
      return m;
    };
    const mat = new StandardMaterial("caveMat_" + this.def.id, g.scene);
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.specularColor = this.def.theme === "ice" ? new Color3(0.5, 0.6, 0.7) : new Color3(0.08, 0.08, 0.08);
    mat.specularPower = 32;
    mat.maxSimultaneousLights = 10;
    if (this.def.theme === "fire") mat.emissiveColor = new Color3(0.05, 0.01, 0);
    const floor = mk(false);
    const ceil = mk(true);
    floor.material = mat;
    ceil.material = mat;
    floor.receiveShadows = true;
    for (const m of [floor, ceil]) {
      m.parent = this.root;
      m.isPickable = false;
      this.meshes.push(m);
    }
    this.decorate(mat);
    this.setActive(false);
  }

  private minFloorAround(i: number, j: number): number {
    let mn = Infinity;
    for (let dj = -2; dj <= 1; dj++)
      for (let di = -2; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= this.W || jj >= this.H) continue;
        const q = jj * this.W + ii;
        if (!this.solid[q]) mn = Math.min(mn, this.cFloor[q]);
      }
    return mn === Infinity ? this.vFloor[j * (this.W + 1) + i] : mn;
  }

  private decorate(mat: StandardMaterial): void {
    const g = this.game;
    const th = THEME[this.def.theme];
    const rng = new RNG(hashString(this.def.id));
    const pb = new PartBuilder(g.scene);
    const glowPb = new PartBuilder(g.scene);
    const d = this.def;
    const rockCol = `#${[th.wall[0], th.wall[1], th.wall[2]].map((v) => Math.round(Math.min(1, v * 1.4) * 255).toString(16).padStart(2, "0")).join("")}`;
    d.rooms.forEach((room, ri) => {
      const cx = this.ox + room.x, cz = this.oz + room.z;
      const isArena = ri === d.arenaRoom;
      // stalagmites / pillars near the walls
      const count = Math.round(room.r * (isArena ? 0.9 : 1.2));
      for (let k = 0; k < count; k++) {
        const a = rng.next() * Math.PI * 2;
        const rr = room.r * (isArena ? rng.range(0.82, 1.0) : rng.range(0.55, 0.95));
        const x = cx + Math.sin(a) * rr, z = cz + Math.cos(a) * rr;
        if (this.isSolid(x, z)) continue;
        const y = this.floorAt(x, z);
        const h = rng.range(1, 3.5) * (this.def.theme === "ice" ? 1.3 : 1);
        pb.cone(rockCol, h, rng.range(0.6, 1.4), { pos: [x, y + h / 2 - 0.1, z] }, 6);
        g.physics; // collisions for big ones
      }
      // stalactites
      for (let k = 0; k < count; k++) {
        const a = rng.next() * Math.PI * 2, rr = room.r * rng.range(0.2, 0.9);
        const x = cx + Math.sin(a) * rr, z = cz + Math.cos(a) * rr;
        if (this.isSolid(x, z)) continue;
        const y = this.ceilingAt(x, z);
        const h = rng.range(1, 3) * (this.def.theme === "ice" ? 1.5 : 1);
        pb.cone(this.def.theme === "ice" ? "#cfefff" : rockCol, h, rng.range(0.3, 0.9), { pos: [x, y - h / 2 + 0.3, z], rot: [Math.PI, 0, 0] }, 5);
      }
      // glowing crystals
      const nCrystals = this.def.theme === "fire" ? 2 : isArena ? 6 : 4;
      for (let k = 0; k < nCrystals; k++) {
        const a = rng.next() * Math.PI * 2, rr = room.r * rng.range(0.6, 0.92);
        const x = cx + Math.sin(a) * rr, z = cz + Math.cos(a) * rr;
        if (this.isSolid(x, z)) continue;
        const y = this.floorAt(x, z);
        for (let q = 0; q < 4; q++) {
          const h = rng.range(0.8, 2.6);
          glowPb.cyl(th.crystal, h, 0.0, rng.range(0.25, 0.5), { pos: [x + rng.range(-0.6, 0.6), y + h / 2 - 0.2, z + rng.range(-0.6, 0.6)], rot: [rng.range(-0.4, 0.4), 0, rng.range(-0.4, 0.4)] }, 5);
        }
      }
      // light per room
      const light = new PointLight(`cl_${d.id}_${ri}`, new Vector3(cx, this.floorAt(cx, cz) + Math.min(room.ceil - room.floor, 10) * 0.7, cz), g.scene);
      light.diffuse = Color3.FromHexString(th.light);
      light.specular = light.diffuse.scale(0.3);
      light.intensity = isArena ? 2.2 : 1.3;
      light.range = room.r * 2.6 + 8;
      this.lights.push(light);
      // theme extras
      if (this.def.theme === "fire") {
        for (let k = 0; k < (isArena ? 5 : 2); k++) {
          const a = rng.next() * Math.PI * 2, rr = room.r * rng.range(isArena ? 0.55 : 0.2, isArena ? 0.8 : 0.6);
          const x = cx + Math.sin(a) * rr, z = cz + Math.cos(a) * rr;
          if (this.isSolid(x, z)) continue;
          const y = this.floorAt(x, z);
          glowPb.cyl("#ff5a10", 0.12, rng.range(2.2, 4.2), rng.range(2.2, 4.2), { pos: [x, y + 0.06, z] }, 14);
          g.fx.emitter(new Vector3(x, y + 0.3, z), { rate: 8, color1: new Color4(1, 0.5, 0.1, 1), color2: new Color4(1, 0.2, 0.05, 0.8), size: [0.1, 0.4], life: [0.5, 1.5], speed: [0.5, 2], tex: "spark", box: 1.2, boxY: 0.1, capacity: 40 });
        }
      }
      if (this.def.theme === "dark" && ri >= 1) {
        // ancient ruins: pillars & arches
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + 0.3;
          const rr = room.r * 0.62;
          const x = cx + Math.sin(a) * rr, z = cz + Math.cos(a) * rr;
          if (this.isSolid(x, z)) continue;
          const y = this.floorAt(x, z);
          const h = rng.chance(0.35) ? rng.range(1.5, 3) : Math.min(room.ceil - room.floor - 1, 8);
          pb.cyl("#4a4552", h, 1.1, 1.3, { pos: [x, y + h / 2, z] }, 8);
          pb.box("#3a3542", 1.8, 0.4, 1.8, { pos: [x, y + 0.2, z] });
          g.physics; // pillar collision handled via solid grid is coarse; skip
        }
        if (isArena) {
          // throne & banners
          const ty = this.floorAt(cx, cz + room.r * 0.75);
          pb.box("#2a2230", 6, 1.5, 4, { pos: [cx, ty + 0.75, cz + room.r * 0.75] });
          pb.box("#1a141f", 3.4, 7, 1.2, { pos: [cx, ty + 4.5, cz + room.r * 0.8] });
          for (const s of [-1, 1]) glowPb.box("#d01a3a", 1.4, 5, 0.1, { pos: [cx + s * 8, ty + 6, cz + room.r * 0.86] });
        }
      }
      if (this.def.theme === "ice") {
        for (let k = 0; k < 3; k++) {
          const a = rng.next() * Math.PI * 2, rr = room.r * rng.range(0.4, 0.8);
          const x = cx + Math.sin(a) * rr, z = cz + Math.cos(a) * rr;
          if (this.isSolid(x, z)) continue;
          const y = this.floorAt(x, z);
          glowPb.box("#bfe9ff", rng.range(1, 2), rng.range(2, 5), rng.range(1, 2), { pos: [x, y + 1.5, z], rot: [0, rng.next() * 3, rng.range(-0.2, 0.2)] });
        }
      }
      if (this.def.theme === "earth") {
        for (let k = 0; k < 8; k++) {
          const a = rng.next() * Math.PI * 2, rr = room.r * rng.range(0.4, 0.9);
          const x = cx + Math.sin(a) * rr, z = cz + Math.cos(a) * rr;
          if (this.isSolid(x, z)) continue;
          const y = this.floorAt(x, z);
          pb.cyl("#d8d0c0", 0.4, 0.08, 0.1, { pos: [x, y + 0.2, z] }, 5);
          glowPb.sphere("#7affc8", 0.35, { pos: [x, y + 0.45, z], scale: [1, 0.5, 1] }, 6);
        }
      }
    });
    // exit light shaft at the entrance
    const ex = this.exitPoint;
    const shaft = MeshBuilder.CreateCylinder("shaft", { height: 14, diameterTop: 5, diameterBottom: 2.5, tessellation: 12 }, g.scene);
    shaft.position.set(ex.x, ex.y + 6, ex.z - 0.5);
    const sm = new StandardMaterial("shaftMat", g.scene);
    sm.emissiveColor = new Color3(0.9, 0.85, 0.7);
    sm.diffuseColor = new Color3(0, 0, 0);
    sm.alpha = 0.12;
    sm.disableLighting = true;
    shaft.material = sm;
    shaft.parent = this.root;
    this.meshes.push(shaft);
    // dark barrier at the gate
    if (d.gate) {
      const A = d.rooms[d.gate[0]], B = d.rooms[d.gate[1]];
      const t = 0.62;
      const gx = this.ox + A.x + (B.x - A.x) * t, gz = this.oz + A.z + (B.z - A.z) * t;
      const dirx = B.x - A.x, dirz = B.z - A.z;
      const L = Math.hypot(dirx, dirz);
      const px = -dirz / L, pz = dirx / L;
      const halfW = 7;
      this.gateSeg = { ax: gx - px * halfW, az: gz - pz * halfW, bx: gx + px * halfW, bz: gz + pz * halfW };
      const barrier = MeshBuilder.CreatePlane("gate", { width: halfW * 2, height: 12 }, g.scene);
      barrier.position.set(gx, this.floorAt(gx, gz) + 5, gz);
      barrier.rotation.y = Math.atan2(dirx, dirz);
      const bm = new StandardMaterial("gateMat", g.scene);
      bm.emissiveColor = new Color3(0.45, 0.05, 0.6);
      bm.diffuseColor = new Color3(0, 0, 0);
      bm.alpha = 0.55;
      bm.backFaceCulling = false;
      bm.disableLighting = true;
      barrier.material = bm;
      barrier.parent = this.root;
      this.gateBarrier = barrier;
      this.meshes.push(barrier);
      g.fx.emitter(barrier, { rate: 30, color1: new Color4(0.6, 0.1, 0.9, 1), color2: new Color4(0.2, 0.9, 0.3, 0.6), size: [0.2, 0.7], life: [1, 2], speed: [0.2, 1], box: 6, boxY: 5, capacity: 80 });
    }
    const rocks = pb.merge("decor_" + d.id, this.root, mat);
    if (rocks) this.meshes.push(rocks);
    const glow = glowPb.merge("glowdecor_" + d.id, this.root, glowMaterial(g.scene, th.crystal, 1.3));
    if (glow) {
      this.meshes.push(glow);
      g.glow.addIncludedOnlyMesh(glow);
    }
  }

  openGate(): void {
    this.gateOpen = true;
    if (this.gateBarrier) {
      const b = this.gateBarrier;
      this.game.fx.animateMesh(b, 1.5, (k, m) => {
        m.scaling.y = 1 - k;
        (m.material as StandardMaterial).alpha = 0.55 * (1 - k);
      }, true);
      this.gateBarrier = null;
    }
  }

  setActive(on: boolean): void {
    this.root.setEnabled(on);
    for (const l of this.lights) l.setEnabled(on);
  }
}

export class InteriorManager {
  levels = new Map<string, InteriorLevel>();
  current: InteriorLevel | null = null;
  private lantern: PointLight | null = null;
  private transition = false;

  constructor(private game: Game) {}

  init(): void {
    INTERIORS.forEach((d, i) => this.levels.set(d.id, new InteriorLevel(this.game, d, i)));
  }

  level(id: string): InteriorLevel {
    const l = this.levels.get(id);
    if (!l) throw new Error("no interior " + id);
    return l;
  }

  levelForSite(siteId: string): InteriorLevel | null {
    for (const l of this.levels.values()) if (l.def.siteId === siteId) return l;
    return null;
  }

  /** Teleport player into a cave with a fade. */
  async enter(id: string, spawn?: Vector3): Promise<void> {
    if (this.transition) return;
    this.transition = true;
    const g = this.game;
    const lvl = this.level(id);
    await g.ui.fade(1, 0.5);
    lvl.build();
    if (this.current) this.current.setActive(false);
    this.current = lvl;
    lvl.setActive(true);
    g.world.setOverworldVisible(false);
    g.physics.interior = lvl;
    g.env.setInterior(true, THEME[lvl.def.theme].ambient);
    g.env.sun.setEnabled(false);
    if (!this.lantern) {
      this.lantern = new PointLight("lantern", new Vector3(), g.scene);
      this.lantern.diffuse = new Color3(1, 0.85, 0.6);
      this.lantern.intensity = 1.5;
      this.lantern.range = 24;
    }
    this.lantern.setEnabled(true);
    const p = spawn ?? lvl.entrance;
    g.player.teleport(p.x, p.y, p.z, 0);
    g.events.emit("enterInterior", id);
    g.ui.toast(lvl.def.name, "location");
    g.audio.setLocation("cave");
    this.transition = false;
    await g.ui.fade(0, 0.6);
  }

  async exit(): Promise<void> {
    if (!this.current || this.transition) return;
    this.transition = true;
    const g = this.game;
    const lvl = this.current;
    await g.ui.fade(1, 0.5);
    lvl.setActive(false);
    this.current = null;
    g.physics.interior = null;
    g.world.setOverworldVisible(true);
    g.env.interiorMode = false;
    g.env.sky.setEnabled(true);
    g.env.sun.setEnabled(true);
    if (this.lantern) this.lantern.setEnabled(false);
    const site = g.world.site(lvl.def.siteId);
    const m = site.anchors.mouth ?? new Vector3(site.x, site.y, site.z);
    const out = new Vector3(m.x + Math.sin(site.yaw) * 3, 0, m.z + Math.cos(site.yaw) * 3);
    out.y = g.physics.groundHeight(out.x, out.z, 1e5);
    g.player.teleport(out.x, out.y, out.z, site.yaw);
    g.events.emit("exitInterior", lvl.def.id);
    this.transition = false;
    await g.ui.fade(0, 0.6);
  }

  private lightT = 0;
  update(dt: number): void {
    if (this.current && this.lantern) {
      const p = this.game.player.position;
      this.lantern.position.set(p.x, p.y + 2.5, p.z);
      // materials only take a handful of lights: keep the nearest room lights enabled
      this.lightT -= dt;
      if (this.lightT <= 0) {
        this.lightT = 0.3;
        const sorted = [...this.current.lights].sort((a, b) => Vector3.DistanceSquared(a.position, p) - Vector3.DistanceSquared(b.position, p));
        sorted.forEach((l, i) => l.setEnabled(i < 2));
      }
    }
  }

  /** Force-reset to the overworld without fades (respawn / load). */
  resetToOverworld(): void {
    const g = this.game;
    if (this.current) this.current.setActive(false);
    this.current = null;
    g.physics.interior = null;
    g.world.setOverworldVisible(true);
    g.env.interiorMode = false;
    g.env.sky.setEnabled(true);
    g.env.sun.setEnabled(true);
    if (this.lantern) this.lantern.setEnabled(false);
  }
}
