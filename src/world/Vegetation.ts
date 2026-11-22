import { Scene, Mesh, Matrix, Vector3, Quaternion, StandardMaterial, Color3, MeshBuilder, VertexData } from "@babylonjs/core";
import { WORLD, Quality } from "../config";
import { PartBuilder } from "../entities/CharacterKit";
import { PoisonTintPlugin, GrassPlugin } from "./MaterialPlugins";
import { NOISE } from "../core/Noise";
import { RNG, clamp01, hash2, smoothstep } from "../core/MathUtil";
import type { TerrainManager } from "./TerrainManager";
import type { CollisionWorld, Collider } from "../systems/Physics";

export type TreeType = 0 | 1 | 2 | 3; // pine, fir, broadleaf, mountain pine
export interface Tree {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: number;
  type: TreeType;
  chunk: number;
  idx: number; // index within chunk/type buffer
  hits: number;
  alive: boolean;
  collider: Collider | null;
  shake: number;
  fall: number;
  fallDir: number;
}

interface ChunkVeg {
  cx: number;
  cz: number;
  x: number;
  z: number;
  trees: Tree[][]; // per type
  rocks: Float32Array | null;
  near: (Mesh | null)[];
  far: (Mesh | null)[];
  rockMesh: Mesh | null;
  mode: -1 | 0 | 1 | 2; // none, far, near
  matrices: Float32Array[]; // per type
}

const CH = WORLD.chunkCells * WORLD.cell; // chunk size in metres

export class Vegetation {
  trees: Tree[] = [];
  private chunks: ChunkVeg[] = [];
  private nearSrc: Mesh[] = [];
  private farSrc: Mesh[] = [];
  private rockSrc!: Mesh;
  private treeMat: StandardMaterial;
  private rockMat: StandardMaterial;
  private grass: Mesh | null = null;
  private flowers: Mesh | null = null;
  private grassCenter = { i: 1e9, j: 1e9 };
  nearDist = 700;
  farDist = 2300;
  grassRadius = 55;
  grassDensity = 1;
  /** forest density grid (10 m cells) */
  forest: Float32Array;
  readonly fw = (WORLD.nx - 1) >> 1;
  readonly fh = (WORLD.nz - 1) >> 1;
  /** exclusion test supplied by world manager */
  exclude: (x: number, z: number, r: number) => boolean = () => false;
  private dirty = new Set<ChunkVeg>();

  constructor(private scene: Scene, private terrain: TerrainManager, private physics: CollisionWorld) {
    this.forest = new Float32Array(this.fw * this.fh);
    this.treeMat = new StandardMaterial("treeMat", scene);
    this.treeMat.diffuseColor = new Color3(1, 1, 1);
    this.treeMat.specularColor = new Color3(0.03, 0.03, 0.03);
    new PoisonTintPlugin(this.treeMat, { wind: true, windStrength: 1 });
    this.rockMat = new StandardMaterial("rockMat", scene);
    this.rockMat.diffuseColor = new Color3(1, 1, 1);
    this.rockMat.specularColor = new Color3(0.05, 0.05, 0.05);
    new PoisonTintPlugin(this.rockMat);
    this.buildSources();
  }

  setQuality(q: Quality): void {
    this.nearDist = q === "high" ? 900 : q === "medium" ? 650 : 420;
    this.farDist = q === "high" ? 2800 : q === "medium" ? 2200 : 1500;
    this.grassRadius = q === "high" ? 70 : q === "medium" ? 52 : 34;
    this.grassDensity = q === "high" ? 1.3 : q === "medium" ? 1 : 0.55;
    this.grassCenter.i = 1e9; // force rebuild
  }

  private buildSources(): void {
    const s = this.scene;
    const mk = (fn: (pb: PartBuilder) => void, name: string) => {
      const pb = new PartBuilder(s);
      fn(pb);
      const m = pb.merge(name, null, this.treeMat)!;
      m.isVisible = false;
      m.isPickable = false;
      return m;
    };
    // 0 pine
    this.nearSrc.push(mk((pb) => {
      pb.cyl("#5a3d26", 3.2, 0.22, 0.4, { pos: [0, 1.6, 0] }, 6);
      pb.cone("#24452a", 4.2, 3.6, { pos: [0, 4.1, 0] }, 8);
      pb.cone("#2b5232", 3.6, 3.0, { pos: [0, 5.7, 0] }, 8);
      pb.cone("#33603a", 3.0, 2.1, { pos: [0, 7.3, 0] }, 7);
      pb.cone("#3a6b40", 2.0, 1.2, { pos: [0, 8.7, 0] }, 6);
    }, "pine"));
    // 1 fir (tall, narrow, dark)
    this.nearSrc.push(mk((pb) => {
      pb.cyl("#4b3322", 3.5, 0.2, 0.36, { pos: [0, 1.75, 0] }, 6);
      for (let k = 0; k < 5; k++) pb.cone(k % 2 ? "#1f3d27" : "#25462c", 2.8, 3.0 - k * 0.5, { pos: [0, 3.2 + k * 1.6, 0] }, 7);
    }, "fir"));
    // 2 broadleaf (birch / beech)
    this.nearSrc.push(mk((pb) => {
      pb.cyl("#d8d2c4", 4.0, 0.2, 0.32, { pos: [0, 2.0, 0] }, 6);
      pb.cyl("#d8d2c4", 1.6, 0.08, 0.14, { pos: [0.5, 3.6, 0], rot: [0, 0, -0.6] }, 5);
      pb.ico("#4f7d32", 2.0, { pos: [0, 5.2, 0], scale: [1, 1.1, 1] }, 1, 0.12);
      pb.ico("#5c8c3a", 1.5, { pos: [1.1, 4.4, 0.4] }, 1, 0.12);
      pb.ico("#457030", 1.4, { pos: [-1.0, 4.6, -0.5] }, 1, 0.12);
      pb.ico("#5a8a38", 1.2, { pos: [0.2, 6.3, 0.3] }, 1, 0.12);
    }, "broadleaf"));
    // 3 mountain pine (short, gnarly)
    this.nearSrc.push(mk((pb) => {
      pb.cyl("#4a3424", 1.8, 0.16, 0.3, { pos: [0, 0.9, 0], rot: [0.08, 0, 0.1] }, 6);
      pb.ico("#2f4f2c", 1.4, { pos: [0, 2.4, 0], scale: [1.1, 0.8, 1.1] }, 1, 0.15);
      pb.ico("#365a32", 1.0, { pos: [0.6, 3.2, 0.2], scale: [1, 0.8, 1] }, 1, 0.15);
      pb.ico("#2c4a29", 0.9, { pos: [-0.5, 2.9, -0.3] }, 1, 0.15);
    }, "mpine"));
    // far LODs
    this.farSrc.push(mk((pb) => {
      pb.cone("#2b5232", 8.0, 3.6, { pos: [0, 4.8, 0] }, 5);
      pb.cyl("#5a3d26", 1.0, 0.3, 0.3, { pos: [0, 0.5, 0] }, 4);
    }, "pineFar"));
    this.farSrc.push(mk((pb) => {
      pb.cone("#22432a", 9.5, 3.0, { pos: [0, 5.2, 0] }, 5);
    }, "firFar"));
    this.farSrc.push(mk((pb) => {
      pb.cyl("#d8d2c4", 3.0, 0.3, 0.3, { pos: [0, 1.5, 0] }, 4);
      pb.ico("#4f7d32", 2.6, { pos: [0, 5.0, 0] }, 0);
    }, "broadFar"));
    this.farSrc.push(mk((pb) => {
      pb.ico("#2f4f2c", 1.7, { pos: [0, 2.3, 0], scale: [1, 0.8, 1] }, 0);
    }, "mpineFar"));
    // rock
    const pb = new PartBuilder(s);
    pb.ico("#7d7a76", 1, { scale: [1.2, 0.75, 1] }, 1, 0.18);
    this.rockSrc = pb.merge("rock", null, this.rockMat)!;
    this.rockSrc.isVisible = false;
  }

  /** Compute forest density field. */
  computeForest(): void {
    const t = this.terrain;
    for (let j = 0; j < this.fh; j++) {
      for (let i = 0; i < this.fw; i++) {
        const x = (i * 2 + 1) * WORLD.cell - WORLD.halfW;
        const z = (j * 2 + 1) * WORLD.cell - WORLD.halfD;
        const y = t.getHeight(x, z);
        const n = t.getNormal(x, z, TMPV);
        const slope = Math.acos(n.y) * 57.3;
        const patches = smoothstep(-0.12, 0.25, NOISE.fbm2(x * 0.0022, z * 0.0022, 4) + NOISE.fbm2(x * 0.011, z * 0.011, 2) * 0.25);
        const alt = smoothstep(20, 70, y) * (1 - smoothstep(400, 440, y));
        const sl = 1 - smoothstep(36, 48, slope);
        const north = 0.75 + 0.35 * n.z; // north-facing slopes are greener
        let f = patches * alt * sl * north;
        if (this.exclude(x, z, 6)) f = 0;
        this.forest[j * this.fw + i] = clamp01(f);
        if (f > 0.05) {
          const v = Math.round(clamp01(f * 1.2) * 255);
          t.setSplatCell(0, i * 2, j * 2, v);
          t.setSplatCell(0, i * 2 + 1, j * 2, v);
          t.setSplatCell(0, i * 2, j * 2 + 1, v);
          t.setSplatCell(0, i * 2 + 1, j * 2 + 1, v);
        }
      }
    }
  }

  forestAt(x: number, z: number): number {
    const i = Math.floor((x + WORLD.halfW) / (WORLD.cell * 2));
    const j = Math.floor((z + WORLD.halfD) / (WORLD.cell * 2));
    if (i < 0 || j < 0 || i >= this.fw || j >= this.fh) return 0;
    return this.forest[j * this.fw + i];
  }

  /** Place trees and rocks into chunk buckets. */
  scatter(): void {
    const ncx = (WORLD.nx - 1) / WORLD.chunkCells, ncz = (WORLD.nz - 1) / WORLD.chunkCells;
    for (let cz = 0; cz < ncz; cz++)
      for (let cx = 0; cx < ncx; cx++) {
        this.chunks.push({
          cx, cz,
          x: (cx + 0.5) * CH - WORLD.halfW,
          z: (cz + 0.5) * CH - WORLD.halfD,
          trees: [[], [], [], []],
          rocks: null,
          near: [null, null, null, null],
          far: [null, null, null, null],
          rockMesh: null,
          mode: -1,
          matrices: [],
        });
      }
    const rng = new RNG(777);
    const t = this.terrain;
    const cell = WORLD.cell * 2;
    for (let j = 0; j < this.fh; j++) {
      for (let i = 0; i < this.fw; i++) {
        const f = this.forest[j * this.fw + i];
        const expected = f * 1.05;
        let n = Math.floor(expected + rng.next() * 0.999);
        if (f < 0.05 && rng.chance(0.006)) n = 1; // lone trees in meadows
        for (let k = 0; k < n; k++) {
          const x = (i + rng.next()) * cell - WORLD.halfW;
          const z = (j + rng.next()) * cell - WORLD.halfD;
          if (this.exclude(x, z, 2.5)) continue;
          const y = t.getHeight(x, z);
          if (t.getSlope(x, z) > 46) continue;
          let type: TreeType;
          const r = rng.next();
          if (y < 140) type = r < 0.55 ? 2 : r < 0.8 ? 0 : 1;
          else if (y < 330) type = r < 0.15 ? 2 : r < 0.6 ? 0 : 1;
          else type = r < 0.6 ? 3 : 0;
          const cx = Math.min(ncx - 1, Math.floor((x + WORLD.halfW) / CH));
          const cz = Math.min(ncz - 1, Math.floor((z + WORLD.halfD) / CH));
          const ci = cz * ncx + cx;
          const tree: Tree = {
            x, y: y - 0.2, z,
            s: 0.75 + rng.next() * 0.6,
            rot: rng.next() * Math.PI * 2,
            type, chunk: ci, idx: this.chunks[ci].trees[type].length,
            hits: 0, alive: true, collider: null, shake: 0, fall: 0, fallDir: 0,
          };
          tree.collider = this.physics.addCircle(x, z, 0.38 * tree.s, tree.y - 1, tree.y + 6, "tree", tree);
          this.chunks[ci].trees[type].push(tree);
          this.trees.push(tree);
        }
      }
    }
    // rocks
    for (const c of this.chunks) {
      const arr: number[] = [];
      const count = 70;
      for (let k = 0; k < count; k++) {
        const x = c.x + (rng.next() - 0.5) * CH, z = c.z + (rng.next() - 0.5) * CH;
        if (!t.inBounds(x, z) || this.exclude(x, z, 3)) continue;
        const y = t.getHeight(x, z);
        const slope = t.getSlope(x, z);
        const rocky = smoothstep(25, 45, slope) + smoothstep(380, 480, y);
        if (rng.next() > 0.15 + rocky * 0.8) continue;
        const s = 0.4 + rng.next() * (rng.chance(0.1) ? 3.2 : 1.3);
        arr.push(x, y + s * 0.15, z, s, rng.next() * 6.28);
        if (s > 1.2) this.physics.addCircle(x, z, s * 0.9, y - 2, y + s * 0.8, "rock");
      }
      c.rocks = new Float32Array(arr);
    }
  }

  private treeMatrix(tr: Tree, out: Float32Array, o: number): void {
    const s = tr.alive || tr.fall < 1 ? tr.s : 0.0001;
    let q: Quaternion;
    if (tr.fall > 0) {
      const ang = Math.min(1, tr.fall) ** 2 * 1.5;
      q = Quaternion.RotationYawPitchRoll(tr.rot, 0, 0).multiply(Quaternion.RotationAxis(new Vector3(Math.cos(tr.fallDir), 0, -Math.sin(tr.fallDir)), ang));
    } else if (tr.shake > 0) {
      const a = Math.sin(tr.shake * 40) * tr.shake * 0.08;
      q = Quaternion.RotationYawPitchRoll(tr.rot, a, a * 0.5);
    } else {
      q = Quaternion.RotationYawPitchRoll(tr.rot, 0, 0);
    }
    const sink = tr.fall > 1 ? (tr.fall - 1) * 3 : 0;
    Matrix.ComposeToRef(new Vector3(s, s, s), q, new Vector3(tr.x, tr.y - sink, tr.z), TMPM);
    TMPM.copyToArray(out, o);
  }

  private buildChunkMeshes(c: ChunkVeg, near: boolean): void {
    for (let type = 0; type < 4; type++) {
      const list = c.trees[type];
      if (!list.length) continue;
      if (!c.matrices[type]) {
        const arr = new Float32Array(list.length * 16);
        list.forEach((tr, k) => this.treeMatrix(tr, arr, k * 16));
        c.matrices[type] = arr;
      }
      const arrRef = near ? c.near : c.far;
      if (arrRef[type]) continue;
      const src = (near ? this.nearSrc : this.farSrc)[type];
      const m = src.clone(`veg_${c.cx}_${c.cz}_${type}_${near ? "n" : "f"}`, null, true, false) as Mesh;
      m.isVisible = true;
      m.thinInstanceSetBuffer("matrix", c.matrices[type], 16, false);
      m.thinInstanceRefreshBoundingInfo(false);
      m.isPickable = false;
      m.receiveShadows = near;
      m.setEnabled(false);
      arrRef[type] = m;
      if (near && this.onNearMesh) this.onNearMesh(m);
    }
    if (near && !c.rockMesh && c.rocks && c.rocks.length) {
      const n = c.rocks.length / 5;
      const mats = new Float32Array(n * 16);
      for (let k = 0; k < n; k++) {
        const s = c.rocks[k * 5 + 3];
        Matrix.ComposeToRef(new Vector3(s, s, s), Quaternion.RotationYawPitchRoll(c.rocks[k * 5 + 4], 0.2, 0), new Vector3(c.rocks[k * 5], c.rocks[k * 5 + 1], c.rocks[k * 5 + 2]), TMPM);
        TMPM.copyToArray(mats, k * 16);
      }
      const m = this.rockSrc.clone(`rocks_${c.cx}_${c.cz}`, null, true, false) as Mesh;
      m.isVisible = true;
      m.thinInstanceSetBuffer("matrix", mats, 16, true);
      m.thinInstanceRefreshBoundingInfo(false);
      m.receiveShadows = true;
      m.setEnabled(false);
      c.rockMesh = m;
    }
  }

  onNearMesh: ((m: Mesh) => void) | null = null;

  setVisible(v: boolean): void {
    for (const c of this.chunks) {
      for (const m of [...c.near, ...c.far, c.rockMesh]) m?.setEnabled(false);
      c.mode = -1;
    }
    if (this.grass) this.grass.setEnabled(v && this.grass.thinInstanceCount > 0);
    if (this.flowers) this.flowers.setEnabled(v && this.flowers.thinInstanceCount > 0);
    this.hidden = !v;
  }
  private hidden = false;

  update(dt: number, cam: Vector3, player: Vector3): void {
    if (this.hidden) return;
    let built = 0;
    for (const c of this.chunks) {
      const dx = Math.max(0, Math.abs(cam.x - c.x) - CH / 2);
      const dz = Math.max(0, Math.abs(cam.z - c.z) - CH / 2);
      const d = Math.hypot(dx, dz);
      const mode: -1 | 1 | 2 = d < this.nearDist ? 2 : d < this.farDist ? 1 : -1;
      if (mode === c.mode) continue;
      if (mode === 2 && !c.near.some((m) => m) && built > 1) continue;
      if (mode === 1 && !c.far.some((m) => m) && built > 3) continue;
      if (mode === 2) this.buildChunkMeshes(c, true), built++;
      if (mode === 1) this.buildChunkMeshes(c, false), built++;
      for (let t = 0; t < 4; t++) {
        c.near[t]?.setEnabled(mode === 2);
        c.far[t]?.setEnabled(mode === 1);
      }
      c.rockMesh?.setEnabled(mode === 2);
      c.mode = mode;
    }
    // animated trees
    for (const c of this.dirty) {
      let still = false;
      for (let type = 0; type < 4; type++) {
        const list = c.trees[type];
        const mats = c.matrices[type];
        if (!mats) continue;
        let changed = false;
        for (const tr of list) {
          if (tr.shake > 0 || (tr.fall > 0 && tr.fall < 2)) {
            if (tr.shake > 0) tr.shake = Math.max(0, tr.shake - dt);
            if (tr.fall > 0 && tr.fall < 2) tr.fall = Math.min(2, tr.fall + dt * 0.9);
            this.treeMatrix(tr, mats, tr.idx * 16);
            changed = true;
            still = true;
          }
        }
        if (changed) {
          c.near[type]?.thinInstanceBufferUpdated("matrix");
          c.far[type]?.thinInstanceBufferUpdated("matrix");
        }
      }
      if (!still) this.dirty.delete(c);
    }
    this.updateGrass(player);
  }

  /** Called by combat when a tree is struck. Returns drop item id or null. */
  hitTree(tr: Tree, dirYaw: number): { felled: boolean } {
    if (!tr.alive) return { felled: false };
    tr.hits++;
    tr.shake = 0.6;
    const c = this.chunks[tr.chunk];
    this.dirty.add(c);
    if (tr.hits >= 3) {
      tr.alive = false;
      tr.fall = 0.01;
      tr.fallDir = dirYaw;
      if (tr.collider) tr.collider.enabled = false;
      return { felled: true };
    }
    return { felled: false };
  }

  treesNear(x: number, z: number, r: number): Tree[] {
    return this.physics.queryNear(x, z, r, "tree").map((c) => c.owner as Tree).filter((t) => t && t.alive);
  }

  // ------------------------------------------------------------------ grass
  private ensureGrassMeshes(): void {
    if (this.grass) return;
    const s = this.scene;
    // grass clump: a few crossed blades
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const blades = 7;
    const rng = new RNG(5);
    for (let b = 0; b < blades; b++) {
      const a = rng.next() * Math.PI;
      const ox = (rng.next() - 0.5) * 0.5, oz = (rng.next() - 0.5) * 0.5;
      const h = 0.35 + rng.next() * 0.45, w = 0.07;
      const cx = Math.cos(a) * w, cz = Math.sin(a) * w;
      const lean = (rng.next() - 0.5) * 0.2;
      const i = positions.length / 3;
      positions.push(ox - cx, 0, oz - cz, ox + cx, 0, oz + cz, ox + lean, h, oz + lean * 0.5);
      const g = 0.75 + rng.next() * 0.35;
      colors.push(0.22 * g, 0.38 * g, 0.12 * g, 1, 0.22 * g, 0.38 * g, 0.12 * g, 1, 0.5 * g, 0.62 * g, 0.24 * g, 1);
      indices.push(i, i + 1, i + 2, i, i + 2, i + 1);
    }
    const gm = new Mesh("grass", s);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.colors = colors;
    vd.normals = positions.map((_, k) => (k % 3 === 1 ? 1 : 0));
    vd.applyToMesh(gm);
    const mat = new StandardMaterial("grassMat", s);
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;
    new GrassPlugin(mat);
    gm.material = mat;
    gm.isPickable = false;
    gm.receiveShadows = true;
    gm.alwaysSelectAsActiveMesh = true;
    this.grass = gm;
    // flowers
    const pb = new PartBuilder(s);
    pb.cyl("#3f6b2a", 0.35, 0.02, 0.02, { pos: [0, 0.17, 0] }, 3);
    pb.ico("#ffffff", 0.07, { pos: [0, 0.36, 0] }, 0);
    const fm = pb.merge("flowers", null, mat)!;
    fm.alwaysSelectAsActiveMesh = true;
    this.flowers = fm;
  }

  private updateGrass(player: Vector3): void {
    if (this.grassRadius <= 0) return;
    const tile = 16;
    const ci = Math.floor(player.x / tile), cj = Math.floor(player.z / tile);
    if (ci === this.grassCenter.i && cj === this.grassCenter.j) return;
    this.grassCenter = { i: ci, j: cj };
    this.ensureGrassMeshes();
    const R = Math.ceil(this.grassRadius / tile);
    const mats: number[] = [];
    const fmats: number[] = [];
    const fcols: number[] = [];
    const t = this.terrain;
    const perTile = Math.round(70 * this.grassDensity);
    const flowerCols = [[1, 0.85, 0.2], [0.95, 0.95, 1], [0.75, 0.45, 0.95], [1, 0.4, 0.4], [0.4, 0.6, 1]];
    for (let dj = -R; dj <= R; dj++) {
      for (let di = -R; di <= R; di++) {
        if (di * di + dj * dj > R * R) continue;
        const ti = ci + di, tj = cj + dj;
        let seed = Math.floor(hash2(ti, tj) * 1e9);
        const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
        for (let k = 0; k < perTile; k++) {
          const x = (ti + rnd()) * tile, z = (tj + rnd()) * tile;
          const sc = 0.7 + rnd() * 0.8;
          const yaw = rnd() * 6.28;
          const fl = rnd();
          if (!t.inBounds(x, z)) continue;
          const y = t.getHeight(x, z);
          if (y > 470) continue;
          const n = t.getNormal(x, z, TMPV);
          if (n.y < 0.8) continue;
          if (this.exclude(x, z, 0.5)) continue;
          const f = this.forestAt(x, z);
          if (f > 0.6 && rnd() < 0.6) continue;
          Matrix.ComposeToRef(new Vector3(sc, sc * (y > 400 ? 0.6 : 1), sc), Quaternion.RotationYawPitchRoll(yaw, 0, 0), new Vector3(x, y - 0.05, z), TMPM);
          if (fl < 0.035) {
            for (let q = 0; q < 16; q++) fmats.push(TMPM.m[q]);
            const fc = flowerCols[Math.floor(rnd() * flowerCols.length)];
            fcols.push(fc[0], fc[1], fc[2], 1);
          } else {
            for (let q = 0; q < 16; q++) mats.push(TMPM.m[q]);
          }
        }
      }
    }
    // never leave a thin-instanced mesh with zero instances: it would render as a plain mesh
    this.grass!.setEnabled(mats.length > 0);
    if (mats.length) this.grass!.thinInstanceSetBuffer("matrix", new Float32Array(mats), 16, false);
    this.flowers!.setEnabled(fmats.length > 0);
    if (fmats.length) {
      this.flowers!.thinInstanceSetBuffer("matrix", new Float32Array(fmats), 16, false);
      this.flowers!.thinInstanceSetBuffer("color", new Float32Array(fcols), 4, false);
    }
  }

  chunkCount(): number {
    return this.chunks.length;
  }
}

const TMPM = new Matrix();
const TMPV = new Vector3();
void MeshBuilder;
