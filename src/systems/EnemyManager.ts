import { Vector3, Color4 } from "@babylonjs/core";
import type { Game } from "../core/Game";
import { Enemy, EnemyKind } from "../entities/Enemy";
import { geoToWorld } from "../world/AndorraData";
import { RNG, hashString } from "../core/MathUtil";
import { StructureBuilder, buildTent, buildCampfire } from "../world/Buildings";

export interface Camp {
  id: string;
  name: string;
  x: number;
  z: number;
  interior: string | null;
  spawns: { kind: EnemyKind; count: number; level?: number }[];
  radius: number;
  enemies: Enemy[];
  active: boolean;
  respawnAt: number; // game minutes
  minDay: number;
  maxDay: number;
  nightOnly?: boolean;
  cleared: boolean;
  props?: boolean;
  quest?: string;
}

interface CampSeed {
  id: string;
  name: string;
  lat?: number;
  lon?: number;
  site?: string;
  offset?: [number, number];
  spawns: { kind: EnemyKind; count: number; level?: number }[];
  minDay?: number;
  maxDay?: number;
  nightOnly?: boolean;
  props?: boolean;
  interior?: string;
  room?: number;
}

const SEEDS: CampSeed[] = [
  // early-game goblins near the roads
  { id: "camp_coll", name: "Goblin camp of Coll d'Ordino", lat: 42.5605, lon: 1.5470, spawns: [{ kind: "goblin", count: 3 }], props: true },
  { id: "camp_massana", name: "Goblin raiders", lat: 42.5335, lon: 1.5040, spawns: [{ kind: "goblin", count: 3 }, { kind: "shaman", count: 1 }], props: true },
  { id: "camp_encamp", name: "Goblin camp of Encamp", lat: 42.5240, lon: 1.5920, spawns: [{ kind: "goblin", count: 4 }], props: true },
  { id: "camp_santjulia", name: "Bandit goblins", lat: 42.4760, lon: 1.5030, spawns: [{ kind: "goblin", count: 3 }, { kind: "shaman", count: 1 }], props: true },
  { id: "camp_soldeu", name: "Goblin camp of Soldeu", lat: 42.5850, lon: 1.6560, spawns: [{ kind: "goblin", count: 4, level: 2 }, { kind: "shaman", count: 1, level: 2 }], props: true },
  { id: "camp_pas", name: "Goblin warband", lat: 42.5500, lon: 1.7180, spawns: [{ kind: "goblin", count: 4, level: 2 }, { kind: "shaman", count: 2, level: 2 }], props: true },
  // wolves in high meadows
  { id: "wolves_tristaina", name: "Wolf pack", lat: 42.6330, lon: 1.4960, spawns: [{ kind: "wolf", count: 3 }] },
  { id: "wolves_sorteny", name: "Wolf pack", lat: 42.6150, lon: 1.5680, spawns: [{ kind: "wolf", count: 3 }] },
  { id: "wolves_madriu", name: "Wolf pack", lat: 42.4980, lon: 1.6200, spawns: [{ kind: "wolf", count: 4, level: 2 }] },
  { id: "wolves_incles", name: "Wolf pack", lat: 42.6000, lon: 1.6950, spawns: [{ kind: "wolf", count: 3, level: 2 }] },
  { id: "wolves_arinsal", name: "Wolf pack", lat: 42.5800, lon: 1.4700, spawns: [{ kind: "wolf", count: 3, level: 2 }] },
  // ruins at night
  { id: "skel_engolasters", name: "Restless dead", site: "ruins_engolasters", offset: [0, 6], spawns: [{ kind: "skeleton", count: 3 }], nightOnly: true },
  { id: "skel_incles", name: "Restless dead", site: "ruins_incles", offset: [0, 5], spawns: [{ kind: "skeleton", count: 3, level: 2 }], nightOnly: true },
  { id: "skel_fortress", name: "Fortress guards", site: "boss_shadow", offset: [0, 40], spawns: [{ kind: "skeleton", count: 3, level: 2 }] },
  { id: "skel_tower", name: "Watchtower dead", site: "ruins_coll", offset: [6, 6], spawns: [{ kind: "skeleton", count: 2 }], nightOnly: true },
  // world gets more dangerous as the cloud advances
  { id: "dark_ordino", name: "Shadow raiders", lat: 42.5640, lon: 1.5210, spawns: [{ kind: "goblin", count: 3, level: 2 }, { kind: "skeleton", count: 2, level: 2 }], minDay: 6, props: true },
  { id: "dark_canillo", name: "Shadow raiders", lat: 42.5600, lon: 1.6120, spawns: [{ kind: "skeleton", count: 3, level: 2 }, { kind: "shaman", count: 1, level: 2 }], minDay: 5 },
  { id: "dark_andorra", name: "Shadow raiders", lat: 42.5150, lon: 1.5340, spawns: [{ kind: "goblin", count: 4, level: 3 }, { kind: "shaman", count: 2, level: 2 }], minDay: 8, props: true },
  { id: "dark_meritxell", name: "Dark knights", lat: 42.5500, lon: 1.5780, spawns: [{ kind: "darkknight", count: 1 }, { kind: "skeleton", count: 2, level: 3 }], minDay: 9 },
  { id: "dark_comapedrosa", name: "Zorg's vanguard", site: "zorgcave", offset: [0, 30], spawns: [{ kind: "darkknight", count: 2 }], minDay: 1 },
  // caves
  { id: "flame_imps1", name: "Fire imps", interior: "flame_cave", room: 1, spawns: [{ kind: "fireimp", count: 3 }] },
  { id: "flame_imps2", name: "Fire imps", interior: "flame_cave", room: 2, spawns: [{ kind: "fireimp", count: 2 }, { kind: "bat", count: 3 }] },
  { id: "frost_imps1", name: "Ice imps", interior: "frost_cave", room: 1, spawns: [{ kind: "iceimp", count: 3 }, { kind: "bat", count: 2 }] },
  { id: "frost_imps2", name: "Ice imps", interior: "frost_cave", room: 2, spawns: [{ kind: "iceimp", count: 2 }, { kind: "skeleton", count: 2, level: 2 }] },
  { id: "zorg_1", name: "Cave bats", interior: "zorg_cave", room: 1, spawns: [{ kind: "bat", count: 4, level: 2 }, { kind: "skeleton", count: 2, level: 3 }] },
  { id: "zorg_2", name: "Dark knights", interior: "zorg_cave", room: 2, spawns: [{ kind: "darkknight", count: 2 }, { kind: "slime", count: 2, level: 2 }] },
  { id: "zorg_3", name: "Throne guards", interior: "zorg_cave", room: 4, spawns: [{ kind: "darkknight", count: 2, level: 2 }] },
  { id: "hidden1_bats", name: "Bats", interior: "hidden1", room: 1, spawns: [{ kind: "bat", count: 3 }] },
  { id: "hidden2_bats", name: "Bats", interior: "hidden2", room: 2, spawns: [{ kind: "bat", count: 2 }, { kind: "skeleton", count: 1 }] },
  { id: "vault_guard", name: "Vault guardians", interior: "vault", room: 1, spawns: [{ kind: "skeleton", count: 3, level: 2 }] },
];

/** Spawns, activates and despawns monster camps; handles dynamic spawns (poison slimes, raids). */
export class EnemyManager {
  camps: Camp[] = [];
  dynamic: Enemy[] = [];
  private slimeTimer = 10;
  private rng = new RNG(31337);

  constructor(private game: Game) {}

  init(): void {
    const g = this.game;
    for (const s of SEEDS) {
      let x = 0, z = 0;
      if (s.interior) {
        const lvl = g.interiors.level(s.interior);
        const p = lvl.roomPos(s.room ?? 1);
        x = p.x;
        z = p.z;
      } else if (s.site) {
        const site = g.world.sites.get(s.site);
        if (!site) continue;
        const ox = s.offset?.[0] ?? 0, oz = s.offset?.[1] ?? 0;
        x = site.x + ox * Math.cos(site.yaw) + oz * Math.sin(site.yaw);
        z = site.z - ox * Math.sin(site.yaw) + oz * Math.cos(site.yaw);
      } else {
        const p = geoToWorld(s.lat!, s.lon!);
        const spot = g.terrain.findFlatSpot(p.x, p.z, 60, 10, 10);
        x = spot.x;
        z = spot.z;
      }
      this.camps.push({
        id: s.id, name: s.name, x, z, interior: s.interior ?? null, spawns: s.spawns, radius: 9, enemies: [], active: false, respawnAt: 0,
        minDay: s.minDay ?? 0, maxDay: s.maxDay ?? 99, nightOnly: s.nightOnly, cleared: false, props: s.props,
      });
    }
    for (const c of this.camps) if (c.props && !c.interior) this.buildCampProps(c);
    g.events.on("parry", (src: any) => {
      if (src && typeof src.stagger === "function") src.stagger();
    });
  }

  private buildCampProps(c: Camp): void {
    const g = this.game;
    const y = g.terrain.getHeight(c.x, c.z);
    const rng = new RNG(hashString(c.id));
    const sb = new StructureBuilder(g.scene, c.x, y, c.z, rng.next() * 6);
    buildCampfire(sb.pb, 0, 0, 0);
    for (let k = 0; k < 2; k++) {
      const a = k * 2.4 + 0.5;
      const lx = Math.sin(a) * 6, lz = Math.cos(a) * 6;
      buildTent(sb.pb, lx, g.terrain.getHeight(c.x + lx, c.z + lz) - y, lz, a, "#5a4a32", sb);
    }
    // crude totem with skull
    sb.pb.cyl("#4a3a28", 3, 0.2, 0.25, { pos: [3.5, 1.5, -3] }, 6);
    sb.pb.sphere("#e0d8c0", 0.45, { pos: [3.5, 3.1, -3] }, 8);
    sb.collideCircle(3.5, -3, 0.3, -2, 3);
    sb.finish("camp_" + c.id, g.physics);
    g.fx.emitter(new Vector3(c.x, y + 0.4, c.z), { rate: 14, color1: new Color4(1, 0.6, 0.2, 1), color2: new Color4(1, 0.3, 0.1, 0.8), size: [0.2, 0.6], life: [0.3, 0.9], speed: [0.5, 1.6], tex: "spark", box: 0.4 });
  }

  private spawnCamp(c: Camp): void {
    const g = this.game;
    const rng = this.rng;
    c.enemies = [];
    for (const s of c.spawns) {
      for (let k = 0; k < s.count; k++) {
        let pos: Vector3;
        if (c.interior) {
          const lvl = g.interiors.level(c.interior);
          let px = c.x, pz = c.z;
          for (let t = 0; t < 10; t++) {
            px = c.x + rng.range(-6, 6);
            pz = c.z + rng.range(-6, 6);
            if (!lvl.isSolid(px, pz)) break;
          }
          pos = new Vector3(px, lvl.floorAt(px, pz), pz);
        } else pos = g.world.randomGroundNear(c.x, c.z, c.radius, rng);
        const lvlBoost = Math.floor(g.time.daysElapsed / 5);
        const e = new Enemy(g, s.kind, pos, c.interior, (s.level ?? 1) + lvlBoost);
        e.campId = c.id;
        c.enemies.push(e);
      }
    }
    c.active = true;
  }

  private despawnCamp(c: Camp): void {
    for (const e of c.enemies) e.dispose();
    c.enemies = [];
    c.active = false;
  }

  /** Spawn an enemy outside the camp system (boss summons, raids). */
  spawn(kind: EnemyKind, pos: Vector3, interior: string | null, level = 1, alerted = true): Enemy {
    const e = new Enemy(this.game, kind, pos, interior, level);
    e.summoned = true;
    if (alerted) e.alert();
    this.dynamic.push(e);
    return e;
  }

  alertNear(pos: Vector3, r: number): void {
    for (const c of this.camps) for (const e of c.enemies) if (e.alive && Math.hypot(e.position.x - pos.x, e.position.z - pos.z) < r) e.alert();
    for (const e of this.dynamic) if (e.alive && Math.hypot(e.position.x - pos.x, e.position.z - pos.z) < r) e.alert();
  }

  all(): Enemy[] {
    const out: Enemy[] = [];
    for (const c of this.camps) out.push(...c.enemies);
    out.push(...this.dynamic);
    return out;
  }

  /** Push the player out of enemy bodies. */
  pushOut(pos: Vector3, r: number): void {
    for (const e of this.all()) {
      if (!e.alive || e.def.flying) continue;
      const dx = pos.x - e.position.x, dz = pos.z - e.position.z;
      const d = Math.hypot(dx, dz);
      const rr = r + e.radius;
      if (d < rr && d > 0.001 && Math.abs(pos.y - e.position.y) < 2) {
        pos.x = e.position.x + (dx / d) * rr;
        pos.z = e.position.z + (dz / d) * rr;
      }
    }
  }

  killAllHostile(): void {
    for (const e of this.dynamic) if (e.alive) e.die();
  }

  update(dt: number): void {
    const g = this.game;
    const p = g.player.position;
    const interior = g.interiors.current?.def.id ?? null;
    const day = g.time.day;
    const night = g.time.isNight;
    for (const c of this.camps) {
      const near = c.interior === interior && Math.hypot(c.x - p.x, c.z - p.z) < (c.interior ? 120 : 170);
      const timeOk = day >= c.minDay && day <= c.maxDay && (!c.nightOnly || night);
      if (!c.active && near && timeOk && g.time.minutes >= c.respawnAt) this.spawnCamp(c);
      else if (c.active && (!near && Math.hypot(c.x - p.x, c.z - p.z) > 260 || c.interior !== interior)) {
        const allDead = c.enemies.every((e) => !e.alive);
        if (allDead) c.respawnAt = Math.max(c.respawnAt, (Math.floor(g.time.minutes / 1440) + 1) * 1440 + 6 * 60); // next dawn
        this.despawnCamp(c);
      }
      if (c.active) {
        for (const e of c.enemies) if (!e.removed) e.update(dt);
        if (!c.cleared && c.enemies.length && c.enemies.every((e) => !e.alive)) {
          c.cleared = true;
          c.respawnAt = (Math.floor(g.time.minutes / 1440) + 1) * 1440 + 6 * 60;
          g.events.emit("campCleared", c);
          g.ui.toast(`${c.name} defeated!`, "good");
        } else if (c.cleared && c.enemies.some((e) => e.alive)) c.cleared = false;
      }
    }
    for (let i = this.dynamic.length - 1; i >= 0; i--) {
      const e = this.dynamic[i];
      if (!e.removed) e.update(dt);
      if (e.removed || (e.interior !== interior && !e.alive)) this.dynamic.splice(i, 1);
      else if (Math.hypot(e.position.x - p.x, e.position.z - p.z) > 300) {
        e.dispose();
        this.dynamic.splice(i, 1);
      }
    }
    // poison slimes emerge from the cloud's edge
    this.slimeTimer -= dt;
    if (this.slimeTimer <= 0 && !interior && g.state === "playing" && g.poison.cleansing < 1) {
      this.slimeTimer = 18 - Math.min(10, g.time.daysElapsed * 0.6);
      const bd = g.poison.borderDist(p.x, p.z);
      const gap = bd - g.poison.threshold;
      const slimes = this.dynamic.filter((e) => e.kind === "slime" && e.alive).length;
      if (gap > 0 && gap < 140 && slimes < 4) {
        // find a point toward the cloud
        for (let k = 0; k < 12; k++) {
          const a = this.rng.next() * Math.PI * 2;
          const x = p.x + Math.sin(a) * 30, z = p.z + Math.cos(a) * 30;
          if (g.poison.borderDist(x, z) < bd) {
            const pos = g.world.randomGroundNear(x, z, 4, this.rng);
            this.spawn("slime", pos, null, 1 + Math.floor(g.time.daysElapsed / 4), true);
            break;
          }
        }
      }
    }
  }

  serialize() {
    return { camps: this.camps.map((c) => ({ id: c.id, respawnAt: c.respawnAt })) };
  }
  deserialize(d: any) {
    if (!d?.camps) return;
    for (const s of d.camps) {
      const c = this.camps.find((c) => c.id === s.id);
      if (c) c.respawnAt = s.respawnAt ?? 0;
    }
    for (const c of this.camps) this.despawnCamp(c);
    for (const e of this.dynamic) e.dispose();
    this.dynamic = [];
  }
}
