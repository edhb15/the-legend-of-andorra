import { Vector3, TransformNode, Color4, ParticleSystem, Mesh } from "@babylonjs/core";
import type { Game } from "../core/Game";
import type { Village, VillageState } from "../world/Villages";
import { PartBuilder } from "../entities/CharacterKit";
import { HOME_VILLAGE } from "../world/AndorraData";
import { RNG, clamp01, damp, dampAngle, smoothstep, yawTo } from "../core/MathUtil";

interface Animal {
  kind: "deer" | "rabbit" | "boar";
  root: TransformNode;
  legs: TransformNode[];
  pos: Vector3;
  yaw: number;
  speed: number;
  fleeing: number;
  t: number;
}

const DAY_LINES: Record<number, string> = {
  1: "The cloud gathers beyond the borders.",
  2: "The cloud creeps into the outer valleys.",
  3: "Shepherds flee the high pastures.",
  4: "The southern valleys begin to choke.",
  5: "Large parts of the countryside are lost.",
  6: "The forests fall silent.",
  7: "Half of Andorra lies beneath the cloud.",
  8: "The cloud reaches the forests and the mountain paths.",
  9: "Villages empty as families flee toward Ordino.",
  10: "The roads are deserted. Only monsters walk them now.",
  11: "Almost all of Andorra is covered.",
  12: "Only the highest valleys still breathe.",
  13: "The last refuge trembles.",
  14: "The final day. Everything will be consumed.",
};

/** Makes the world change with every passing day. */
export class WorldEvolutionSystem {
  skyDoom = 0;
  aggression = 1;
  private villageT = 0;
  private animals: Animal[] = [];
  private animalT = 2;
  private birds: { root: TransformNode; t: number; r: number; h: number; c: Vector3 }[] = [];
  private fires = new Map<string, ParticleSystem[]>();
  private rng = new RNG(777);
  private lastAnnounced = 0;

  constructor(private game: Game) {}

  init(): void {
    const g = this.game;
    g.events.on("newDay", (d: number) => this.onNewDay(d));
    g.events.on("doom", () => void g.cinematics.doom());
    // bird flocks
    for (let k = 0; k < 3; k++) {
      const root = new TransformNode("flock", g.scene);
      const pb = new PartBuilder(g.scene);
      for (let b = 0; b < 7; b++) {
        pb.box("#2a2a2a", 0.9, 0.05, 0.3, { pos: [(b % 3) * 2 - 2, Math.sin(b) * 0.8, Math.floor(b / 3) * 1.8], rot: [0, 0, 0.3] });
      }
      pb.merge("birds", root);
      this.birds.push({ root, t: k * 2, r: 60 + k * 20, h: 45 + k * 10, c: new Vector3() });
    }
  }

  stateFor(v: Village): VillageState {
    const g = this.game;
    const day = g.time.day;
    if (g.victory > 0) return v.id === HOME_VILLAGE ? "refuge" : "peaceful";
    if (v.id === HOME_VILLAGE) return day >= 8 ? "refuge" : day >= 5 ? "fearful" : day >= 2 ? "worried" : "peaceful";
    const cover = g.poison.coverageAt(v.x, v.z);
    const until = g.poison.daysUntilCovered(v.x, v.z) + (v.saved ? 0.6 : 0);
    if (cover > 0.5) return "abandoned";
    if (until < 1.2) return "evacuating";
    if (until < 3.5 || day >= 6) return "fearful";
    if (day >= 2) return "worried";
    return "peaceful";
  }

  refreshNow(): void {
    this.villageT = 0;
    this.update(0);
    // after a time skip (sleep, fast travel, loading) villagers of lost villages are already at the refuge
    const g = this.game;
    const home = g.world.homeVillage();
    const rng = new RNG(Math.floor(g.time.minutes));
    for (const n of g.npcs.npcs) {
      if (n.fixed || n.evacuated || n.rig) continue;
      const st = n.current.state;
      if ((st === "abandoned" || st === "evacuating") && n.current.id !== HOME_VILLAGE) {
        n.evacuated = true;
        n.current = home;
        const a = rng.next() * Math.PI * 2, d = rng.range(12, 22);
        n.position.set(home.x + Math.sin(a) * d, 0, home.z + Math.cos(a) * d);
        n.position.y = g.terrain.getHeight(n.position.x, n.position.z);
        n.thinkT = 0;
      }
    }
  }

  private applyState(v: Village, s: VillageState): void {
    const g = this.game;
    const prev = v.state;
    v.state = s;
    g.world.villageBuilder.setBarricades(v, (s === "fearful" || s === "evacuating" || s === "refuge") && g.victory === 0, g.physics);
    if (v.id === HOME_VILLAGE) g.world.villageBuilder.setRefugeCamp(v, s === "refuge");
    for (const b of v.buildings) {
      if (b.smoke) b.smoke.emitRate = s === "abandoned" ? 0 : 6;
    }
    if (s === "abandoned" && prev !== "abandoned") {
      // fires & damaged buildings, new treasure
      if (!this.fires.has(v.id)) {
        const list: ParticleSystem[] = [];
        v.buildings.forEach((b, i) => {
          if (i % 3 !== 0) return;
          b.burning = true;
          const p = new Vector3(b.x, b.y + b.h * 0.7, b.z);
          list.push(g.fx.emitter(p, { rate: 45, color1: new Color4(1, 0.55, 0.15, 1), color2: new Color4(1, 0.25, 0.05, 0.8), colorDead: new Color4(0.2, 0.05, 0, 0), size: [0.6, 1.8], life: [0.4, 1.0], speed: [1.5, 3.5], tex: "spark", box: b.w * 0.35, boxY: 0.5, capacity: 120 }));
          list.push(g.fx.emitter(p.add(new Vector3(0, 2, 0)), { rate: 10, color1: new Color4(0.15, 0.13, 0.13, 0.6), color2: new Color4(0.25, 0.22, 0.22, 0.4), colorDead: new Color4(0.1, 0.1, 0.1, 0), size: [2, 5], life: [3, 6], speed: [1.5, 3], tex: "smoke", additive: false, box: 1, capacity: 60 }));
          if (b.mesh) b.mesh.rotation.z = 0.04;
        });
        this.fires.set(v.id, list);
      }
      g.treasure.revealAbandoned(v.id);
      if (g.state === "playing") g.ui.toast(`${v.name} has been abandoned to the cloud.`, "warn");
    }
    if (s === "evacuating" && prev !== "evacuating" && g.state === "playing" && g.time.minutes > g.time.startMinutes + 60) g.ui.toast(`The people of ${v.name} are fleeing toward Ordino.`, "warn");
    if (g.victory > 0 && this.fires.has(v.id)) {
      for (const f of this.fires.get(v.id)!) f.emitRate = 0;
    }
  }

  private onNewDay(d: number): void {
    const g = this.game;
    if (d > 14 || g.victory > 0 || d <= this.lastAnnounced) return;
    this.lastAnnounced = d;
    const left = 15 - d;
    g.ui.bigTitle(`DAY ${d}`, `${DAY_LINES[d] ?? ""}  ${left > 1 ? left + " days remain" : "Final day"}`, d >= 11 ? "#ff6a8a" : d >= 6 ? "#e8a06a" : "#e8c66a", 4.5);
    g.audio.sfx("dayBell");
    g.save.autosave("day");
  }

  update(dt: number): void {
    const g = this.game;
    const p = g.time.doomProgress;
    const target = (smoothstep(0.02, 1, p) * 0.92) * (1 - g.victory);
    this.skyDoom = damp(this.skyDoom, target, 1, Math.max(dt, 0.016));
    this.aggression = 1 + p * 0.8;
    g.audio.setDarkness(g.victory > 0 ? 0 : p);
    this.villageT -= dt;
    if (this.villageT <= 0) {
      this.villageT = 3;
      for (const v of g.world.villages) {
        const s = this.stateFor(v);
        if (s !== v.state || (!v.barricades && (s === "fearful" || s === "evacuating"))) this.applyState(v, s);
      }
    }
    this.updateAnimals(dt);
    this.updateBirds(dt);
  }

  // ------------------------------------------------------------------ wildlife
  private makeAnimal(kind: Animal["kind"], pos: Vector3): Animal {
    const g = this.game;
    const root = new TransformNode("animal", g.scene);
    const pb = new PartBuilder(g.scene);
    const legs: TransformNode[] = [];
    const s = kind === "deer" ? 1 : kind === "boar" ? 0.7 : 0.3;
    const col = kind === "deer" ? "#8a5a32" : kind === "boar" ? "#4a3a2a" : "#9a8a7a";
    pb.capsule(col, 1.3 * s, 0.32 * s, { pos: [0, 1.0 * s, 0], rot: [Math.PI / 2, 0, 0] });
    pb.box(col, 0.28 * s, 0.3 * s, 0.45 * s, { pos: [0, 1.35 * s, 0.75 * s], rot: [-0.4, 0, 0] });
    if (kind === "deer") {
      pb.cyl("#d8c8a0", 0.5, 0.03, 0.05, { pos: [-0.12, 1.75, 0.65], rot: [0, 0, 0.4] }, 4);
      pb.cyl("#d8c8a0", 0.5, 0.03, 0.05, { pos: [0.12, 1.75, 0.65], rot: [0, 0, -0.4] }, 4);
      pb.sphere("#f0f0f0", 0.16, { pos: [0, 1.05, -0.65] }, 6);
    }
    if (kind === "rabbit") {
      pb.box(col, 0.06, 0.3, 0.1, { pos: [-0.05, 1.65 * s + 0.12, 0.7 * s] });
      pb.box(col, 0.06, 0.3, 0.1, { pos: [0.05, 1.65 * s + 0.12, 0.7 * s] });
    }
    pb.merge("animalBody", root);
    for (const [x, z] of [[-0.18, 0.45], [0.18, 0.45], [-0.18, -0.45], [0.18, -0.45]]) {
      const leg = new TransformNode("leg", g.scene);
      leg.parent = root;
      leg.position.set(x * s, 0.85 * s, z * s);
      pb.capsule(col, 0.85 * s, 0.05 * s, { pos: [0, -0.4 * s, 0] });
      pb.merge("leg", leg);
      legs.push(leg);
    }
    return { kind, root, legs, pos, yaw: this.rng.next() * 6.28, speed: 0, fleeing: 0, t: 0 };
  }

  private updateAnimals(dt: number): void {
    const g = this.game;
    const pp = g.player.position;
    const outdoors = !g.interiors.current;
    this.animalT -= dt;
    const maxAnimals = Math.round(8 * (1 - g.time.doomProgress * 0.85));
    if (this.animalT <= 0 && outdoors) {
      this.animalT = 4;
      if (this.animals.length < maxAnimals) {
        const a = this.rng.next() * Math.PI * 2, d = this.rng.range(50, 90);
        const x = pp.x + Math.sin(a) * d, z = pp.z + Math.cos(a) * d;
        if (g.terrain.inBounds(x, z) && g.poison.coverageAt(x, z) < 0.1 && g.terrain.getSlope(x, z) < 30 && !g.world.excluded(x, z, 2) && g.terrain.getHeight(x, z) < 470) {
          const kind = this.rng.chance(0.5) ? "deer" : this.rng.chance(0.6) ? "rabbit" : "boar";
          this.animals.push(this.makeAnimal(kind, new Vector3(x, g.terrain.getHeight(x, z), z)));
        }
      }
    }
    for (let i = this.animals.length - 1; i >= 0; i--) {
      const an = this.animals[i];
      an.t += dt;
      const d = Math.hypot(an.pos.x - pp.x, an.pos.z - pp.z);
      if (d > 140 || !outdoors) {
        an.root.dispose();
        this.animals.splice(i, 1);
        continue;
      }
      // flee from the player and from the cloud
      const cover = g.poison.coverageAt(an.pos.x, an.pos.z);
      const gap = g.poison.borderDist(an.pos.x, an.pos.z) - g.poison.threshold;
      let wantYaw = an.yaw;
      let sp = 0;
      if (d < (g.player.sprinting ? 22 : 12)) {
        an.fleeing = 3;
        wantYaw = yawTo(pp.x, pp.z, an.pos.x, an.pos.z);
      } else if (gap < 60 || cover > 0.1) {
        an.fleeing = 2;
        // move up the distance field gradient (away from the cloud)
        const e = 10;
        const gx = g.poison.borderDist(an.pos.x + e, an.pos.z) - g.poison.borderDist(an.pos.x - e, an.pos.z);
        const gz = g.poison.borderDist(an.pos.x, an.pos.z + e) - g.poison.borderDist(an.pos.x, an.pos.z - e);
        wantYaw = Math.atan2(gx, gz);
      }
      if (an.fleeing > 0) {
        an.fleeing -= dt;
        sp = an.kind === "rabbit" ? 6 : an.kind === "deer" ? 9 : 6.5;
      } else if (Math.sin(an.t * 0.3 + i) > 0.6) sp = 1.2;
      an.speed = damp(an.speed, sp, 4, dt);
      an.yaw = dampAngle(an.yaw, wantYaw + (an.fleeing > 0 ? 0 : Math.sin(an.t * 0.2) * 0.5), 3, dt);
      an.pos.x += Math.sin(an.yaw) * an.speed * dt;
      an.pos.z += Math.cos(an.yaw) * an.speed * dt;
      an.pos.y = g.terrain.getHeight(an.pos.x, an.pos.z);
      an.root.position.copyFrom(an.pos);
      an.root.rotation.y = an.yaw;
      const ph = an.t * (4 + an.speed * 1.5);
      const amp = clamp01(an.speed / 4) * 0.7;
      an.legs[0].rotation.x = Math.sin(ph) * amp;
      an.legs[3].rotation.x = Math.sin(ph) * amp;
      an.legs[1].rotation.x = -Math.sin(ph) * amp;
      an.legs[2].rotation.x = -Math.sin(ph) * amp;
      if (an.kind === "rabbit") an.root.position.y += Math.abs(Math.sin(ph)) * 0.25 * amp;
    }
  }

  private updateBirds(dt: number): void {
    const g = this.game;
    const pp = g.player.position;
    const show = !g.interiors.current && g.time.daylight > 0.2 && g.time.doomProgress < 0.85;
    for (const b of this.birds) {
      b.t += dt * 0.25;
      b.root.setEnabled(show);
      if (!show) continue;
      if (Math.hypot(b.c.x - pp.x, b.c.z - pp.z) > 300) b.c.set(pp.x + this.rng.range(-120, 120), 0, pp.z + this.rng.range(-120, 120));
      // birds avoid the cloud: drift their centre away
      if (g.poison.coverageAt(b.c.x, b.c.z) > 0.2) b.c.x += (pp.x - b.c.x) * 0.02;
      const y = g.terrain.getHeight(b.c.x, b.c.z) + b.h;
      b.root.position.set(b.c.x + Math.sin(b.t) * b.r, y, b.c.z + Math.cos(b.t) * b.r);
      b.root.rotation.y = b.t + Math.PI / 2;
      b.root.getChildMeshes().forEach((m) => ((m as Mesh).rotation.z = Math.sin(g.elapsed * 10) * 0.3));
    }
  }

  serialize() {
    return { lastAnnounced: this.lastAnnounced };
  }
  deserialize(d: any) {
    this.lastAnnounced = d?.lastAnnounced ?? 0;
    for (const v of this.game.world.villages) v.state = "peaceful";
    this.refreshNow();
  }
}
