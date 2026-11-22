import { Scene, Mesh, VertexData, StandardMaterial, Color3, TransformNode, Vector3 } from "@babylonjs/core";
import { PartBuilder, colorize } from "../entities/CharacterKit";
import { PoisonTintPlugin } from "./MaterialPlugins";
import type { CollisionWorld, Collider } from "../systems/Physics";
import { RNG } from "../core/MathUtil";

let buildingMat: StandardMaterial | null = null;
export function buildingMaterial(scene: Scene): StandardMaterial {
  if (!buildingMat || buildingMat.getScene() !== scene) {
    buildingMat = new StandardMaterial("buildingMat", scene);
    buildingMat.diffuseColor = new Color3(1, 1, 1);
    buildingMat.specularColor = new Color3(0.06, 0.06, 0.06);
    new PoisonTintPlugin(buildingMat);
  }
  return buildingMat;
}

export interface LocalCollider {
  lx: number;
  lz: number;
  hw: number;
  hd: number;
  rot: number;
  y0: number;
  y1: number;
  circle?: number;
}

export interface LocalPlatform {
  lx: number;
  lz: number;
  hw: number;
  hd: number;
  rot: number;
  top: (lx: number, lz: number) => number; // local, relative to structure base y
}

/** Builds a static structure in local space, then places it in the world. */
export class StructureBuilder {
  pb: PartBuilder;
  colliders: LocalCollider[] = [];
  platforms: LocalPlatform[] = [];
  /** local anchor points (doors, emitters, lights) */
  anchors: Record<string, Vector3> = {};
  constructor(public scene: Scene, public x: number, public y: number, public z: number, public yaw: number) {
    this.pb = new PartBuilder(scene);
  }

  /** gable roof prism; ridge along local Z */
  roof(color: string, w: number, h: number, d: number, pos: [number, number, number], rotY = 0): Mesh {
    const hw = w / 2, hd = d / 2;
    const p = [
      -hw, 0, -hd, hw, 0, -hd, 0, h, -hd, // back tri
      -hw, 0, hd, 0, h, hd, hw, 0, hd, // front tri
    ];
    const positions: number[] = [];
    const indices: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d2: number[]) => {
      const i = positions.length / 3;
      positions.push(...a, ...b, ...c, ...d2);
      indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    };
    const tri = (a: number[], b: number[], c: number[]) => {
      const i = positions.length / 3;
      positions.push(...a, ...b, ...c);
      indices.push(i, i + 1, i + 2);
    };
    const v = (k: number) => [p[k * 3], p[k * 3 + 1], p[k * 3 + 2]];
    tri(v(0), v(2), v(1));
    tri(v(3), v(5), v(4));
    // left slope: (-hw,0,-hd) -> (0,h,-hd) -> (0,h,hd) -> (-hw,0,hd)
    quad(v(0), v(3), v(4), v(2));
    // right slope
    quad(v(1), v(2), v(4), v(5));
    // underside
    quad(v(0), v(1), v(5), v(3));
    const m = new Mesh("roof", this.scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    vd.normals = normals;
    vd.applyToMesh(m);
    m.position.set(pos[0], pos[1], pos[2]);
    m.rotation.y = rotY;
    colorize(m, color, 0.06);
    this.pb.parts.push(m);
    return m;
  }

  collideBox(lx: number, lz: number, hw: number, hd: number, rot = 0, y0 = -2, y1 = 50): void {
    this.colliders.push({ lx, lz, hw, hd, rot, y0, y1 });
  }
  collideCircle(lx: number, lz: number, r: number, y0 = -2, y1 = 50): void {
    this.colliders.push({ lx, lz, hw: 0, hd: 0, rot: 0, y0, y1, circle: r });
  }
  platform(lx: number, lz: number, hw: number, hd: number, rot: number, top: (lx: number, lz: number) => number): void {
    this.platforms.push({ lx, lz, hw, hd, rot, top });
  }

  toWorld(lx: number, lz: number): { x: number; z: number } {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return { x: this.x + lx * c + lz * s, z: this.z - lx * s + lz * c };
  }
  anchor(name: string, lx: number, ly: number, lz: number): void {
    this.anchors[name] = new Vector3(lx, ly, lz);
  }
  worldAnchor(name: string): Vector3 {
    const a = this.anchors[name];
    const w = this.toWorld(a.x, a.z);
    return new Vector3(w.x, this.y + a.y, w.z);
  }

  finish(name: string, physics: CollisionWorld | null, material?: StandardMaterial): { mesh: Mesh | null; colliders: Collider[] } {
    const mesh = this.pb.merge(name, null, material ?? buildingMaterial(this.scene));
    if (mesh) {
      mesh.position.set(this.x, this.y, this.z);
      mesh.rotation.y = this.yaw;
      mesh.receiveShadows = true;
      mesh.freezeWorldMatrix();
    }
    const cols: Collider[] = [];
    if (physics) {
      for (const c of this.colliders) {
        const w = this.toWorld(c.lx, c.lz);
        if (c.circle) cols.push(physics.addCircle(w.x, w.z, c.circle, this.y + c.y0, this.y + c.y1, "structure"));
        else cols.push(physics.addBox(w.x, w.z, c.hw, c.hd, this.yaw + c.rot, this.y + c.y0, this.y + c.y1, "structure"));
      }
      for (const p of this.platforms) {
        const w = this.toWorld(p.lx, p.lz);
        const baseY = this.y;
        physics.addPlatform(w.x, w.z, p.hw, p.hd, this.yaw + p.rot, baseY - 5, (lx, lz) => baseY + p.top(lx, lz));
      }
    }
    return { mesh, colliders: cols };
  }
}

// ------------------------------------------------------------------------------------------------
// Palette
export const PAL = {
  stone: "#8b8074",
  stoneDark: "#5f574f",
  stoneLight: "#a79c8e",
  slate: "#3f4652",
  slateDark: "#2e333b",
  wood: "#6b4a2e",
  woodDark: "#4a3220",
  plaster: "#cbbfa8",
  window: "#1f2026",
  shutter: "#5a3d22",
  red: "#8e2b25",
  green: "#3e6b35",
  blue: "#2d4f7a",
  gold: "#c9a227",
  iron: "#3a3d42",
  hay: "#c9ad5a",
};

export type HouseKind = "house" | "inn" | "smithy" | "shop" | "chapel" | "barn" | "hall";

/** Andorran stone house with slate gable roof. Front door faces local +Z. */
export function buildHouse(sb: StructureBuilder, rng: RNG, kind: HouseKind, w: number, d: number): { h: number } {
  const floors = kind === "inn" || kind === "hall" ? 2 : rng.chance(0.4) ? 2 : 1;
  const h = floors === 2 ? 5.6 : 3.4;
  const pb = sb.pb;
  const stone = rng.pick([PAL.stone, "#857a6d", "#91857a", "#7d7368"]);
  // foundation + walls
  pb.box(PAL.stoneDark, w + 0.3, 0.6, d + 0.3, { pos: [0, 0.0, 0] });
  const walls = pb.box(stone, w, h, d, { pos: [0, h / 2, 0] });
  colorize(walls, stone, 0.12);
  // corner quoins
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) pb.box(PAL.stoneLight, 0.35, h, 0.35, { pos: [(sx * w) / 2, h / 2, (sz * d) / 2] });
  // roof
  const roofH = Math.min(w, d) * 0.42;
  const ridgeAlongZ = d >= w;
  if (ridgeAlongZ) sb.roof(PAL.slate, w + 0.9, roofH, d + 0.9, [0, h, 0]);
  else sb.roof(PAL.slate, d + 0.9, roofH, w + 0.9, [0, h, 0], Math.PI / 2);
  // chimney
  pb.box(PAL.stoneDark, 0.6, roofH + 1.4, 0.6, { pos: [w * 0.25, h + roofH * 0.5, -d * 0.2] });
  pb.box(PAL.slateDark, 0.75, 0.12, 0.75, { pos: [w * 0.25, h + roofH + 0.75, -d * 0.2] });
  sb.anchor("chimney", w * 0.25, h + roofH + 0.9, -d * 0.2);
  // door
  pb.box(PAL.woodDark, 1.1, 2.1, 0.12, { pos: [0, 1.05, d / 2 + 0.02] });
  pb.box(PAL.stoneLight, 1.4, 0.25, 0.2, { pos: [0, 2.2, d / 2 + 0.05] });
  sb.anchor("door", 0, 0, d / 2 + 1.0);
  // windows
  const winRow = (y: number) => {
    const n = Math.max(1, Math.floor(w / 2.6));
    for (let k = 0; k < n; k++) {
      const x = -w / 2 + (w / (n + 1)) * (k + 1);
      if (Math.abs(x) < 0.9 && y < 2.5) continue;
      pb.box(PAL.window, 0.7, 0.9, 0.08, { pos: [x, y, d / 2 + 0.03] });
      pb.box(PAL.shutter, 0.32, 0.95, 0.06, { pos: [x - 0.55, y, d / 2 + 0.06] });
      pb.box(PAL.shutter, 0.32, 0.95, 0.06, { pos: [x + 0.55, y, d / 2 + 0.06] });
    }
    // side windows
    pb.box(PAL.window, 0.08, 0.8, 0.6, { pos: [w / 2 + 0.03, y, 0] });
    pb.box(PAL.window, 0.08, 0.8, 0.6, { pos: [-w / 2 - 0.03, y, 0] });
  };
  winRow(1.7);
  if (floors === 2) {
    winRow(4.3);
    // wooden balcony
    if (rng.chance(0.6) || kind === "inn") {
      pb.box(PAL.wood, w * 0.7, 0.15, 1.1, { pos: [0, 3.25, d / 2 + 0.55] });
      pb.box(PAL.wood, w * 0.7, 0.7, 0.06, { pos: [0, 3.65, d / 2 + 1.08] });
      for (let k = -1; k <= 1; k += 2) pb.box(PAL.woodDark, 0.12, 0.9, 0.12, { pos: [k * w * 0.33, 2.8, d / 2 + 1.0] });
    }
  }
  sb.collideBox(0, 0, w / 2 + 0.1, d / 2 + 0.1, 0, -2, h + roofH);
  return { h: h + roofH };
}

export function buildInnExtras(sb: StructureBuilder, w: number, d: number): void {
  const pb = sb.pb;
  // hanging sign
  pb.box(PAL.woodDark, 0.1, 0.1, 1.2, { pos: [w / 2 - 0.5, 3.0, d / 2 + 0.6] });
  pb.box(PAL.wood, 0.08, 0.7, 0.9, { pos: [w / 2 - 0.5, 2.5, d / 2 + 1.0] });
  pb.cyl(PAL.gold, 0.1, 0.4, 0.4, { pos: [w / 2 - 0.44, 2.5, d / 2 + 1.0], rot: [0, 0, Math.PI / 2] }, 10);
  // benches & tables in front
  for (const sx of [-1, 1]) {
    pb.box(PAL.wood, 1.6, 0.08, 0.8, { pos: [sx * 2.4, 0.8, d / 2 + 2.4] });
    pb.box(PAL.woodDark, 0.1, 0.8, 0.1, { pos: [sx * 2.4 - 0.6, 0.4, d / 2 + 2.4] });
    pb.box(PAL.woodDark, 0.1, 0.8, 0.1, { pos: [sx * 2.4 + 0.6, 0.4, d / 2 + 2.4] });
    pb.box(PAL.wood, 1.6, 0.06, 0.3, { pos: [sx * 2.4, 0.45, d / 2 + 1.7] });
    pb.box(PAL.wood, 1.6, 0.06, 0.3, { pos: [sx * 2.4, 0.45, d / 2 + 3.1] });
    sb.anchor("seat" + sx, sx * 2.4, 0, d / 2 + 1.6);
  }
  pb.cyl(PAL.wood, 0.9, 0.55, 0.6, { pos: [-w / 2 - 0.6, 0.45, d / 2 - 0.4] }, 10);
  pb.cyl(PAL.wood, 0.9, 0.55, 0.6, { pos: [-w / 2 - 0.6, 0.45, d / 2 - 1.2] }, 10);
}

export function buildSmithyExtras(sb: StructureBuilder, w: number, d: number): void {
  const pb = sb.pb;
  // open shed on the right side
  const sx = w / 2 + 2.2;
  for (const [ox, oz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) pb.box(PAL.woodDark, 0.25, 2.8, 0.25, { pos: [sx + ox, 1.4, oz] });
  sb.roof(PAL.slate, 4.6, 1.0, 4.6, [sx, 2.8, 0]);
  // forge
  pb.box(PAL.stoneDark, 1.6, 1.0, 1.4, { pos: [sx + 0.6, 0.5, -1.0] });
  pb.box("#ff6a1a", 1.0, 0.1, 0.8, { pos: [sx + 0.6, 1.02, -1.0] });
  pb.box(PAL.stoneDark, 0.8, 2.5, 0.8, { pos: [sx + 0.6, 2.2, -1.4] });
  sb.anchor("forgeFire", sx + 0.6, 1.1, -1.0);
  // anvil
  pb.box(PAL.iron, 0.4, 0.6, 0.4, { pos: [sx - 0.6, 0.3, 0.6] });
  pb.box(PAL.iron, 0.9, 0.25, 0.4, { pos: [sx - 0.6, 0.72, 0.6] });
  sb.anchor("anvil", sx - 0.6, 0, 1.4);
  // weapon rack
  pb.box(PAL.wood, 1.4, 0.1, 0.2, { pos: [sx + 1.6, 1.2, 1.6] });
  for (let k = 0; k < 4; k++) pb.box("#b8bfc8", 0.06, 1.0, 0.03, { pos: [sx + 1.1 + k * 0.32, 1.5, 1.62] });
  sb.collideBox(sx + 0.6, -1.0, 0.8, 0.7, 0, -2, 4);
  sb.collideCircle(sx - 0.6, 0.6, 0.4, -2, 1);
}

export function buildMarketStall(sb: StructureBuilder, lx: number, lz: number, rot: number, cloth: string): void {
  const pb = sb.pb;
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (x: number, z: number): [number, number] => [lx + x * c + z * s, lz - x * s + z * c];
  for (const [x, z] of [[-1.2, -0.7], [1.2, -0.7], [-1.2, 0.7], [1.2, 0.7]]) {
    const [px, pz] = P(x, z);
    pb.box(PAL.woodDark, 0.12, 2.3, 0.12, { pos: [px, 1.15, pz] });
  }
  const [cx, cz] = P(0, 0);
  pb.box(PAL.wood, 2.6, 0.9, 1.4, { pos: [cx, 0.45, cz], rot: [0, rot, 0] });
  pb.box(cloth, 2.9, 0.08, 1.8, { pos: [cx, 2.35, cz], rot: [0.15, rot, 0] });
  // goods
  const goods = ["#c0392b", "#e67e22", "#f1c40f", "#27ae60", "#8e6b3a"];
  for (let k = 0; k < 5; k++) {
    const [gx, gz] = P(-0.9 + k * 0.45, 0.2);
    pb.sphere(goods[k], 0.28, { pos: [gx, 1.0, gz] }, 6);
  }
  sb.collideBox(cx, cz, 1.3, 0.75, rot, -2, 3);
}

export function buildFountain(sb: StructureBuilder): void {
  const pb = sb.pb;
  pb.cyl(PAL.stoneLight, 0.7, 4.2, 4.4, { pos: [0, 0.35, 0] }, 20);
  pb.cyl("#2a5a7a", 0.1, 3.6, 3.6, { pos: [0, 0.62, 0] }, 20);
  pb.cyl(PAL.stone, 1.8, 0.5, 0.7, { pos: [0, 1.0, 0] }, 10);
  pb.cyl(PAL.stoneLight, 0.25, 1.4, 1.2, { pos: [0, 1.9, 0] }, 12);
  pb.sphere(PAL.stoneLight, 0.4, { pos: [0, 2.2, 0] }, 8);
  sb.collideCircle(0, 0, 2.2, -2, 1.2);
  sb.anchor("water", 0, 2.2, 0);
}

export function buildWaystone(sb: StructureBuilder): void {
  const pb = sb.pb;
  pb.cyl(PAL.stoneDark, 0.3, 2.6, 2.8, { pos: [0, 0.15, 0] }, 8);
  pb.cyl(PAL.stone, 0.3, 2.0, 2.2, { pos: [0, 0.4, 0] }, 8);
  const mono = pb.box("#6d7480", 0.8, 3.2, 0.5, { pos: [0, 2.0, 0], rot: [0, 0, 0.02] });
  colorize(mono, "#6d7480", 0.1);
  pb.cone("#6d7480", 0.5, 0.95, { pos: [0, 3.85, 0], scale: [1, 1, 0.62] }, 4);
  sb.collideCircle(0, 0, 1.0, -2, 4);
  sb.anchor("rune", 0, 2.4, 0);
}

export function buildQuestBoard(sb: StructureBuilder): void {
  const pb = sb.pb;
  pb.box(PAL.woodDark, 0.15, 2.4, 0.15, { pos: [-0.9, 1.2, 0] });
  pb.box(PAL.woodDark, 0.15, 2.4, 0.15, { pos: [0.9, 1.2, 0] });
  pb.box(PAL.wood, 2.0, 1.2, 0.08, { pos: [0, 1.6, 0] });
  sb.roof(PAL.slate, 0.6, 0.3, 2.4, [0, 2.4, 0], Math.PI / 2);
  const papers = ["#efe6cf", "#e8dcc0", "#f5edd8", "#ddd0b0"];
  for (let k = 0; k < 5; k++) pb.box(papers[k % 4], 0.32, 0.42, 0.02, { pos: [-0.7 + k * 0.35, 1.55 + (k % 2) * 0.15, 0.05], rot: [0, 0, (k - 2) * 0.06] });
  sb.collideBox(0, 0, 1.0, 0.2, 0, -2, 3);
}

export function buildChapel(sb: StructureBuilder, rng: RNG): void {
  const pb = sb.pb;
  const w = 6, d = 10, h = 5;
  pb.box(PAL.stoneDark, w + 0.4, 0.5, d + 0.4, { pos: [0, 0, 0] });
  colorize(pb.box(PAL.stone, w, h, d, { pos: [0, h / 2, 0] }), PAL.stone, 0.12);
  sb.roof(PAL.slate, w + 0.8, 2.4, d + 0.6, [0, h, 0]);
  // apse
  pb.cyl(PAL.stone, h * 0.85, w * 0.95, w * 0.95, { pos: [0, h * 0.42, -d / 2], scale: [1, 1, 0.7] }, 14);
  pb.cone(PAL.slate, 1.6, w * 1.05, { pos: [0, h * 0.85 + 0.8, -d / 2], scale: [1, 1, 0.7] }, 14);
  // bell tower (Romanesque, Lombard style)
  const tx = w / 2 + 1.7, tz = d / 2 - 1.8;
  colorize(pb.box(PAL.stone, 3.2, 11, 3.2, { pos: [tx, 5.5, tz] }), PAL.stone, 0.12);
  for (let level = 0; level < 3; level++) {
    const y = 4.5 + level * 2.6;
    for (const side of [0, 1, 2, 3]) {
      const a = (side * Math.PI) / 2;
      const ox = Math.sin(a) * 1.62, oz = Math.cos(a) * 1.62;
      pb.box(PAL.window, side % 2 ? 0.08 : 0.9, 1.3, side % 2 ? 0.9 : 0.08, { pos: [tx + ox, y, tz + oz] });
    }
  }
  pb.cone(PAL.slate, 2.4, 4.6, { pos: [tx, 12.2, tz], rot: [0, Math.PI / 4, 0] }, 4);
  pb.box("#6b6b6b", 0.06, 1.2, 0.06, { pos: [tx, 14.0, tz] });
  // door with arch
  pb.box(PAL.woodDark, 1.6, 2.6, 0.12, { pos: [0, 1.3, d / 2 + 0.02] });
  pb.cyl(PAL.stoneLight, 0.3, 1.8, 1.8, { pos: [0, 2.6, d / 2 + 0.05], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 1] }, 12);
  sb.anchor("door", 0, 0, d / 2 + 1.5);
  sb.collideBox(0, 0, w / 2, d / 2 + 0.2, 0, -2, 9);
  sb.collideBox(tx, tz, 1.6, 1.6, 0, -2, 14);
  sb.collideCircle(0, -d / 2, w * 0.45, -2, 6);
  void rng;
}

export function buildCrate(pb: PartBuilder, x: number, y: number, z: number, s = 0.9, rot = 0): void {
  pb.box("#8a6a3e", s, s, s, { pos: [x, y + s / 2, z], rot: [0, rot, 0] });
  pb.box("#5e4426", s * 1.02, s * 0.12, s * 1.02, { pos: [x, y + s * 0.85, z], rot: [0, rot, 0] });
  pb.box("#5e4426", s * 1.02, s * 0.12, s * 1.02, { pos: [x, y + s * 0.15, z], rot: [0, rot, 0] });
}
export function buildBarrel(pb: PartBuilder, x: number, y: number, z: number): void {
  pb.cyl("#7a5530", 1.0, 0.6, 0.6, { pos: [x, y + 0.5, z] }, 10);
  pb.cyl(PAL.iron, 0.08, 0.66, 0.66, { pos: [x, y + 0.8, z] }, 10);
  pb.cyl(PAL.iron, 0.08, 0.66, 0.66, { pos: [x, y + 0.2, z] }, 10);
}
export function buildFence(pb: PartBuilder, x0: number, z0: number, x1: number, z1: number, y: (x: number, z: number) => number): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 2.2));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    pb.box(PAL.woodDark, 0.14, 1.1, 0.14, { pos: [x, y(x, z) + 0.5, z] });
    if (k < n) {
      const t2 = (k + 0.5) / n;
      const mx = x0 + (x1 - x0) * t2, mz = z0 + (z1 - z0) * t2;
      const yaw = Math.atan2(x1 - x0, z1 - z0);
      const yy = y(mx, mz);
      pb.box(PAL.wood, 0.06, 0.1, len / n, { pos: [mx, yy + 0.75, mz], rot: [0, yaw, 0] });
      pb.box(PAL.wood, 0.06, 0.1, len / n, { pos: [mx, yy + 0.4, mz], rot: [0, yaw, 0] });
    }
  }
}

/** Ancient lore stele with glowing runes (rune glow added separately). */
export function buildStele(sb: StructureBuilder): void {
  const pb = sb.pb;
  pb.box(PAL.stoneDark, 1.6, 0.3, 1.0, { pos: [0, 0.15, 0] });
  const s = pb.box("#7a7f86", 1.1, 2.4, 0.35, { pos: [0, 1.5, 0] });
  colorize(s, "#7a7f86", 0.15);
  pb.cyl("#7a7f86", 0.35, 1.1, 1.1, { pos: [0, 2.7, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 1] }, 12);
  sb.collideBox(0, 0, 0.6, 0.25, 0, -2, 3);
  sb.anchor("runes", 0, 1.6, 0.19);
}

/** Large boulder arch forming a cave mouth. Entrance faces local +Z. */
export function buildCaveEntrance(sb: StructureBuilder, rng: RNG, theme: "dark" | "fire" | "ice" | "earth"): void {
  const pb = sb.pb;
  const rock = theme === "ice" ? "#9fb6c8" : theme === "fire" ? "#4a3530" : theme === "dark" ? "#3a3440" : "#6d655c";
  const rockD = theme === "ice" ? "#7c93a8" : theme === "fire" ? "#2e211e" : theme === "dark" ? "#26212c" : "#4f4840";
  // side pillars & lintel from boulders
  for (let k = 0; k < 7; k++) {
    const y = k * 0.9;
    pb.ico(rk(rng, rock, rockD), 1.3 + rng.next() * 0.5, { pos: [-2.8 - rng.next() * 0.4, y + 0.6, rng.range(-0.6, 0.6)], scale: [1, 0.8, 1.2] }, 1, 0.1);
    pb.ico(rk(rng, rock, rockD), 1.3 + rng.next() * 0.5, { pos: [2.8 + rng.next() * 0.4, y + 0.6, rng.range(-0.6, 0.6)], scale: [1, 0.8, 1.2] }, 1, 0.1);
  }
  for (let k = -3; k <= 3; k++) pb.ico(rk(rng, rock, rockD), 1.5 + rng.next() * 0.4, { pos: [k * 1.1, 6.6 + rng.next() * 0.5, rng.range(-0.5, 0.3)], scale: [1.2, 0.8, 1.2] }, 1, 0.1);
  // the dark mouth
  pb.box("#050407", 5.2, 6.4, 0.3, { pos: [0, 3.2, -1.2] });
  pb.box("#050407", 5.6, 0.3, 4.0, { pos: [0, 6.3, -2.6] });
  pb.box("#08070a", 0.3, 6.4, 4.0, { pos: [-2.6, 3.2, -2.6] });
  pb.box("#08070a", 0.3, 6.4, 4.0, { pos: [2.6, 3.2, -2.6] });
  // rubble
  for (let k = 0; k < 8; k++) pb.ico(rk(rng, rock, rockD), 0.3 + rng.next() * 0.5, { pos: [rng.range(-5, 5), 0.1, rng.range(0.5, 4)] }, 1, 0.1);
  // big backing rock mass so the cave looks embedded
  pb.ico(rk(rng, rock, rockD), 6.5, { pos: [0, 3.0, -6.5], scale: [1.4, 1.0, 1.0] }, 1, 0.08);
  sb.collideBox(-3.0, 0, 1.0, 1.5, 0, -2, 10);
  sb.collideBox(3.0, 0, 1.0, 1.5, 0, -2, 10);
  sb.collideBox(0, -2.2, 3.0, 1.0, 0, -2, 10);
  sb.collideCircle(0, -6.5, 7.5, -2, 12);
  sb.anchor("mouth", 0, 0, 1.8);
}

function rk(rng: RNG, a: string, b: string): string {
  return rng.chance(0.5) ? a : b;
}

/** Wooden plank bridge; deck spans local Z from -len/2 (height yA) to +len/2 (height yB), relative to sb.y. */
export function buildBridge(sb: StructureBuilder, len: number, width: number, yA: number, yB: number): void {
  const pb = sb.pb;
  const deck = (lz: number) => yA + (yB - yA) * ((lz + len / 2) / len) + 0.12;
  const n = Math.ceil(len / 0.5);
  const tilt = Math.atan2(yB - yA, len);
  for (let k = 0; k < n; k++) {
    const z = -len / 2 + (k + 0.5) * (len / n);
    pb.box(k % 2 ? PAL.wood : "#73502f", width, 0.12, len / n - 0.04, { pos: [0, deck(z) - 0.06, z], rot: [-tilt, 0, 0] });
  }
  for (const sx of [-1, 1]) {
    pb.box(PAL.woodDark, 0.12, 0.12, len, { pos: [(sx * width) / 2, (deck(-len / 2) + deck(len / 2)) / 2 + 0.9, 0], rot: [-tilt, 0, 0] });
    const posts = Math.ceil(len / 2.5);
    for (let k = 0; k <= posts; k++) {
      const z = -len / 2 + (k * len) / posts;
      pb.box(PAL.woodDark, 0.16, 1.0, 0.16, { pos: [(sx * width) / 2, deck(z) + 0.45, z] });
      pb.box(PAL.woodDark, 0.2, 3.0, 0.2, { pos: [(sx * width) / 2, deck(z) - 1.6, z] });
    }
    pb.box(PAL.woodDark, 0.25, 0.25, len, { pos: [(sx * width) / 2 - sx * 0.1, (deck(-len / 2) + deck(len / 2)) / 2 - 0.25, 0], rot: [-tilt, 0, 0] });
  }
  sb.platform(0, 0, width / 2, len / 2 + 0.3, 0, (_lx, lz) => deck(Math.max(-len / 2, Math.min(len / 2, lz))));
  const midY = (yA + yB) / 2;
  sb.collideBox(-width / 2 - 0.05, 0, 0.08, len / 2 - 0.6, 0, midY - 1, midY + 1.6);
  sb.collideBox(width / 2 + 0.05, 0, 0.08, len / 2 - 0.6, 0, midY - 1, midY + 1.6);
}

/** Medieval stone arch bridge. */
export function buildStoneBridge(sb: StructureBuilder, len: number, width: number, yA: number, yB: number): void {
  const deckY = Math.max(yA, yB);
  const pb = sb.pb;
  const n = 16;
  const archH = 2.2;
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    const z = -len / 2 + t * len;
    const y = deckY + Math.sin(t * Math.PI) * archH * 0.5;
    pb.box(PAL.stone, width, 0.6, len / n + 0.05, { pos: [0, y - 0.25, z] });
    pb.box(PAL.stoneLight, 0.4, 0.8, len / n + 0.05, { pos: [-width / 2, y + 0.4, z] });
    pb.box(PAL.stoneLight, 0.4, 0.8, len / n + 0.05, { pos: [width / 2, y + 0.4, z] });
    const under = Math.sin(t * Math.PI) * 3.5;
    pb.box(PAL.stoneDark, width * 0.9, 1.0 + (3.5 - under), len / n + 0.05, { pos: [0, y - 0.8 - (3.5 - under) / 2, z] });
  }
  sb.platform(0, 0, width / 2, len / 2 + 0.6, 0, (_lx, lz) => deckY + Math.sin(((lz + len / 2) / len) * Math.PI) * archH * 0.5 + 0.06);
  sb.collideBox(-width / 2, 0, 0.22, len / 2, 0, deckY, deckY + archH + 1.4);
  sb.collideBox(width / 2, 0, 0.22, len / 2, 0, deckY, deckY + archH + 1.4);
}

export function buildRuins(sb: StructureBuilder, rng: RNG, scale = 1): void {
  const pb = sb.pb;
  const R = 9 * scale;
  // broken colonnade ring
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const x = Math.sin(a) * R, z = Math.cos(a) * R;
    const h = rng.chance(0.3) ? 0.8 + rng.next() : 2.5 + rng.next() * 2.5;
    pb.cyl(PAL.stoneLight, h, 0.75, 0.85, { pos: [x, h / 2, z] }, 10);
    pb.box(PAL.stone, 1.2, 0.3, 1.2, { pos: [x, 0.15, z] });
    if (h > 3 && rng.chance(0.5)) pb.box(PAL.stoneLight, 1.1, 0.35, 1.1, { pos: [x, h + 0.15, z] });
    sb.collideCircle(x, z, 0.5, -2, h);
  }
  // fallen pillars
  for (let k = 0; k < 4; k++) {
    const a = rng.next() * Math.PI * 2, d = rng.range(3, R + 3);
    pb.cyl(PAL.stoneLight, 3, 0.7, 0.7, { pos: [Math.sin(a) * d, 0.35, Math.cos(a) * d], rot: [Math.PI / 2, rng.next() * 3, 0] }, 10);
  }
  // wall fragment with arch
  pb.box(PAL.stone, 5, 4.5, 0.8, { pos: [-2.5, 2.25, -R - 2] });
  pb.box(PAL.stone, 1.2, 3.0, 0.8, { pos: [1.6, 1.5, -R - 2] });
  pb.torus(PAL.stoneLight, 3.0, 0.5, { pos: [0.4, 3.0, -R - 2], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 1] }, 16);
  sb.collideBox(-2.5, -R - 2, 2.5, 0.45, 0, -2, 5);
  sb.collideBox(1.6, -R - 2, 0.6, 0.45, 0, -2, 3);
  // altar
  pb.box(PAL.stoneDark, 2.4, 1.0, 1.4, { pos: [0, 0.5, 0] });
  pb.box(PAL.stoneLight, 2.6, 0.15, 1.6, { pos: [0, 1.05, 0] });
  sb.collideBox(0, 0, 1.2, 0.7, 0, -2, 1.1);
  sb.anchor("altar", 0, 1.1, 0);
}

export function buildWatchtower(sb: StructureBuilder, rng: RNG): void {
  const pb = sb.pb;
  colorize(pb.cyl(PAL.stone, 9, 4.6, 5.2, { pos: [0, 4.5, 0] }, 14), PAL.stone, 0.12);
  for (let k = 0; k < 8; k++) {
    if (rng.chance(0.35)) continue;
    const a = (k / 8) * Math.PI * 2;
    pb.box(PAL.stone, 1.2, 1.0 + rng.next(), 0.7, { pos: [Math.sin(a) * 2.1, 9.4, Math.cos(a) * 2.1], rot: [0, a, 0] });
  }
  pb.box(PAL.window, 1.2, 2.2, 0.1, { pos: [0, 1.1, 2.55] });
  pb.box(PAL.window, 0.5, 1.0, 0.1, { pos: [0, 5.5, 2.4] });
  for (let k = 0; k < 6; k++) pb.ico(PAL.stone, 0.4 + rng.next() * 0.4, { pos: [rng.range(-5, 5), 0.2, rng.range(-5, 5)] });
  sb.collideCircle(0, 0, 2.5, -2, 10);
}

/** Abandoned fortress (Shadow Knight arena). Courtyard radius R, gate at local +Z. */
export function buildFortress(sb: StructureBuilder, rng: RNG, R: number): void {
  const pb = sb.pb;
  const towers = 8;
  for (let k = 0; k < towers; k++) {
    const a = (k / towers) * Math.PI * 2 + Math.PI / towers;
    const x = Math.sin(a) * R, z = Math.cos(a) * R;
    const h = 9 + rng.next() * 4 - (rng.chance(0.3) ? 4 : 0);
    colorize(pb.cyl(PAL.stoneDark, h, 4.2, 4.8, { pos: [x, h / 2, z] }, 12), PAL.stoneDark, 0.15);
    for (let c = 0; c < 6; c++) {
      if (rng.chance(0.3)) continue;
      const ca = (c / 6) * Math.PI * 2;
      pb.box(PAL.stoneDark, 0.8, 0.8, 0.6, { pos: [x + Math.sin(ca) * 1.9, h + 0.4, z + Math.cos(ca) * 1.9], rot: [0, ca, 0] });
    }
    sb.collideCircle(x, z, 2.3, -2, h);
  }
  // walls between towers
  for (let k = 0; k < towers; k++) {
    const a0 = (k / towers) * Math.PI * 2 + Math.PI / towers;
    const a1 = ((k + 1) / towers) * Math.PI * 2 + Math.PI / towers;
    const x0 = Math.sin(a0) * R, z0 = Math.cos(a0) * R, x1 = Math.sin(a1) * R, z1 = Math.cos(a1) * R;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const len = Math.hypot(x1 - x0, z1 - z0) - 4;
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    // gate: wall segment facing +Z (k where mid angle ~ 0)
    const midA = (a0 + a1) / 2;
    const isGate = Math.abs(Math.sin(midA)) < 0.3 && Math.cos(midA) > 0;
    const broken = !isGate && rng.chance(0.25);
    if (isGate) {
      const side = (len - 6) / 2;
      for (const s of [-1, 1]) {
        const ox = mx + Math.sin(yaw) * s * (3 + side / 2), oz = mz + Math.cos(yaw) * s * (3 + side / 2);
        pb.box(PAL.stoneDark, 1.6, 7, side, { pos: [ox, 3.5, oz], rot: [0, yaw, 0] });
        sb.collideBox(ox, oz, 0.8, side / 2, yaw, -2, 7);
      }
      pb.box(PAL.stoneDark, 1.8, 1.6, 6.4, { pos: [mx, 7.2, mz], rot: [0, yaw, 0] });
      sb.anchor("gate", mx * 1.25, 0, mz * 1.25);
    } else {
      const h = broken ? 2.5 : 7;
      colorize(pb.box(PAL.stoneDark, 1.6, h, len, { pos: [mx, h / 2, mz], rot: [0, yaw, 0] }), PAL.stoneDark, 0.15);
      sb.collideBox(mx, mz, 0.8, len / 2, yaw, -2, h);
    }
  }
  // inner ruined keep at the back
  colorize(pb.box(PAL.stoneDark, 7, 12, 6, { pos: [0, 6, -R * 0.62] }), PAL.stoneDark, 0.12);
  pb.box(PAL.window, 1.6, 3.0, 0.1, { pos: [0, 1.5, -R * 0.62 + 3.02] });
  sb.collideBox(0, -R * 0.62, 3.5, 3, 0, -2, 12);
  // banners
  for (const s of [-1, 1]) {
    pb.box("#1a1020", 1.2, 3.5, 0.05, { pos: [s * 2.6, 7.5, -R * 0.62 + 3.05] });
    pb.box("#d8d8f0", 0.4, 0.4, 0.06, { pos: [s * 2.6, 8.2, -R * 0.62 + 3.08] });
  }
  // rubble
  for (let k = 0; k < 16; k++) {
    const a = rng.next() * Math.PI * 2, d = rng.range(R * 0.6, R * 0.95);
    pb.ico(PAL.stoneDark, 0.4 + rng.next() * 0.6, { pos: [Math.sin(a) * d, 0.2, Math.cos(a) * d] });
  }
}

/** The legendary sword maker's hidden forge, built into the mountainside. Faces local +Z. */
export function buildHiddenForge(sb: StructureBuilder, rng: RNG): void {
  const pb = sb.pb;
  colorize(pb.box(PAL.stoneDark, 9, 4.5, 7, { pos: [0, 2.25, -1] }), PAL.stoneDark, 0.15);
  sb.roof(PAL.slateDark, 10, 2.6, 8, [0, 4.5, -1], Math.PI / 2);
  // huge chimney with forge glow
  pb.box(PAL.stoneDark, 2.0, 9, 2.0, { pos: [3.2, 4.5, -3] });
  sb.anchor("chimney", 3.2, 9.2, -3);
  // open front workshop
  for (const x of [-4, 0, 4]) pb.box(PAL.woodDark, 0.35, 3.6, 0.35, { pos: [x, 1.8, 4.5] });
  sb.roof(PAL.slate, 9.6, 1.4, 4.0, [0, 3.6, 4.0], Math.PI / 2);
  pb.box(PAL.stoneDark, 2.2, 1.2, 1.8, { pos: [2.6, 0.6, 3.6] });
  pb.box("#ff7a20", 1.6, 0.1, 1.2, { pos: [2.6, 1.22, 3.6] });
  sb.anchor("forgeFire", 2.6, 1.3, 3.6);
  // great anvil
  pb.box(PAL.iron, 0.6, 0.8, 0.6, { pos: [-1.2, 0.4, 4.6] });
  pb.box(PAL.iron, 1.4, 0.35, 0.6, { pos: [-1.2, 0.95, 4.6] });
  pb.cone(PAL.iron, 0.5, 0.35, { pos: [-0.3, 0.95, 4.6], rot: [0, 0, -Math.PI / 2] }, 6);
  sb.anchor("anvil", -1.2, 1.15, 4.6);
  sb.anchor("smith", 0.6, 0, 5.8);
  // racks of ancient blades
  for (let k = 0; k < 5; k++) pb.box("#9aa3ad", 0.07, 1.2, 0.03, { pos: [-3.6 + k * 0.3, 1.6, 3.0] });
  pb.box(PAL.wood, 1.8, 0.1, 0.25, { pos: [-3.0, 1.0, 3.0] });
  // rune circle on the floor
  pb.cyl(PAL.stoneLight, 0.1, 5.5, 5.5, { pos: [-1.2, 0.05, 6.4] }, 24);
  for (let k = 0; k < 10; k++) pb.ico(PAL.stone, 0.6 + rng.next() * 0.7, { pos: [rng.range(-7, 7), 0.3, rng.range(-5, -9)] });
  sb.collideBox(0, -1, 4.6, 3.6, 0, -2, 7);
  sb.collideBox(2.6, 3.6, 1.1, 0.9, 0, -2, 1.3);
  sb.collideBox(-1.2, 4.6, 0.7, 0.3, 0, -2, 1.1);
  for (const x of [-4, 0, 4]) sb.collideCircle(x, 4.5, 0.25, -2, 4);
}

export function buildStandingStones(sb: StructureBuilder, rng: RNG, R: number, n: number): void {
  const pb = sb.pb;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const x = Math.sin(a) * R, z = Math.cos(a) * R;
    const h = 2.4 + rng.next() * 1.6;
    colorize(pb.box("#7c7f84", 0.9, h, 0.6, { pos: [x, h / 2, z], rot: [rng.range(-0.06, 0.06), a, rng.range(-0.06, 0.06)] }), "#7c7f84", 0.15);
    sb.collideCircle(x, z, 0.55, -2, h);
  }
}

export function buildCampfire(pb: PartBuilder, x: number, y: number, z: number): void {
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    pb.ico(PAL.stoneDark, 0.22, { pos: [x + Math.sin(a) * 0.7, y + 0.1, z + Math.cos(a) * 0.7] });
  }
  for (let k = 0; k < 4; k++) pb.cyl(PAL.woodDark, 1.0, 0.12, 0.12, { pos: [x, y + 0.25, z], rot: [1.2, (k * Math.PI) / 2, 0] }, 6);
}

export function buildTent(pb: PartBuilder, x: number, y: number, z: number, yaw: number, color: string, sb: StructureBuilder): void {
  const m = sb.roof(color, 2.8, 2.0, 3.2, [x, y, z], yaw);
  void m;
  pb.box(PAL.woodDark, 0.08, 2.0, 0.08, { pos: [x, y + 1.0, z] });
}

export function buildBarricade(pb: PartBuilder, x: number, y: number, z: number, yaw: number): void {
  for (let k = -2; k <= 2; k++) {
    const ox = Math.cos(yaw) * k * 0.7, oz = -Math.sin(yaw) * k * 0.7;
    pb.cyl(PAL.wood, 2.2, 0.05, 0.22, { pos: [x + ox, y + 0.9, z + oz], rot: [0.6 * Math.cos(yaw), 0, -0.6 * Math.sin(yaw)] }, 6);
  }
  pb.box(PAL.woodDark, 0.2, 0.2, 3.6, { pos: [x, y + 0.6, z], rot: [0, yaw + Math.PI / 2, 0] });
}

export function rootAt(scene: Scene, name: string, x: number, y: number, z: number): TransformNode {
  const t = new TransformNode(name, scene);
  t.position.set(x, y, z);
  return t;
}
