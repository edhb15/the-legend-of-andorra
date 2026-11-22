import { Mesh, Vector3, Color4, MeshBuilder, StandardMaterial, Color3, PointLight } from "@babylonjs/core";
import type { Game } from "../core/Game";
import { WORLD } from "../config";
import { loadElevation } from "./terrain/HeightSources";
import { VILLAGES, LOCATIONS, ROADS, PEAKS, geoToWorld, borderWorld, HOME_VILLAGE } from "./AndorraData";
import { VillageBuilder, Village } from "./Villages";
import { RoadPlanner, Road, buildRoadMeshes } from "./Roads";
import { Vegetation } from "./Vegetation";
import { buildWater, waterMaterial } from "./Water";
import {
  StructureBuilder, buildBridge, buildStoneBridge, buildCaveEntrance, buildFortress, buildHiddenForge, buildRuins, buildWatchtower,
  buildStele, buildStandingStones, buildChapel, PAL,
} from "./Buildings";
import { PartBuilder, glowMaterial } from "../entities/CharacterKit";
import { RNG, pointInPolygon, distToSegment, smoothstep } from "../core/MathUtil";
import { NOISE } from "../core/Noise";

export interface Site {
  id: string;
  name: string;
  kind: string;
  x: number;
  y: number;
  z: number;
  r: number;
  yaw: number;
  anchors: Record<string, Vector3>;
}

const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 0));

export class WorldManager {
  villageBuilder: VillageBuilder;
  villages: Village[] = [];
  sites = new Map<string, Site>();
  roads: Road[] = [];
  vegetation: Vegetation;
  border: Float32Array;
  private planner: RoadPlanner;
  private cullables: { mesh: Mesh; x: number; z: number; r: number }[] = [];
  private roadMask: Uint8Array;
  private readonly rmW = WORLD.width / 5;
  private readonly rmH = WORLD.depth / 5;
  private exclusions: { x: number; z: number; r: number }[] = [];
  waterMeshes: Mesh[] = [];
  private overworldMeshes: Mesh[] = [];
  private hidden = false;

  constructor(private game: Game) {
    this.villageBuilder = new VillageBuilder(game.scene, game.terrain, game.hydro);
    this.planner = new RoadPlanner(game.terrain, game.hydro);
    this.vegetation = new Vegetation(game.scene, game.terrain, game.physics);
    this.vegetation.setQuality(game.settings.quality);
    this.border = borderWorld();
    this.roadMask = new Uint8Array(this.rmW * this.rmH);
  }

  isInsideAndorra(x: number, z: number): boolean {
    return pointInPolygon(x, z, this.border);
  }

  /** Distance (m) from a point to the Andorran border (positive inside). */
  borderDistance(x: number, z: number): number {
    let d = Infinity;
    const b = this.border;
    const n = b.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      d = Math.min(d, distToSegment(x, z, b[i * 2], b[i * 2 + 1], b[j * 2], b[j * 2 + 1]));
    }
    return this.isInsideAndorra(x, z) ? d : -d;
  }

  site(id: string): Site {
    const s = this.sites.get(id);
    if (!s) throw new Error("No site " + id);
    return s;
  }

  village(id: string): Village {
    const v = this.villages.find((v) => v.id === id);
    if (!v) throw new Error("No village " + id);
    return v;
  }

  homeVillage(): Village {
    return this.village(HOME_VILLAGE);
  }

  private markRoad(x: number, z: number, r: number): void {
    const i0 = Math.floor((x - r + WORLD.halfW) / 5), i1 = Math.ceil((x + r + WORLD.halfW) / 5);
    const j0 = Math.floor((z - r + WORLD.halfD) / 5), j1 = Math.ceil((z + r + WORLD.halfD) / 5);
    for (let j = Math.max(0, j0); j <= Math.min(this.rmH - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(this.rmW - 1, i1); i++) this.roadMask[j * this.rmW + i] = 1;
  }
  onRoad(x: number, z: number): boolean {
    const i = Math.floor((x + WORLD.halfW) / 5), j = Math.floor((z + WORLD.halfD) / 5);
    if (i < 0 || j < 0 || i >= this.rmW || j >= this.rmH) return false;
    return this.roadMask[j * this.rmW + i] === 1;
  }

  /** Placement exclusion for vegetation & scatter. */
  excluded(x: number, z: number, r: number): boolean {
    if (this.onRoad(x, z)) return true;
    for (const e of this.exclusions) if (Math.abs(e.x - x) < e.r + r && Math.abs(e.z - z) < e.r + r && Math.hypot(e.x - x, e.z - z) < e.r + r) return true;
    if (this.game.hydro.isLake(x, z)) return true;
    if (this.game.hydro.riverDistance(x, z) < 1.5 + r) return true;
    return false;
  }

  async build(progress: (f: number, label: string) => void): Promise<void> {
    const g = this.game;
    const t = g.terrain;
    const res = await loadElevation({ key: g.settings.maptilerKey, source: g.settings.terrainSource }, progress);
    g.terrainSource = res.source;
    g.terrainNote = res.note ?? "";
    progress(0.18, "Finding the mountain lakes…");
    await yieldFrame();
    g.hydro.detectLakes(res.elev);
    t.setElevation(res.elev);
    g.hydro.carveLakes();
    progress(0.24, "Tracing the rivers of the Valira…");
    await yieldFrame();
    g.hydro.computeRivers();
    progress(0.32, "Founding the villages…");
    await yieldFrame();
    for (const v of VILLAGES) this.villageBuilder.plan(v);
    this.exclusions.push(...this.villageBuilder.plannedCircles());
    progress(0.38, "Raising ancient ruins and fortresses…");
    await yieldFrame();
    this.planSites();
    progress(0.44, "Laying the old roads…");
    await yieldFrame();
    this.planner.insideBorder = (x, z) => this.isInsideAndorra(x, z);
    this.planner.prepare();
    for (const c of this.exclusions) this.planner.blockCircle(c.x, c.z, Math.max(0, c.r - 4));
    const centers = this.villageBuilder.centers();
    for (const [id] of centers) {
      const c = centers.get(id)!;
      this.planner.unblockCircle(c.x, c.z, 16);
    }
    for (const [a, b] of ROADS) {
      const A = centers.get(a)!, B = centers.get(b)!;
      const path = this.planner.findPath(A.x, A.z, B.x, B.z, false);
      if (path) this.roads.push(this.planner.layRoad(path, 3.4, "road"));
      await yieldFrame();
    }
    progress(0.52, "Marking mountain trails…");
    const trails: [string, string][] = [
      ["santjulia", "boss_flame"], ["andorra", "boss_shadow"], ["encamp", "boss_forest"], ["canillo", "boss_frost"],
      ["pasdelacasa", "boss_thunder"], ["arinsal", "zorgcave"], ["ordino", "ruins_coll"], ["soldeu", "ruins_incles"],
      ["andorra", "ruins_engolasters"], ["canillo", "waterfall"], ["elserrat", "tristaina"], ["canillo", "meritxell"],
    ];
    for (const [a, b] of trails) {
      const A = centers.get(a)!;
      const s = this.sites.get(b);
      if (!s) continue;
      const tx = s.x + Math.sin(s.yaw) * (s.r + 4), tz = s.z + Math.cos(s.yaw) * (s.r + 4);
      this.planner.unblockCircle(tx, tz, 6);
      const path = this.planner.findPath(A.x, A.z, tx, tz, true);
      if (path) this.roads.push(this.planner.layRoad(path, 2.2, "trail"));
      await yieldFrame();
    }
    for (const r of this.roads) for (const p of r.pts) this.markRoad(p.x, p.z, r.width * 0.5 + 1);
    progress(0.6, "Carving the riverbeds…");
    await yieldFrame();
    g.hydro.carveRivers();
    progress(0.64, "Growing the forests…");
    await yieldFrame();
    this.vegetation.exclude = (x, z, r) => this.excluded(x, z, r);
    this.vegetation.computeForest();
    this.vegetation.scatter();
    this.vegetation.onNearMesh = (m) => {
      if (g.settings.quality === "high") g.env.addCaster(m, false);
    };
    progress(0.72, "Shaping the land…");
    await yieldFrame();
    t.createMaterial();
    t.uploadSplat();
    t.buildChunks();
    t.shadowCasterHook = null;
    progress(0.76, "Building the villages…");
    await yieldFrame();
    for (const v of VILLAGES) {
      const village = this.villageBuilder.build(v, g.physics, g.fx);
      this.villages.push(village);
      for (const b of village.buildings) if (b.mesh) this.cull(b.mesh, b.x, b.z, 1300);
      for (const m of village.props) this.cull(m, village.x, village.z, 900);
      if (village.windows) this.cull(village.windows, village.x, village.z, 1300);
    }
    // village entrances = where roads leave the village
    for (const v of this.villages) {
      for (const r of this.roads) {
        if (r.kind !== "road") continue;
        for (let k = 1; k < r.pts.length; k++) {
          const a = r.pts[k - 1], b = r.pts[k];
          const da = Math.hypot(a.x - v.x, a.z - v.z), db = Math.hypot(b.x - v.x, b.z - v.z);
          const R = Math.min(v.radius, 48);
          if ((da < R) !== (db < R)) v.entrances.push({ x: b.x, z: b.z, yaw: Math.atan2(b.x - a.x, b.z - a.z) });
        }
      }
    }
    progress(0.8, "Raising bridges, ruins and the hidden forge…");
    await yieldFrame();
    this.buildBridges();
    this.buildSites();
    this.overworldMeshes.push(...buildRoadMeshes(g.scene, this.roads, t));
    this.waterMeshes = buildWater(g.scene, g.hydro);
    this.overworldMeshes.push(...this.waterMeshes);
    for (const v of this.villages) {
      for (const b of v.buildings) if (b.mesh) this.overworldMeshes.push(b.mesh);
      this.overworldMeshes.push(...v.props);
      if (v.windows) this.overworldMeshes.push(v.windows);
    }
    progress(0.84, "The world of Andorra is ready");
  }

  private cull(mesh: Mesh, x: number, z: number, r: number): void {
    this.cullables.push({ mesh, x, z, r });
  }

  // ------------------------------------------------------------------ sites
  private addSite(id: string, name: string, kind: string, x: number, z: number, r: number, yaw: number): Site {
    const s: Site = { id, name, kind, x, y: this.game.terrain.getHeight(x, z), z, r, yaw, anchors: {} };
    this.sites.set(id, s);
    this.exclusions.push({ x, z, r: r + 3 });
    return s;
  }

  private downhillYaw(x: number, z: number): number {
    const n = this.game.terrain.getNormal(x, z);
    return Math.atan2(n.x, n.z);
  }

  private planSites(): void {
    const t = this.game.terrain;
    for (const loc of LOCATIONS) {
      const p = geoToWorld(loc.lat, loc.lon);
      if (loc.kind === "lake") {
        // snap to the nearest detected lake
        let best = null as null | { x: number; z: number; r: number };
        let bd = 400;
        for (const l of this.game.hydro.lakes) {
          const d = Math.hypot(l.x - p.x, l.z - p.z);
          if (d < bd) {
            bd = d;
            best = { x: l.x, z: l.z, r: l.radius };
          }
        }
        const s = best ?? { x: p.x, z: p.z, r: 20 };
        const site: Site = { id: loc.id, name: loc.name, kind: "lake", x: s.x, y: t.getHeight(s.x, s.z), z: s.z, r: s.r, yaw: 0, anchors: {} };
        this.sites.set(loc.id, site);
        continue;
      }
      const isCave = loc.kind === "cave" || loc.id === "boss_flame" || loc.id === "boss_frost" || loc.kind === "zorg";
      if (isCave) {
        // find a spot with a moderate slope so the cave digs into the mountain
        let best = { x: p.x, z: p.z, score: Infinity };
        for (let dz = -110; dz <= 110; dz += 10)
          for (let dx = -110; dx <= 110; dx += 10) {
            const x = p.x + dx, z = p.z + dz;
            const sl = t.getSlope(x, z);
            const score = Math.abs(sl - 26) + Math.hypot(dx, dz) * 0.05;
            if (score < best.score) best = { x, z, score };
          }
        const yaw = this.downhillYaw(best.x, best.z);
        const y = t.getHeight(best.x, best.z);
        // pad in front of the mouth
        const fx = best.x + Math.sin(yaw) * 5, fz = best.z + Math.cos(yaw) * 5;
        t.flattenCircle(fx, fz, 6, 6, y);
        t.flattenCircle(best.x, best.z, 3.5, 3, y);
        this.addSite(loc.id, loc.name, isCave ? "cave" : loc.kind, best.x, best.z, 7, yaw).y = y;
        continue;
      }
      let footprint = 16, flattenR = 14, blend = 12, search = 160;
      if (loc.id === "boss_forest") (footprint = 28), (flattenR = 27), (blend = 22), (search = 220);
      if (loc.id === "boss_shadow") (footprint = 32), (flattenR = 33), (blend = 24), (search = 200);
      if (loc.id === "boss_thunder") (footprint = 22), (flattenR = 24), (blend = 18), (search = 40);
      if (loc.id === "forge") (footprint = 12), (flattenR = 12), (blend = 10), (search = 120);
      if (loc.id === "waterfall") (footprint = 14), (flattenR = 0), (blend = 0), (search = 140);
      if (loc.id === "meritxell") (footprint = 14), (flattenR = 13), (blend = 9), (search = 90);
      if (loc.id === "margineda") (footprint = 6), (flattenR = 0), (search = 10);
      const spot = t.findFlatSpot(p.x, p.z, search, footprint, search > 60 ? 10 : 5);
      let y = t.getAvgHeight(spot.x, spot.z, footprint * 0.5);
      if (loc.id === "boss_thunder") y = t.getHeight(p.x, p.z) - 4;
      if (flattenR > 0) t.flattenCircle(spot.x, spot.z, flattenR, blend, y);
      const yaw = this.downhillYaw(spot.x, spot.z + 0.01);
      const s = this.addSite(loc.id, loc.name, loc.kind, spot.x, spot.z, flattenR || footprint, yaw);
      s.y = y;
      if (loc.id === "boss_forest" || loc.id === "boss_shadow" || loc.id === "boss_thunder") t.paintSplat(3, spot.x, spot.z, flattenR * 0.8, 0.35, 0.8);
    }
    // peaks for the map / discovery
    for (const pk of PEAKS) {
      const p = geoToWorld(pk.lat, pk.lon);
      this.sites.set("peak_" + pk.id, { id: "peak_" + pk.id, name: pk.name, kind: "peak", x: p.x, y: t.getHeight(p.x, p.z), z: p.z, r: 30, yaw: 0, anchors: {} });
    }
  }

  private buildSites(): void {
    const g = this.game;
    const sc = g.scene;
    const rng = new RNG(4242);
    for (const s of this.sites.values()) {
      s.y = g.terrain.getHeight(s.x, s.z);
      switch (s.id) {
        case "boss_flame":
        case "boss_frost":
        case "zorgcave":
        case "cave_hidden1":
        case "cave_hidden2": {
          const theme = s.id === "boss_flame" ? "fire" : s.id === "boss_frost" ? "ice" : s.id === "zorgcave" ? "dark" : "earth";
          const sb = new StructureBuilder(sc, s.x, s.y, s.z, s.yaw);
          buildCaveEntrance(sb, rng, theme);
          const r = sb.finish("cave_" + s.id, g.physics);
          if (r.mesh) this.addOverworld(r.mesh, s.x, s.z, 1500);
          s.anchors.mouth = sb.worldAnchor("mouth");
          if (theme === "fire") g.fx.emitter(new Vector3(s.x, s.y + 6, s.z), { rate: 8, color1: new Color4(0.3, 0.25, 0.25, 0.5), color2: new Color4(0.2, 0.15, 0.15, 0.4), size: [2, 5], life: [4, 8], speed: [0.5, 1.5], tex: "smoke", additive: false, box: 2, capacity: 60 });
          if (theme === "dark") g.fx.emitter(new Vector3(s.x, s.y + 3, s.z), { rate: 14, color1: new Color4(0.5, 0.1, 0.7, 0.7), color2: new Color4(0.2, 0.6, 0.2, 0.5), size: [0.5, 1.6], life: [2, 4], speed: [0.2, 1], box: 3, capacity: 80 });
          if (theme === "ice") g.fx.emitter(new Vector3(s.x, s.y + 4, s.z), { rate: 12, color1: new Color4(0.8, 0.9, 1, 0.8), color2: new Color4(0.6, 0.8, 1, 0.6), size: [0.05, 0.15], life: [2, 4], speed: [0.3, 1], gravity: -1, box: 5, capacity: 80 });
          break;
        }
        case "boss_shadow": {
          const sb = new StructureBuilder(sc, s.x, s.y, s.z, s.yaw);
          buildFortress(sb, rng, 28);
          const r = sb.finish("fortress", g.physics);
          if (r.mesh) this.addOverworld(r.mesh, s.x, s.z, 1600);
          s.r = 24;
          break;
        }
        case "boss_forest": {
          const pb = new PartBuilder(sc);
          for (let k = 0; k < 11; k++) {
            const a = (k / 11) * Math.PI * 2 + rng.next() * 0.2;
            const R = 27 + rng.next() * 4;
            const x = s.x + Math.sin(a) * R, z = s.z + Math.cos(a) * R;
            const y = g.terrain.getHeight(x, z);
            const sz = 1.6 + rng.next() * 0.7;
            pb.cyl("#4a3a28", 14 * sz, 1.4 * sz, 2.6 * sz, { pos: [x, y + 7 * sz, z] }, 9);
            for (let q = 0; q < 4; q++) pb.cyl("#4a3a28", 4 * sz, 0.3 * sz, 0.9 * sz, { pos: [x + Math.sin(q * 1.6) * 1.8 * sz, y + 0.6, z + Math.cos(q * 1.6) * 1.8 * sz], rot: [Math.cos(q * 1.6) * 1.1, 0, -Math.sin(q * 1.6) * 1.1] }, 6);
            pb.ico("#2f5a24", 6 * sz, { pos: [x, y + 15 * sz, z], scale: [1, 0.75, 1] }, 1, 0.15);
            pb.ico("#3a6a2c", 4 * sz, { pos: [x + 3 * sz, y + 13 * sz, z + 2 * sz] }, 1, 0.15);
            g.physics.addCircle(x, z, 1.4 * sz, y - 2, y + 30, "structure");
          }
          // mossy altar stones
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2;
            const x = s.x + Math.sin(a) * 9, z = s.z + Math.cos(a) * 9;
            const y = g.terrain.getHeight(x, z);
            pb.box("#5d6b4c", 1.0, 2.2, 0.7, { pos: [x, y + 1.0, z], rot: [0, a, 0.05] });
            g.physics.addCircle(x, z, 0.6, y - 2, y + 2.2, "structure");
          }
          const m = pb.merge("elderGrove", null, glowFreeMat(g))!;
          m.receiveShadows = true;
          this.addOverworld(m, s.x, s.z, 1800);
          // glowing motes
          g.fx.emitter(new Vector3(s.x, s.y + 3, s.z), { rate: 10, color1: new Color4(0.5, 1, 0.4, 1), color2: new Color4(0.9, 1, 0.5, 0.8), size: [0.05, 0.18], life: [3, 6], speed: [0.1, 0.4], box: 20, boxY: 3, capacity: 80 });
          s.r = 24;
          break;
        }
        case "boss_thunder": {
          const sb = new StructureBuilder(sc, s.x, s.y, s.z, 0);
          buildStandingStones(sb, rng, 21, 9);
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * Math.PI * 2 + 0.4;
            sb.pb.cyl("#b87333", 7, 0.15, 0.25, { pos: [Math.sin(a) * 15, 3.5, Math.cos(a) * 15] }, 6);
            sb.pb.sphere("#d4a017", 0.6, { pos: [Math.sin(a) * 15, 7.1, Math.cos(a) * 15] }, 8);
            sb.collideCircle(Math.sin(a) * 15, Math.cos(a) * 15, 0.3, -2, 7);
          }
          const r = sb.finish("summit", g.physics);
          if (r.mesh) this.addOverworld(r.mesh, s.x, s.z, 2500);
          s.r = 19;
          break;
        }
        case "forge": {
          const sb = new StructureBuilder(sc, s.x, s.y, s.z, s.yaw);
          buildHiddenForge(sb, rng);
          const r = sb.finish("forge", g.physics);
          if (r.mesh) this.addOverworld(r.mesh, s.x, s.z, 1400);
          for (const k of ["chimney", "forgeFire", "anvil", "smith"]) s.anchors[k] = sb.worldAnchor(k);
          // tall smoke column visible from afar - a clue
          g.fx.emitter(s.anchors.chimney, { rate: 9, color1: new Color4(0.65, 0.62, 0.6, 0.45), color2: new Color4(0.5, 0.5, 0.5, 0.35), colorDead: new Color4(0.4, 0.4, 0.4, 0), size: [2, 5], life: [7, 12], speed: [1.5, 2.5], tex: "smoke", additive: false, box: 0.4, dir: [new Vector3(0, 1, 0), new Vector3(0.3, 1, 0.15)], capacity: 120 });
          g.fx.emitter(s.anchors.forgeFire, { rate: 20, color1: new Color4(1, 0.6, 0.2, 1), color2: new Color4(1, 0.3, 0.1, 0.8), size: [0.1, 0.4], life: [0.3, 0.9], speed: [0.4, 1.5], tex: "spark", box: 0.5 });
          const fl = new PointLight("forgeLight", s.anchors.forgeFire.add(new Vector3(0, 1, 0)), sc);
          fl.diffuse = new Color3(1, 0.55, 0.2);
          fl.intensity = 1.6;
          fl.range = 18;
          break;
        }
        case "ruins_engolasters":
        case "ruins_incles": {
          const sb = new StructureBuilder(sc, s.x, s.y, s.z, s.yaw);
          buildRuins(sb, rng, s.id === "ruins_incles" ? 0.8 : 1.1);
          const r = sb.finish("ruins_" + s.id, g.physics);
          if (r.mesh) this.addOverworld(r.mesh, s.x, s.z, 1200);
          s.anchors.altar = sb.worldAnchor("altar");
          break;
        }
        case "ruins_coll": {
          const sb = new StructureBuilder(sc, s.x, s.y, s.z, s.yaw);
          buildWatchtower(sb, rng);
          const r = sb.finish("tower", g.physics);
          if (r.mesh) this.addOverworld(r.mesh, s.x, s.z, 1500);
          break;
        }
        case "meritxell": {
          const sb = new StructureBuilder(sc, s.x, s.y, s.z, s.yaw + Math.PI);
          buildChapel(sb, rng);
          const r = sb.finish("meritxell", g.physics);
          if (r.mesh) this.addOverworld(r.mesh, s.x, s.z, 1400);
          break;
        }
        case "waterfall":
          this.buildWaterfall(s, rng);
          break;
        default:
          break;
      }
    }
  }

  private buildWaterfall(s: Site, rng: RNG): void {
    const g = this.game;
    const sc = g.scene;
    // A rock cliff with a cascade falling into a pool; a hidden alcove lies behind the water.
    const y = g.terrain.getHeight(s.x, s.z);
    g.terrain.flattenCircle(s.x, s.z, 7, 4, y - 1.2, "lower");
    const sb = new StructureBuilder(sc, s.x, y, s.z, s.yaw + Math.PI);
    const pb = sb.pb;
    for (let k = -4; k <= 4; k++) {
      if (Math.abs(k) <= 1) continue;
      for (let h = 0; h < 4; h++) pb.ico(rng.chance(0.5) ? "#6f6a62" : "#5d5850", 2.2 + rng.next(), { pos: [k * 1.9, h * 3.2 + 1, -7 - rng.next()], scale: [1, 1.1, 0.9] }, 1, 0.1);
    }
    for (let k = -1; k <= 1; k++) pb.ico("#5d5850", 2.4, { pos: [k * 1.9, 12.2, -7.5] }, 1, 0.1);
    pb.ico("#5d5850", 3, { pos: [0, 6, -10.5], scale: [2, 2.5, 1] }, 1, 0.1);
    // alcove floor behind the falls
    pb.box("#4f4a44", 5, 0.4, 3, { pos: [0, 0.2, -8.3] });
    sb.collideBox(-6, -7.2, 3.6, 1.6, 0, -2, 14);
    sb.collideBox(6, -7.2, 3.6, 1.6, 0, -2, 14);
    sb.collideBox(0, -10.5, 4, 1.2, 0, -2, 14);
    sb.anchor("alcove", 0, 0.4, -8.3);
    sb.anchor("pool", 0, 0, -3);
    const r = sb.finish("waterfall", g.physics);
    if (r.mesh) this.addOverworld(r.mesh, s.x, s.z, 1300);
    s.anchors.alcove = sb.worldAnchor("alcove");
    // falling water sheet
    const sheet = MeshBuilder.CreatePlane("falls", { width: 3.4, height: 12 }, sc);
    const a = sb.worldAnchor("pool");
    const fallPos = sb.toWorld(0, -6.2);
    sheet.position.set(fallPos.x, y + 6.2, fallPos.z);
    sheet.rotation.y = s.yaw + Math.PI;
    const mat = waterMaterial(sc, false);
    mat.alpha = 0.7;
    sheet.material = mat;
    this.addOverworld(sheet, s.x, s.z, 1300);
    // pool
    const pool = MeshBuilder.CreateDisc("pool", { radius: 5, tessellation: 24 }, sc);
    pool.rotation.x = Math.PI / 2;
    pool.position.set(a.x, y - 0.4, a.z);
    pool.material = waterMaterial(sc, false);
    this.addOverworld(pool, s.x, s.z, 1300);
    g.fx.emitter(new Vector3(fallPos.x, y + 0.5, fallPos.z), { rate: 40, color1: new Color4(0.9, 0.95, 1, 0.5), color2: new Color4(0.8, 0.9, 1, 0.3), size: [0.6, 1.8], life: [0.8, 1.8], speed: [0.5, 2], tex: "smoke", additive: false, box: 1.5, capacity: 120 });
    g.fx.emitter(new Vector3(fallPos.x, y + 11, fallPos.z), { rate: 30, color1: new Color4(1, 1, 1, 0.6), color2: new Color4(0.8, 0.9, 1, 0.4), size: [0.2, 0.5], life: [0.8, 1.2], speed: [0.2, 0.5], gravity: -12, box: 1.4, boxY: 0.1, capacity: 80 });
  }

  private buildBridges(): void {
    const g = this.game;
    const marg = this.sites.get("margineda");
    for (const r of this.roads) {
      let k = 0;
      while (k < r.pts.length) {
        if (!r.pts[k].river) {
          k++;
          continue;
        }
        let e = k;
        while (e < r.pts.length && r.pts[e].river) e++;
        const a = r.pts[Math.max(0, k - 1)], b = r.pts[Math.min(r.pts.length - 1, e)];
        const len = Math.hypot(b.x - a.x, b.z - a.z) + 2.5;
        const yaw = Math.atan2(b.x - a.x, b.z - a.z);
        const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
        const yA = g.terrain.getHeight(a.x, a.z), yB = g.terrain.getHeight(b.x, b.z);
        const base = Math.min(yA, yB);
        const water = g.hydro.waterLevel(cx, cz);
        const lift = Number.isFinite(water) ? Math.max(0, water + 0.9 - Math.max(yA, yB)) : 0;
        const sb = new StructureBuilder(g.scene, cx, base, cz, yaw);
        const stone = marg && Math.hypot(marg.x - cx, marg.z - cz) < 260 && r.kind === "road";
        if (stone) {
          buildStoneBridge(sb, len, r.width + 1.4, yA - base + lift, yB - base + lift);
          if (marg) {
            marg.x = cx;
            marg.z = cz;
            marg.y = base;
          }
        } else buildBridge(sb, len, r.width + (r.kind === "road" ? 0.8 : 0.4), yA - base + lift, yB - base + lift);
        const res = sb.finish("bridge", g.physics);
        if (res.mesh) this.addOverworld(res.mesh, cx, cz, 900);
        k = e + 1;
      }
    }
  }

  private addOverworld(m: Mesh, x: number, z: number, r: number): void {
    this.overworldMeshes.push(m);
    this.cull(m, x, z, r);
  }

  /** Hide the overworld when entering a cave (performance + correctness). */
  setOverworldVisible(v: boolean): void {
    this.hidden = !v;
    for (const m of this.overworldMeshes) m.setEnabled(v);
    this.vegetation.setVisible(v);
    this.game.terrain.setVisible(v);
  }

  onQualityChanged(): void {
    this.vegetation.setQuality(this.game.settings.quality);
  }

  private cullTimer = 0;
  update(dt: number, cam: Vector3): void {
    if (this.hidden) return;
    const p = this.game.player ? this.game.player.position : cam;
    this.vegetation.update(dt, cam, p);
    this.cullTimer -= dt;
    if (this.cullTimer <= 0) {
      this.cullTimer = 0.5;
      for (const c of this.cullables) {
        const d = Math.hypot(c.x - cam.x, c.z - cam.z);
        const want = d < c.r;
        if (c.mesh.isEnabled() !== want) c.mesh.setEnabled(want);
      }
      // night windows
      const night = 1 - this.game.env.daylight;
      for (const v of this.villages) {
        if (!v.windowMat) continue;
        const lit = v.state === "abandoned" ? 0 : night;
        v.windowMat.emissiveColor.set(1.0 * lit, 0.68 * lit, 0.3 * lit);
      }
    }
  }

  /** Small helper used by several systems: a random point near (x,z) on walkable ground. */
  randomGroundNear(x: number, z: number, r: number, rng: RNG): Vector3 {
    for (let k = 0; k < 20; k++) {
      const a = rng.next() * Math.PI * 2, d = rng.next() * r;
      const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
      if (this.game.terrain.getSlope(px, pz) < 35 && !this.game.hydro.isLake(px, pz) && this.game.hydro.riverDistance(px, pz) > 2) {
        return new Vector3(px, this.game.physics.groundHeight(px, pz, 1e5), pz);
      }
    }
    return new Vector3(x, this.game.physics.groundHeight(x, z, 1e5), z);
  }
}

let gfm: StandardMaterial | null = null;
function glowFreeMat(g: Game): StandardMaterial {
  if (!gfm) {
    gfm = new StandardMaterial("groveMat", g.scene);
    gfm.diffuseColor = new Color3(1, 1, 1);
    gfm.specularColor = new Color3(0.03, 0.03, 0.03);
  }
  return gfm;
}

void glowMaterial;
void NOISE;
void smoothstep;
void PAL;
void buildStele;
