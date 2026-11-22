import { Scene, Mesh, Vector3, StandardMaterial, Color3, ParticleSystem, Color4 } from "@babylonjs/core";
import { VillageDef, geoToWorld } from "./AndorraData";
import {
  StructureBuilder, buildHouse, buildInnExtras, buildSmithyExtras, buildMarketStall, buildFountain, buildWaystone, buildQuestBoard,
  buildChapel, buildCrate, buildBarrel, buildFence, HouseKind, PAL, buildBarricade, buildTent, buildCampfire,
} from "./Buildings";
import { PartBuilder } from "../entities/CharacterKit";
import { RNG, hashString } from "../core/MathUtil";
import type { TerrainManager } from "./TerrainManager";
import type { Hydrology } from "./Hydrology";
import type { CollisionWorld, Collider } from "../systems/Physics";
import type { Effects } from "../systems/Effects";

export interface Spot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  kind: "work" | "sit" | "social" | "farm" | "guard" | "home" | "anvil" | "stall" | "inn" | "camp";
  building?: Building;
  taken?: boolean;
}

export interface Building {
  id: string;
  kind: HouseKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  w: number;
  d: number;
  h: number;
  door: Vector3;
  mesh: Mesh | null;
  colliders: Collider[];
  damaged: boolean;
  burning: boolean;
  fire: ParticleSystem | null;
  smoke: ParticleSystem | null;
  sb: StructureBuilder;
}

export type VillageState = "peaceful" | "worried" | "fearful" | "evacuating" | "abandoned" | "refuge";

export interface Village {
  def: VillageDef;
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  buildings: Building[];
  spots: Spot[];
  inn?: Building;
  smithy?: Building;
  shop?: Building;
  chapel?: Building;
  waystone: Vector3;
  board: Vector3;
  fountain: Vector3;
  entrances: { x: number; z: number; yaw: number }[];
  props: Mesh[];
  windows: Mesh | null;
  windowMat: StandardMaterial | null;
  state: VillageState;
  barricades: Mesh | null;
  camp: Mesh | null;
  fieldSpots: Spot[];
  saved?: boolean;
}

interface Planned {
  kind: HouseKind;
  x: number;
  z: number;
  y: number;
  yaw: number;
  w: number;
  d: number;
}

export class VillageBuilder {
  villages: Village[] = [];
  private plans = new Map<string, { center: { x: number; z: number; y: number }; buildings: Planned[]; fields: { x: number; z: number; y: number; yaw: number }[] }>();

  constructor(private scene: Scene, private terrain: TerrainManager, private hydro: Hydrology) {}

  /** Phase 1: decide positions and flatten terrain pads (before roads / meshes). */
  plan(def: VillageDef): void {
    const rng = new RNG(hashString(def.id));
    const c = geoToWorld(def.lat, def.lon);
    const t = this.terrain;
    const cy = t.getAvgHeight(c.x, c.z, 8);
    t.flattenCircle(c.x, c.z, 13, 10, cy);
    t.paintSplat(2, c.x, c.z, 14, 1, 0.25);
    const list: HouseKind[] = [];
    if (def.hasInn) list.push("inn");
    if (def.hasSmith) list.push("smithy");
    if (def.hasShop) list.push("shop");
    if (def.id === "ordino" || def.id === "andorra" || def.id === "canillo" || def.id === "encamp") list.push("chapel");
    if (def.id === "andorra") list.push("hall");
    while (list.length < def.houses) list.push(rng.chance(0.15) ? "barn" : "house");
    const placed: Planned[] = [];
    for (const kind of list) {
      const [w, d] =
        kind === "inn" ? [9, 7.5] : kind === "smithy" ? [6.5, 6] : kind === "shop" ? [7, 6] : kind === "chapel" ? [9, 13] : kind === "hall" ? [11, 8] : kind === "barn" ? [8, 6] : [rng.range(5, 7.5), rng.range(5, 7)];
      const r = Math.hypot(w, d) / 2 + (kind === "smithy" ? 4 : kind === "shop" ? 2 : 0);
      for (let attempt = 0; attempt < 90; attempt++) {
        const dist = 19 + r + attempt * 0.45 + rng.next() * 10;
        const ang = rng.next() * Math.PI * 2;
        const x = c.x + Math.sin(ang) * dist, z = c.z + Math.cos(ang) * dist;
        if (!t.inBounds(x, z) || this.hydro.isLake(x, z)) continue;
        if (this.hydro.riverDistance(x, z) < r + 6) continue;
        if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < r + Math.hypot(p.w, p.d) / 2 + 3.5)) continue;
        let mn = Infinity, mx = -Infinity, sum = 0;
        for (const [ox, oz] of [[0, 0], [-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) {
          const h = t.getHeight(x + ox, z + oz);
          mn = Math.min(mn, h);
          mx = Math.max(mx, h);
          sum += h;
        }
        if (mx - mn > 6.5 + attempt * 0.04) continue;
        const yaw = Math.atan2(c.x - x, c.z - z) + rng.range(-0.2, 0.2);
        const y = sum / 5;
        placed.push({ kind, x, z, y, yaw, w, d });
        break;
      }
    }
    for (const p of placed) t.flattenRect(p.x, p.z, p.w / 2 + 1.6, p.d / 2 + 2.6, p.yaw, 5, p.y);
    // fields
    const fields: { x: number; z: number; y: number; yaw: number }[] = [];
    for (let k = 0; k < 18 && fields.length < (def.id === "ordino" ? 3 : 2); k++) {
      const ang = rng.next() * Math.PI * 2, dist = rng.range(55, 85);
      const x = c.x + Math.sin(ang) * dist, z = c.z + Math.cos(ang) * dist;
      if (!t.inBounds(x, z) || t.getSlope(x, z) > 14 || this.hydro.riverDistance(x, z) < 10) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 16)) continue;
      const y = t.getAvgHeight(x, z, 6);
      t.flattenRect(x, z, 8, 6, ang, 4, y);
      fields.push({ x, z, y, yaw: ang });
    }
    this.plans.set(def.id, { center: { x: c.x, z: c.z, y: cy }, buildings: placed, fields });
  }

  plannedCircles(): { x: number; z: number; r: number }[] {
    const out: { x: number; z: number; r: number }[] = [];
    for (const [, p] of this.plans) {
      out.push({ x: p.center.x, z: p.center.z, r: 15 });
      for (const b of p.buildings) out.push({ x: b.x, z: b.z, r: Math.hypot(b.w, b.d) / 2 + 2 });
      for (const f of p.fields) out.push({ x: f.x, z: f.z, r: 9 });
    }
    return out;
  }

  centers(): Map<string, { x: number; z: number; y: number }> {
    const m = new Map<string, { x: number; z: number; y: number }>();
    for (const [id, p] of this.plans) m.set(id, p.center);
    return m;
  }

  /** Phase 2: build meshes and colliders (after all terrain edits). */
  build(def: VillageDef, physics: CollisionWorld, fx: Effects): Village {
    const plan = this.plans.get(def.id)!;
    const rng = new RNG(hashString(def.id) + 99);
    const t = this.terrain;
    const c = plan.center;
    const y0 = t.getHeight(c.x, c.z);
    const v: Village = {
      def, id: def.id, name: def.name, x: c.x, y: y0, z: c.z, radius: 70,
      buildings: [], spots: [], waystone: new Vector3(), board: new Vector3(), fountain: new Vector3(c.x, y0, c.z),
      entrances: [], props: [], windows: null, windowMat: null, state: "peaceful", barricades: null, camp: null, fieldSpots: [],
    };
    const windowParts = new PartBuilder(this.scene);
    plan.buildings.forEach((p, idx) => {
      const y = t.getHeight(p.x, p.z);
      const sb = new StructureBuilder(this.scene, p.x, y, p.z, p.yaw);
      let h = 6;
      if (p.kind === "chapel") {
        buildChapel(sb, rng);
        h = 12;
      } else {
        h = buildHouse(sb, rng, p.kind === "hall" ? "hall" : p.kind, p.w, p.d).h;
        if (p.kind === "inn") buildInnExtras(sb, p.w, p.d);
        if (p.kind === "smithy") buildSmithyExtras(sb, p.w, p.d);
        if (p.kind === "shop") buildMarketStall(sb, 0, p.d / 2 + 3.2, 0, rng.pick(["#a83232", "#3a6ea8", "#c99a2a", "#3d8a4a"]));
        // small props
        if (rng.chance(0.7)) buildBarrel(sb.pb, -p.w / 2 - 0.7, 0, p.d / 2 - 0.5);
        if (rng.chance(0.6)) buildCrate(sb.pb, p.w / 2 + 0.7, 0, p.d / 2 - 1, 0.8, rng.next());
      }
      const res = sb.finish(`bld_${def.id}_${idx}`, physics);
      const b: Building = {
        id: `${def.id}_${idx}`, kind: p.kind, x: p.x, y, z: p.z, yaw: p.yaw, w: p.w, d: p.d, h,
        door: sb.anchors.door ? sb.worldAnchor("door") : new Vector3(p.x, y, p.z),
        mesh: res.mesh, colliders: res.colliders, damaged: false, burning: false, fire: null, smoke: null, sb,
      };
      v.buildings.push(b);
      if (p.kind === "inn") v.inn = b;
      if (p.kind === "smithy") v.smithy = b;
      if (p.kind === "shop") v.shop = b;
      if (p.kind === "chapel") v.chapel = b;
      // window glow quads (lit at night)
      if (p.kind !== "barn") {
        const cs = Math.cos(p.yaw), sn = Math.sin(p.yaw);
        const n = Math.max(1, Math.floor(p.w / 2.6));
        for (let k = 0; k < n; k++) {
          const lx = -p.w / 2 + (p.w / (n + 1)) * (k + 1);
          if (Math.abs(lx) < 0.9) continue;
          const lz = p.d / 2 + 0.09;
          windowParts.box("#ffb347", 0.6, 0.8, 0.02, { pos: [p.x + lx * cs + lz * sn, y + 1.7, p.z - lx * sn + lz * cs], rot: [0, p.yaw, 0] });
        }
      }
      // spots
      const home: Spot = { x: b.door.x, y: b.door.y, z: b.door.z, yaw: p.yaw, kind: "home", building: b };
      v.spots.push(home);
      if (p.kind === "smithy" && sb.anchors.anvil) {
        const a = sb.worldAnchor("anvil");
        v.spots.push({ x: a.x, y: a.y, z: a.z, yaw: p.yaw + Math.PI, kind: "anvil", building: b });
        const f = sb.worldAnchor("forgeFire");
        fx.emitter(f, { rate: 18, color1: new Color4(1, 0.6, 0.2, 1), color2: new Color4(1, 0.3, 0.1, 0.8), size: [0.1, 0.35], life: [0.3, 0.8], speed: [0.3, 1.2], tex: "spark", box: 0.3 });
      }
      if (p.kind === "shop") {
        const w = sb.toWorld(0, p.d / 2 + 2.2);
        v.spots.push({ x: w.x, y, z: w.z, yaw: p.yaw, kind: "stall", building: b });
      }
      if (p.kind === "inn") {
        for (const s of ["seat-1", "seat1"]) {
          if (!sb.anchors[s]) continue;
          const a = sb.worldAnchor(s);
          v.spots.push({ x: a.x, y: a.y, z: a.z, yaw: p.yaw + Math.PI, kind: "sit", building: b });
        }
      }
      if (sb.anchors.chimney && rng.chance(0.6)) {
        b.smoke = fx.emitter(sb.worldAnchor("chimney"), {
          rate: 6, color1: new Color4(0.7, 0.7, 0.72, 0.35), color2: new Color4(0.6, 0.6, 0.62, 0.25), colorDead: new Color4(0.5, 0.5, 0.5, 0),
          size: [0.8, 2.0], life: [3, 6], speed: [0.6, 1.2], tex: "smoke", additive: false, box: 0.2, dir: [new Vector3(0.1, 1, 0), new Vector3(0.4, 1, 0.2)], capacity: 60,
        });
      }
    });
    // plaza features
    const plaza = new StructureBuilder(this.scene, c.x, y0, c.z, 0);
    buildFountain(plaza);
    const wsAng = rng.next() * Math.PI * 2;
    const ws = { x: c.x + Math.sin(wsAng) * 8.5, z: c.z + Math.cos(wsAng) * 8.5 };
    const wsY = t.getHeight(ws.x, ws.z);
    const wsb = new StructureBuilder(this.scene, ws.x, wsY, ws.z, wsAng + Math.PI);
    buildWaystone(wsb);
    wsb.finish(`waystone_${def.id}`, physics);
    v.waystone.set(ws.x, wsY, ws.z);
    const bAng = wsAng + Math.PI * 0.75;
    const bp = { x: c.x + Math.sin(bAng) * 10.5, z: c.z + Math.cos(bAng) * 10.5 };
    const bY = t.getHeight(bp.x, bp.z);
    const bsb = new StructureBuilder(this.scene, bp.x, bY, bp.z, bAng + Math.PI);
    buildQuestBoard(bsb);
    bsb.finish(`board_${def.id}`, physics);
    v.board.set(bp.x, bY, bp.z);
    // benches & lamps around plaza
    for (let k = 0; k < 4; k++) {
      const a = wsAng + Math.PI / 4 + (k * Math.PI) / 2;
      const lx = Math.sin(a) * 6, lz = Math.cos(a) * 6;
      plaza.pb.box(PAL.wood, 1.8, 0.1, 0.5, { pos: [lx, 0.5, lz], rot: [0, a + Math.PI / 2, 0] });
      plaza.pb.box(PAL.woodDark, 0.1, 0.5, 0.4, { pos: [lx + Math.cos(a) * 0.7, 0.25, lz - Math.sin(a) * 0.7] });
      plaza.pb.box(PAL.woodDark, 0.1, 0.5, 0.4, { pos: [lx - Math.cos(a) * 0.7, 0.25, lz + Math.sin(a) * 0.7] });
      v.spots.push({ x: c.x + lx, y: y0, z: c.z + lz, yaw: a + Math.PI, kind: "sit" });
      const la = a + Math.PI / 4;
      const px = Math.sin(la) * 11.5, pz = Math.cos(la) * 11.5;
      const py = t.getHeight(c.x + px, c.z + pz) - y0;
      plaza.pb.cyl(PAL.iron, 3.2, 0.12, 0.16, { pos: [px, py + 1.6, pz] }, 6);
      windowParts.box("#ffcf70", 0.35, 0.45, 0.35, { pos: [c.x + px, y0 + py + 3.3, c.z + pz] });
      plaza.collideCircle(px, pz, 0.2, -2, 3.5);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      v.spots.push({ x: c.x + Math.sin(a) * 3.6, y: y0, z: c.z + Math.cos(a) * 3.6, yaw: a + Math.PI, kind: "social" });
    }
    const pr = plaza.finish(`plaza_${def.id}`, physics);
    if (pr.mesh) v.props.push(pr.mesh);
    // fields
    const fieldPb = new PartBuilder(this.scene);
    for (const f of plan.fields) {
      const fy = t.getHeight(f.x, f.z);
      const cs = Math.cos(f.yaw), sn = Math.sin(f.yaw);
      for (let row = -3; row <= 3; row++) {
        for (let k = -6; k <= 6; k += 1) {
          const lx = row * 2, lz = k * 1.1;
          const wx = f.x + lx * cs + lz * sn, wz = f.z - lx * sn + lz * cs;
          fieldPb.cyl(rng.chance(0.5) ? "#6f8f2f" : "#88a03a", 0.5 + rng.next() * 0.3, 0.1, 0.35, { pos: [wx, t.getHeight(wx, wz) + 0.25, wz] }, 5);
        }
      }
      const corners = [[-8, -7.5], [8, -7.5], [8, 7.5], [-8, 7.5]].map(([lx, lz]) => ({ x: f.x + lx * cs + lz * sn, z: f.z - lx * sn + lz * cs }));
      for (let k = 0; k < 4; k++) {
        if (k === 1) continue; // gap for entry
        const a = corners[k], b = corners[(k + 1) % 4];
        buildFence(fieldPb, a.x, a.z, b.x, b.z, (x, z) => t.getHeight(x, z));
      }
      t.paintSplat(3, f.x, f.z, 9, 0.5, 0.6);
      for (let k = 0; k < 3; k++) {
        const lx = -4 + k * 4;
        const sp: Spot = { x: f.x + lx * cs, y: fy, z: f.z - lx * sn, yaw: f.yaw, kind: "farm" };
        v.spots.push(sp);
        v.fieldSpots.push(sp);
      }
    }
    const fm = fieldPb.merge(`fields_${def.id}`, null);
    if (fm) {
      fm.receiveShadows = true;
      v.props.push(fm);
    }
    // night windows
    const mat = new StandardMaterial(`win_${def.id}`, this.scene);
    mat.diffuseColor = new Color3(0.2, 0.15, 0.1);
    mat.emissiveColor = new Color3(0, 0, 0);
    mat.specularColor = new Color3(0, 0, 0);
    v.windowMat = mat;
    v.windows = windowParts.merge(`windows_${def.id}`, null, mat);
    v.radius = Math.max(60, ...v.buildings.map((b) => Math.hypot(b.x - c.x, b.z - c.z) + 12));
    this.villages.push(v);
    return v;
  }

  /** Evolution helpers ------------------------------------------------------------------- */
  setBarricades(v: Village, on: boolean, physics: CollisionWorld): void {
    if (on && !v.barricades) {
      const pb = new PartBuilder(this.scene);
      for (const e of v.entrances) {
        const y = this.terrain.getHeight(e.x, e.z);
        buildBarricade(pb, e.x + Math.cos(e.yaw) * 2.8, y, e.z - Math.sin(e.yaw) * 2.8, e.yaw);
        buildBarricade(pb, e.x - Math.cos(e.yaw) * 2.8, y, e.z + Math.sin(e.yaw) * 2.8, e.yaw);
        buildCrate(pb, e.x + Math.cos(e.yaw) * 4.6, y, e.z - Math.sin(e.yaw) * 4.6, 0.9, e.yaw);
      }
      v.barricades = pb.merge(`barricade_${v.id}`, null);
      void physics;
    }
    v.barricades?.setEnabled(on);
  }

  setRefugeCamp(v: Village, on: boolean): void {
    if (on && !v.camp) {
      const sb = new StructureBuilder(this.scene, v.x, v.y, v.z, 0);
      const cols = ["#8a6a4a", "#6a7a8a", "#7a5a6a", "#8a8a6a", "#5a7a5a"];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.3;
        const lx = Math.sin(a) * 19, lz = Math.cos(a) * 19;
        const ly = this.terrain.getHeight(v.x + lx, v.z + lz) - v.y;
        buildTent(sb.pb, lx, ly, lz, a, cols[k % cols.length], sb);
      }
      buildCampfire(sb.pb, 0, 0, 7.5);
      const r = sb.finish(`camp_${v.id}`, null);
      v.camp = r.mesh;
    }
    v.camp?.setEnabled(on);
  }
}
