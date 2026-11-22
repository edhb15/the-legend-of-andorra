import { Vector3, Color4, Color3, MeshBuilder, Mesh, StandardMaterial, TransformNode } from "@babylonjs/core";
import type { Game } from "../../core/Game";
import { Boss, BossAttack } from "./Boss";
import { PartBuilder, glowMaterial } from "../CharacterKit";
import { Humanoid } from "../Humanoid";
import { buildWeapon } from "../Props";
import { clamp01, damp, dampAngle, yawTo, wrapAngle, easeInOut, lerp } from "../../core/MathUtil";

// =================================================================================================
// 1. THE FLAME BEAST — Fire — Red shard
// =================================================================================================
export class FlameBeast extends Boss {
  private breathFx: any = null;
  constructor(game: Game) {
    super(game, { id: "flame", name: "The Flame Beast", title: "Fury of the Black Peak", shard: "red", hp: 900, radius: 2.6, height: 5, interior: "flame_cave" });
    this.moveSpeed = 4.2;
    this.preferredDist = 7;
    this.poiseMax = 10;
    this.build();
  }

  build(): void {
    const s = this.game.scene;
    const pb = new PartBuilder(s);
    const rock = "#2b1b17", rock2 = "#3a241d", horn = "#d8cfb8";
    const body = this.mk("body", null, 0, 3.1, 0);
    pb.capsule(rock, 5.4, 1.65, { rot: [Math.PI / 2, 0, 0] }, 10);
    pb.sphere(rock2, 3.6, { pos: [0, 0.6, 1.4] }, 10);
    pb.sphere(rock2, 2.6, { pos: [0, 1.3, 0.2] }, 8);
    for (let k = 0; k < 7; k++) pb.cone("#1a100d", 0.9, 0.6, { pos: [0, 1.6 + Math.sin(k) * 0.2, 1.6 - k * 0.6], rot: [-0.3, 0, 0] }, 5);
    this.merge(pb, "fbBody", body);
    // lava cracks
    for (let k = 0; k < 16; k++) {
      const a = this.rng.range(-2.2, 2.2), zz = this.rng.range(-2.2, 2.2);
      this.glow("#ff5a10", "box", [0.08, this.rng.range(0.5, 1.4), 0.08], body, [Math.sin(a) * 1.62, Math.cos(a) * 1.3, zz], 1.6).rotation.set(this.rng.range(-1, 1), 0, this.rng.range(-1, 1));
    }
    const head = this.mk("head", body, 0, 0.7, 3.0);
    pb.box(rock, 1.7, 1.5, 1.9, {});
    pb.box(rock2, 1.3, 0.6, 1.4, { pos: [0, -0.7, 0.5] });
    pb.cone(horn, 2.2, 0.55, { pos: [-1.1, 0.9, -0.2], rot: [-0.5, 0, 0.9] }, 6);
    pb.cone(horn, 2.2, 0.55, { pos: [1.1, 0.9, -0.2], rot: [-0.5, 0, -0.9] }, 6);
    pb.cone(horn, 1.2, 0.35, { pos: [-1.9, 1.7, 0.3], rot: [0.9, 0, 0.3] }, 5);
    pb.cone(horn, 1.2, 0.35, { pos: [1.9, 1.7, 0.3], rot: [0.9, 0, -0.3] }, 5);
    for (let k = 0; k < 5; k++) pb.cone("#e8e0c8", 0.3, 0.1, { pos: [-0.5 + k * 0.25, -0.45, 1.0], rot: [Math.PI, 0, 0] }, 4);
    this.merge(pb, "fbHead", head);
    this.glow("#ffd21a", "sphere", 0.28, head, [-0.5, 0.25, 0.95], 2.2);
    this.glow("#ffd21a", "sphere", 0.28, head, [0.5, 0.25, 0.95], 2.2);
    this.parts.mouth = this.glow("#ff7a1a", "box", [0.9, 0.2, 0.3], head, [0, -0.35, 0.98], 1.2) as any;
    for (const [n, x, z] of [["lf", -1.2, 1.9], ["rf", 1.2, 1.9], ["lb", -1.2, -1.9], ["rb", 1.2, -1.9]] as [string, number, number][]) {
      const leg = this.mk(n, body, x, -0.3, z);
      pb.capsule(rock, 3.1, 0.55, { pos: [0, -1.3, 0] }, 8);
      pb.box("#150c0a", 0.9, 0.3, 1.1, { pos: [0, -2.75, 0.2] });
      this.merge(pb, "leg" + n, leg);
      this.glow("#ff5a10", "box", [0.07, 1.2, 0.07], leg, [0.45, -1.4, 0.3], 1.4);
    }
    const tail = this.mk("tail", body, 0, 0.4, -2.8);
    pb.cone(rock, 3, 0.8, { pos: [0, -0.3, -1.3], rot: [-Math.PI / 2 - 0.4, 0, 0] }, 6);
    this.merge(pb, "tailM", tail);
    this.game.fx.emitter(body as any, { rate: 25, color1: new Color4(1, 0.55, 0.15, 1), color2: new Color4(1, 0.25, 0.05, 0.8), size: [0.15, 0.5], life: [0.6, 1.4], speed: [0.5, 2], tex: "spark", box: 1.6, capacity: 80, gravity: 2 });
  }

  protected chooseAttack(dist: number): BossAttack | null {
    const opts: [string, number][] = [["fireballs", 3], ["eruptions", 2.5], ["breath", dist < 13 ? 3 : 1]];
    if (dist < 6) opts.push(["stomp", 4]);
    if (this.phase >= 2) opts.push(["charge", dist > 8 ? 3 : 1]);
    const total = opts.reduce((s, o) => s + o[1], 0);
    let r = this.rng.next() * total;
    let pick = opts[0][0];
    for (const [n, w] of opts) {
      r -= w;
      if (r <= 0) {
        pick = n;
        break;
      }
    }
    const durs: Record<string, number> = { fireballs: 1.7, eruptions: 2.3, breath: 3.4, stomp: 1.4, charge: 2.4 };
    return this.startAttack(pick, durs[pick] / (this.phase === 3 ? 1.15 : 1));
  }

  protected runAttack(dt: number, a: BossAttack, k: number): void {
    const g = this.game;
    const p = g.player.position;
    const dmg = 18 * this.rage;
    switch (a.name) {
      case "fireballs": {
        this.faceP(dt, 3);
        if (this.once(a, "fx", k, 0.05)) g.audio.sfx("bossGrowl", this.position);
        if (this.once(a, "fire", k, 0.45)) {
          const n = this.phase === 1 ? 1 : this.phase === 2 ? 3 : 5;
          for (let i = 0; i < n; i++) {
            const off = (i - (n - 1) / 2) * 3.5;
            const tgt = p.add(new Vector3(Math.cos(this.yaw) * off, 0.2, -Math.sin(this.yaw) * off));
            g.combat.spawnProjectile({ from: this.forward(3.6, 0, 3.6), target: tgt, speed: 15, damage: dmg, owner: "enemy", element: "fire", color: "#ff6a1a", size: 1.1, gravity: 14, arc: true, aoe: 2.8 });
          }
          g.audio.sfx("fireball", this.position);
        }
        break;
      }
      case "eruptions": {
        if (this.once(a, "start", k, 0.1)) {
          const n = this.phase === 1 ? 3 : this.phase === 2 ? 5 : 8;
          g.audio.sfx("bossRoar", this.position);
          for (let i = 0; i < n; i++) {
            const x = i === 0 ? p.x : this.arenaCenter.x + this.rng.range(-this.arenaR * 0.8, this.arenaR * 0.8);
            const z = i === 0 ? p.z : this.arenaCenter.z + this.rng.range(-this.arenaR * 0.8, this.arenaR * 0.8);
            g.combat.delayedStrike(x, z, {
              radius: 3.2, delay: 1.1 + i * 0.12, damage: dmg * 1.1, element: "fire", color: "#ff4a10", knock: 8,
              onStrike: (pos) => {
                g.fx.burst(pos.add(new Vector3(0, 0.5, 0)), { count: 60, color1: new Color4(1, 0.6, 0.1, 1), color2: new Color4(1, 0.2, 0, 1), size: [0.3, 1.2], speed: [6, 14], life: [0.4, 1], tex: "spark", dir: new Vector3(0, 3, 0), spread: 0.4, gravity: -6 });
                g.fx.flashLight(pos.add(new Vector3(0, 2, 0)), new Color3(1, 0.5, 0.1), 3, 14, 0.4);
                g.audio.sfx("explosion", pos);
                g.camera.shake(0.25);
              },
            });
          }
        }
        break;
      }
      case "breath": {
        const head = this.parts.head;
        if (k < 0.3) {
          this.faceP(dt, 3);
          head.rotation.x = -k * 1.2;
          (this.parts.mouth as unknown as Mesh).scaling.setAll(1 + k * 4);
        } else if (k < 0.88) {
          head.rotation.x = damp(head.rotation.x, 0.15, 8, dt);
          this.faceP(dt, this.phase === 3 ? 1.4 : 0.9);
          if (!this.breathFx) {
            this.breathFx = g.fx.emitter(this.parts.mouth as any, { rate: 260, color1: new Color4(1, 0.65, 0.15, 1), color2: new Color4(1, 0.25, 0.05, 0.9), colorDead: new Color4(0.2, 0.05, 0.05, 0), size: [0.4, 1.6], life: [0.4, 0.7], speed: [16, 22], tex: "spark", box: 0.2, capacity: 300 });
            g.audio.sfx("fireBreath", this.position);
          }
          const dir = new Vector3(Math.sin(this.yaw), -0.2, Math.cos(this.yaw));
          this.breathFx.direction1 = dir.add(new Vector3(-0.25, -0.05, -0.25));
          this.breathFx.direction2 = dir.add(new Vector3(0.25, 0.1, 0.25));
          if (Math.floor(a.t * 5) !== a.data.tick) {
            a.data.tick = Math.floor(a.t * 5);
            g.combat.coneHitPlayer(this.position, this.yaw, 0.45, 15, dmg * 0.45, "fire", this);
          }
        } else if (this.breathFx) {
          this.breathFx.stop();
          this.breathFx.disposeOnStop = true;
          this.breathFx = null;
          (this.parts.mouth as unknown as Mesh).scaling.setAll(1);
        }
        break;
      }
      case "stomp": {
        this.parts.body.rotation.x = k < 0.45 ? -easeInOut(k / 0.45) * 0.5 : -0.5 * (1 - clamp01((k - 0.45) * 8));
        if (this.once(a, "slam", k, 0.5)) {
          g.combat.aoeHitPlayer(this.position, 5.5, dmg, { element: "fire", knockback: 9 });
          g.combat.shockwave(this.position.x, this.position.y, this.position.z, { maxR: 14, speed: 12, damage: dmg * 0.7, element: "fire", color: "#ff5a10" });
          g.fx.burst(this.forward(2.5), { count: 50, color1: new Color4(0.5, 0.35, 0.3, 1), color2: new Color4(1, 0.4, 0.1, 1), tex: "smoke", size: [0.6, 1.8], additive: false, speed: [3, 7] });
          g.camera.shake(0.7);
          g.audio.sfx("slam", this.position);
        }
        break;
      }
      case "charge": {
        if (k < 0.3) {
          this.faceP(dt, 6);
          if (this.once(a, "tele", k, 0.02)) {
            g.fx.telegraph(this.position.x, this.position.z, { radius: 26, delay: 0.7, shape: "rect", width: 5, length: 26, yaw: this.yaw, color: "#ff4a10" });
            g.audio.sfx("bossGrowl", this.position);
          }
        } else if (k < 0.75) {
          const sp = 24;
          this.velocity.set(Math.sin(this.yaw) * sp, 0, Math.cos(this.yaw) * sp);
          if (!a.data.hit && Math.hypot(p.x - this.position.x, p.z - this.position.z) < this.radius + 1.5) {
            a.data.hit = g.combat.aoeHitPlayer(this.position, this.radius + 1.5, dmg * 1.4, { element: "fire", knockback: 12 });
          }
          if (Math.floor(a.t * 10) % 2 === 0) g.fx.burst(this.position.add(new Vector3(0, 0.5, 0)), { count: 6, color1: new Color4(1, 0.5, 0.1, 1), tex: "spark", speed: [1, 3] });
        } else this.velocity.scaleInPlace(0.85);
        break;
      }
    }
    // phase 3: lava pools
    if (this.phase === 3 && this.once(a, "lava", k, 0.5)) {
      const x = this.arenaCenter.x + this.rng.range(-this.arenaR * 0.7, this.arenaR * 0.7);
      const z = this.arenaCenter.z + this.rng.range(-this.arenaR * 0.7, this.arenaR * 0.7);
      g.combat.hazard(x, z, { radius: 3, dps: 14, element: "fire", life: 8, color: "#ff4a10" });
    }
  }

  protected animate(dt: number, moving: number): void {
    const P = this.parts;
    const ph = this.t * (2 + moving * 0.8);
    const amp = Math.min(1, moving / 3) * 0.5;
    P.lf.rotation.x = Math.sin(ph) * amp;
    P.rb.rotation.x = Math.sin(ph) * amp;
    P.rf.rotation.x = -Math.sin(ph) * amp;
    P.lb.rotation.x = -Math.sin(ph) * amp;
    P.body.position.y = 3.1 + Math.sin(this.t * 1.5) * 0.06 + Math.abs(Math.sin(ph)) * amp * 0.2;
    P.tail.rotation.y = Math.sin(this.t * 2) * 0.35;
    if (!this.attack || this.attack.name !== "breath") P.head.rotation.x = damp(P.head.rotation.x, Math.sin(this.t) * 0.08, 5, dt);
    if (this.state === "dormant") {
      P.body.rotation.x = 0.25;
      P.head.rotation.x = 0.5;
    } else if (!this.attack || this.attack.name !== "stomp") P.body.rotation.x = damp(P.body.rotation.x, this.state === "stagger" ? 0.3 : 0, 4, dt);
  }
}

// =================================================================================================
// 2. THE FOREST GUARDIAN — Nature — Green shard
// =================================================================================================
export class ForestGuardian extends Boss {
  private sprouts: any[] = [];
  constructor(game: Game) {
    super(game, { id: "forest", name: "The Forest Guardian", title: "Elder of the Madriu Woods", shard: "green", hp: 1000, radius: 2.2, height: 8, interior: null });
    this.moveSpeed = 3;
    this.preferredDist = 6;
    this.poiseMax = 12;
    this.build();
  }

  build(): void {
    const s = this.game.scene;
    const pb = new PartBuilder(s);
    const bark = "#4d3a26", bark2 = "#3a2c1c", moss = "#3f6a2a", leaf = "#2e6a26", leaf2 = "#4a8a32";
    const trunk = this.mk("trunk", null, 0, 2.4, 0);
    pb.cyl(bark, 5.2, 2.0, 2.8, { pos: [0, 2.2, 0] }, 9);
    pb.cyl(bark2, 1.0, 2.6, 3.0, { pos: [0, -0.2, 0] }, 9);
    for (let k = 0; k < 6; k++) pb.box(moss, 0.8, 0.5, 0.2, { pos: [Math.sin(k) * 1.1, 1 + k * 0.6, Math.cos(k) * 1.1], rot: [0, k, 0] });
    pb.box("#120a06", 1.0, 0.35, 0.3, { pos: [0, 2.6, 1.15] });
    this.merge(pb, "trunkM", trunk);
    this.glow("#7dff4a", "sphere", 0.38, trunk, [-0.45, 3.5, 1.1], 2.2);
    this.glow("#7dff4a", "sphere", 0.38, trunk, [0.45, 3.5, 1.1], 2.2);
    const crown = this.mk("crown", trunk, 0, 5.0, 0);
    pb.ico(leaf, 2.8, { pos: [0, 1.2, 0], scale: [1.2, 0.9, 1.2] }, 1, 0.15);
    pb.ico(leaf2, 2.0, { pos: [1.8, 0.6, 0.6] }, 1, 0.15);
    pb.ico(leaf, 2.0, { pos: [-1.8, 0.8, -0.4] }, 1, 0.15);
    pb.ico(leaf2, 1.6, { pos: [0.2, 2.6, -0.6] }, 1, 0.15);
    for (let k = 0; k < 5; k++) pb.cyl(bark2, 2.2, 0.12, 0.3, { pos: [Math.sin(k * 1.3) * 1.2, 0.3, Math.cos(k * 1.3) * 1.2], rot: [Math.cos(k * 1.3) * 0.7, 0, -Math.sin(k * 1.3) * 0.7] }, 5);
    this.merge(pb, "crownM", crown);
    for (const side of [-1, 1]) {
      const sh = this.mk(side < 0 ? "shL" : "shR", trunk, side * 1.3, 4.0, 0);
      pb.cyl(bark, 2.8, 0.45, 0.7, { pos: [0, -1.4, 0] }, 6);
      pb.ico(leaf2, 0.6, { pos: [side * 0.3, -0.5, 0.2] }, 0);
      this.merge(pb, "upper", sh);
      const el = this.mk(side < 0 ? "elL" : "elR", sh, 0, -2.8, 0);
      pb.cyl(bark, 2.6, 0.35, 0.5, { pos: [0, -1.3, 0] }, 6);
      pb.ico(bark2, 0.85, { pos: [0, -2.7, 0] }, 1, 0.2);
      for (let k = 0; k < 4; k++) pb.cone(bark2, 0.9, 0.22, { pos: [Math.sin(k * 1.6) * 0.5, -3.2, Math.cos(k * 1.6) * 0.5], rot: [Math.PI + Math.cos(k * 1.6) * 0.5, 0, Math.sin(k * 1.6) * 0.5] }, 4);
      this.merge(pb, "fore", el);
    }
    for (const side of [-1, 1]) {
      const leg = this.mk(side < 0 ? "legL" : "legR", null, side * 0.9, 2.4, 0);
      pb.cyl(bark2, 2.6, 0.7, 1.0, { pos: [0, -1.2, 0] }, 7);
      for (let k = 0; k < 3; k++) pb.cone(bark2, 1.6, 0.4, { pos: [side * 0.4 + Math.sin(k * 2.1) * 0.6, -2.2, Math.cos(k * 2.1) * 0.6], rot: [Math.cos(k * 2.1) * 1.1, 0, -Math.sin(k * 2.1) * 1.1 + side * 0.3] }, 4);
      this.merge(pb, "legM", leg);
    }
    this.game.fx.emitter(crown as any, { rate: 10, color1: new Color4(0.6, 1, 0.4, 1), color2: new Color4(1, 1, 0.6, 0.8), size: [0.06, 0.18], life: [1.5, 3], speed: [0.2, 0.8], box: 3, capacity: 60 });
  }

  protected chooseAttack(dist: number): BossAttack | null {
    const sproutsAlive = this.sprouts.filter((s) => s.alive).length;
    const opts: [string, number][] = [["roots", 3], ["punch", dist < 8 ? 4 : 0.5]];
    if (sproutsAlive < (this.phase === 1 ? 2 : 3)) opts.push(["summon", 2]);
    if (this.phase >= 2) opts.push(["sweep", dist < 9 ? 3 : 0.5]);
    if (this.phase >= 3) opts.push(["spores", 2]);
    const total = opts.reduce((s, o) => s + o[1], 0);
    let r = this.rng.next() * total;
    let pick = opts[0][0];
    for (const [n, w] of opts) {
      r -= w;
      if (r <= 0) {
        pick = n;
        break;
      }
    }
    const durs: Record<string, number> = { roots: 2.2, punch: 1.7, summon: 2.0, sweep: 1.9, spores: 1.6 };
    return this.startAttack(pick, durs[pick] / (this.phase === 3 ? 1.15 : 1));
  }

  protected runAttack(dt: number, a: BossAttack, k: number): void {
    const g = this.game;
    const p = g.player.position;
    const dmg = 17 * this.rage;
    const P = this.parts;
    switch (a.name) {
      case "punch": {
        this.faceP(dt, k < 0.45 ? 3 : 0.5);
        P.shR.rotation.x = k < 0.45 ? lerp(0, -2.6, easeInOut(k / 0.45)) : lerp(-2.6, -0.6, clamp01((k - 0.45) * 6));
        P.elR.rotation.x = k < 0.45 ? -0.8 : -0.1;
        if (this.once(a, "hit", k, 0.55)) {
          const fist = this.forward(5.5);
          g.combat.meleeHitPlayer(this.position, this.yaw, 7, 1.4, dmg * 1.3, { knockback: 10, element: "nature", source: this });
          g.combat.shockwave(fist.x, this.position.y, fist.z, { maxR: 8, speed: 10, damage: dmg * 0.5, element: "nature", color: "#7dff4a" });
          g.fx.burst(fist.add(new Vector3(0, 0.5, 0)), { count: 40, color1: new Color4(0.45, 0.35, 0.25, 1), color2: new Color4(0.3, 0.5, 0.2, 1), tex: "smoke", additive: false, size: [0.5, 1.5], speed: [2, 6] });
          g.camera.shake(0.6);
          g.audio.sfx("slam", fist);
        }
        break;
      }
      case "roots": {
        P.shL.rotation.x = -2.2 * Math.sin(k * Math.PI);
        P.shR.rotation.x = -2.2 * Math.sin(k * Math.PI);
        if (this.once(a, "go", k, 0.15)) {
          g.audio.sfx("roots", this.position);
          const n = this.phase === 1 ? 3 : this.phase === 2 ? 5 : 7;
          for (let i = 0; i < n; i++) {
            const lead = i === 0 ? 0 : 1;
            const x = p.x + (lead ? this.rng.range(-6, 6) : 0), z = p.z + (lead ? this.rng.range(-6, 6) : 0);
            g.combat.delayedStrike(x, z, {
              radius: 2.4, delay: 1.0 + i * 0.15, damage: dmg, element: "nature", color: "#4aff3a", knock: 3,
              onStrike: (pos) => {
                this.rootSpikes(pos);
                if (Math.hypot(g.player.position.x - pos.x, g.player.position.z - pos.z) < 2.6) g.player.rootPlayer(1.5);
              },
            });
          }
        }
        break;
      }
      case "summon": {
        P.crown.rotation.y += dt * 3;
        if (this.once(a, "go", k, 0.5)) {
          const n = this.phase === 1 ? 2 : 3;
          for (let i = 0; i < n; i++) {
            const ang = this.rng.next() * Math.PI * 2;
            const x = this.arenaCenter.x + Math.sin(ang) * this.arenaR * 0.6, z = this.arenaCenter.z + Math.cos(ang) * this.arenaR * 0.6;
            const y = g.physics.groundHeight(x, z, 1e5);
            g.fx.burst(new Vector3(x, y + 0.5, z), { count: 30, color1: new Color4(0.4, 1, 0.3, 1), color2: new Color4(0.8, 1, 0.5, 1), size: [0.1, 0.4], speed: [1, 4] });
            this.sprouts.push(g.enemies.spawn("sprout", new Vector3(x, y, z), null, 2));
          }
          g.audio.sfx("summon", this.position);
        }
        break;
      }
      case "sweep": {
        if (k < 0.4) {
          this.faceP(dt, 3);
          P.shR.rotation.z = lerp(0, 1.5, k / 0.4);
          P.shR.rotation.x = -0.4;
          if (this.once(a, "tele", k, 0.05)) g.fx.telegraph(this.position.x, this.position.z, { radius: 8, delay: 0.7, shape: "cone", angle: 2.3, yaw: this.yaw, color: "#4aff3a" });
        } else {
          this.root.rotation.y = this.yaw + lerp(0, -4.2, easeInOut((k - 0.4) / 0.4));
          if (this.once(a, "hit", k, 0.55)) {
            g.combat.meleeHitPlayer(this.position, this.yaw, 8, 4.6, dmg * 1.2, { knockback: 11, element: "nature", unblockable: false, source: this });
            g.audio.sfx("swingHeavy", this.position);
          }
          if (k > 0.85) P.shR.rotation.z = damp(P.shR.rotation.z, 0, 8, dt);
        }
        break;
      }
      case "spores": {
        if (this.once(a, "go", k, 0.4)) {
          for (let i = 0; i < 3; i++) {
            const x = p.x + this.rng.range(-8, 8), z = p.z + this.rng.range(-8, 8);
            g.combat.hazard(x, z, { radius: 3.5, dps: 9, element: "poison", life: 7, color: "#5a8a2a" });
          }
          g.audio.sfx("magicCast", this.position);
        }
        break;
      }
    }
  }

  private rootSpikes(pos: Vector3): void {
    const g = this.game;
    const pb = new PartBuilder(g.scene);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      pb.cone("#4a3a24", 2.6, 0.45, { pos: [Math.sin(a) * 1.1, 1.0, Math.cos(a) * 1.1], rot: [Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4] }, 5);
    }
    pb.cone("#3a2c1c", 3.2, 0.6, { pos: [0, 1.4, 0] }, 5);
    const m = pb.merge("spikes", null)!;
    m.position.copyFrom(pos);
    m.scaling.y = 0.01;
    g.fx.animateMesh(m, 1.8, (k, mm) => {
      mm.scaling.y = k < 0.15 ? k / 0.15 : k > 0.75 ? Math.max(0.01, 1 - (k - 0.75) * 4) : 1;
    });
    g.fx.burst(pos.add(new Vector3(0, 0.3, 0)), { count: 25, color1: new Color4(0.4, 0.3, 0.2, 1), tex: "smoke", additive: false, size: [0.3, 0.9], speed: [2, 5] });
    g.audio.sfx("rootBurst", pos);
  }

  protected override onPhase(p: number): void {
    if (p === 2) this.game.ui.toast("The Forest Guardian's roots spread across the grove!", "warn");
  }

  protected animate(dt: number, moving: number): void {
    const P = this.parts;
    const ph = this.t * 2.2;
    const amp = Math.min(1, moving / 2) * 0.35;
    P.legL.rotation.x = Math.sin(ph) * amp;
    P.legR.rotation.x = -Math.sin(ph) * amp;
    P.trunk.rotation.z = Math.sin(ph) * amp * 0.15;
    P.crown.rotation.z = Math.sin(this.t * 0.8) * 0.05;
    if (!this.attack) {
      for (const n of ["shL", "shR", "elL", "elR"]) {
        P[n].rotation.x = damp(P[n].rotation.x, n.startsWith("sh") ? -0.2 + Math.sin(this.t + (n === "shL" ? 0 : 2)) * 0.1 : -0.4, 4, dt);
        P[n].rotation.z = damp(P[n].rotation.z, n === "shL" ? -0.25 : n === "shR" ? 0.25 : 0, 4, dt);
      }
    }
    if (this.state === "dormant") P.trunk.rotation.x = 0.1;
    // heal from sprouts
    const alive = this.sprouts.filter((s) => s.alive).length;
    if (alive && this.state === "fight" && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.004 * alive * dt);
      if (Math.random() < dt * 3) this.game.fx.burst(this.lockPoint(), { count: 4, color1: new Color4(0.3, 1, 0.4, 1), size: [0.1, 0.3], speed: [1, 2], life: [0.5, 1] });
    }
  }

  override dispose(): void {
    for (const s of this.sprouts) if (s.alive) s.die();
    super.dispose();
  }
}

// =================================================================================================
// 3. THE FROST DRAGON — Ice — Blue shard
// =================================================================================================
export class FrostDragon extends Boss {
  private breathFx: any = null;
  private snow: any = null;
  constructor(game: Game) {
    super(game, { id: "frost", name: "The Frost Dragon", title: "Sovereign of the Frozen Hollow", shard: "blue", hp: 1050, radius: 2.8, height: 5, interior: "frost_cave" });
    this.moveSpeed = 4.5;
    this.preferredDist = 9;
    this.poiseMax = 11;
    this.build();
  }

  build(): void {
    const s = this.game.scene;
    const pb = new PartBuilder(s);
    const blue = "#3b7cc0", blue2 = "#2a5a92", belly = "#a9d4f0", spike = "#e8f8ff";
    const body = this.mk("body", null, 0, 2.6, 0);
    pb.capsule(blue, 5.0, 1.35, { rot: [Math.PI / 2, 0, 0] }, 10);
    pb.capsule(belly, 4.0, 1.0, { pos: [0, -0.5, 0.2], rot: [Math.PI / 2, 0, 0] }, 8);
    for (let k = 0; k < 6; k++) pb.cone(spike, 0.9 - k * 0.08, 0.4, { pos: [0, 1.3, 1.6 - k * 0.7] }, 5);
    this.merge(pb, "dbody", body);
    // neck chain
    let parent = body;
    const necks: TransformNode[] = [];
    for (let k = 0; k < 3; k++) {
      const n = this.mk("neck" + k, parent, 0, k === 0 ? 0.6 : 0.2, k === 0 ? 2.4 : 1.1);
      pb.capsule(blue2, 1.6, 0.55 - k * 0.07, { pos: [0, 0.1, 0.5], rot: [Math.PI / 2 - 0.5, 0, 0] }, 8);
      pb.cone(spike, 0.5, 0.25, { pos: [0, 0.6, 0.4] }, 4);
      this.merge(pb, "neckM" + k, n);
      necks.push(n);
      parent = n;
    }
    const head = this.mk("head", parent, 0, 0.5, 1.2);
    pb.box(blue, 1.0, 0.8, 1.4, {});
    pb.box(blue2, 0.8, 0.45, 1.3, { pos: [0, -0.2, 1.1] });
    pb.cone(spike, 1.2, 0.3, { pos: [-0.35, 0.6, -0.4], rot: [-1.1, 0, 0.3] }, 5);
    pb.cone(spike, 1.2, 0.3, { pos: [0.35, 0.6, -0.4], rot: [-1.1, 0, -0.3] }, 5);
    for (let k = 0; k < 4; k++) pb.cone("#ffffff", 0.22, 0.08, { pos: [-0.3 + k * 0.2, -0.45, 1.6], rot: [Math.PI, 0, 0] }, 4);
    this.merge(pb, "dhead", head);
    this.glow("#7af6ff", "sphere", 0.2, head, [-0.38, 0.18, 0.55], 2.4);
    this.glow("#7af6ff", "sphere", 0.2, head, [0.38, 0.18, 0.55], 2.4);
    this.parts.mouth = this.mk("mouth", head, 0, -0.2, 1.8);
    // wings
    for (const side of [-1, 1]) {
      const w = this.mk(side < 0 ? "wingL" : "wingR", body, side * 1.0, 1.0, 0.8);
      pb.cyl(blue2, 4.5, 0.15, 0.25, { pos: [side * 2.2, 0.4, 0], rot: [0, 0, side * 1.35] }, 5);
      pb.cyl(blue2, 3.6, 0.1, 0.18, { pos: [side * 2.5, 0.0, -1.2], rot: [0.6, 0, side * 1.45] }, 5);
      pb.box("#6fb4e8", 4.2, 0.06, 2.6, { pos: [side * 2.4, 0.2, -0.9], rot: [0, side * 0.1, side * -0.15] });
      this.merge(pb, "wingM", w);
    }
    for (const [n, x, z] of [["lf", -1.0, 1.4], ["rf", 1.0, 1.4], ["lb", -1.0, -1.5], ["rb", 1.0, -1.5]] as [string, number, number][]) {
      const leg = this.mk(n, body, x, -0.6, z);
      pb.capsule(blue2, 2.2, 0.38, { pos: [0, -0.9, 0] }, 7);
      for (let k = -1; k <= 1; k++) pb.cone(spike, 0.4, 0.12, { pos: [k * 0.18, -2.0, 0.35], rot: [Math.PI / 2, 0, 0] }, 4);
      this.merge(pb, "dleg", leg);
    }
    let tp = body;
    for (let k = 0; k < 4; k++) {
      const t = this.mk("tail" + k, tp, 0, 0, k === 0 ? -2.4 : -1.3);
      pb.capsule(blue, 1.6, 0.6 - k * 0.12, { pos: [0, 0, -0.6], rot: [Math.PI / 2, 0, 0] }, 7);
      pb.cone(spike, 0.5, 0.2, { pos: [0, 0.5 - k * 0.08, -0.6] }, 4);
      this.merge(pb, "dtail", t);
      tp = t;
    }
    this.game.fx.emitter(body as any, { rate: 12, color1: new Color4(0.8, 0.95, 1, 0.9), color2: new Color4(0.6, 0.85, 1, 0.6), size: [0.05, 0.2], life: [1, 2], speed: [0.2, 0.8], box: 2.5, capacity: 40, gravity: -1 });
  }

  protected chooseAttack(dist: number): BossAttack | null {
    const opts: [string, number][] = [["breath", dist < 15 ? 3 : 1], ["shards", 3], ["freeze", 2]];
    if (dist < 7) opts.push(["tail", 4]);
    if (this.phase >= 2) opts.push(["flight", 2]);
    const total = opts.reduce((s, o) => s + o[1], 0);
    let r = this.rng.next() * total;
    let pick = opts[0][0];
    for (const [n, w] of opts) {
      r -= w;
      if (r <= 0) {
        pick = n;
        break;
      }
    }
    const durs: Record<string, number> = { breath: 3.4, shards: 1.6, freeze: 2.2, tail: 1.4, flight: 6.5 };
    return this.startAttack(pick, durs[pick] / (this.phase === 3 ? 1.12 : 1));
  }

  protected runAttack(dt: number, a: BossAttack, k: number): void {
    const g = this.game;
    const p = g.player.position;
    const dmg = 17 * this.rage;
    const P = this.parts;
    switch (a.name) {
      case "breath": {
        if (k < 0.3) {
          this.faceP(dt, 3);
          P.neck0.rotation.x = -k * 1.2;
          P.head.rotation.x = k * 0.6;
        } else if (k < 0.88) {
          P.neck0.rotation.x = damp(P.neck0.rotation.x, 0.2, 6, dt);
          P.head.rotation.x = damp(P.head.rotation.x, 0.25, 6, dt);
          this.faceP(dt, this.phase === 3 ? 1.3 : 0.9);
          if (!this.breathFx) {
            this.breathFx = g.fx.emitter(P.mouth as any, { rate: 240, color1: new Color4(0.75, 0.95, 1, 1), color2: new Color4(0.4, 0.75, 1, 0.9), colorDead: new Color4(0.8, 0.9, 1, 0), size: [0.4, 1.4], life: [0.4, 0.7], speed: [15, 21], box: 0.2, capacity: 300 });
            g.audio.sfx("iceBreath", this.position);
          }
          const dir = new Vector3(Math.sin(this.yaw), -0.25, Math.cos(this.yaw));
          this.breathFx.direction1 = dir.add(new Vector3(-0.22, -0.05, -0.22));
          this.breathFx.direction2 = dir.add(new Vector3(0.22, 0.08, 0.22));
          if (Math.floor(a.t * 5) !== a.data.tick) {
            a.data.tick = Math.floor(a.t * 5);
            if (g.combat.coneHitPlayer(this.position, this.yaw, 0.42, 16, dmg * 0.4, "ice", this)) g.player.slowT = 2.5;
          }
        } else if (this.breathFx) {
          this.breathFx.stop();
          this.breathFx.disposeOnStop = true;
          this.breathFx = null;
        }
        break;
      }
      case "shards": {
        this.faceP(dt, 4);
        P.neck0.rotation.x = -Math.sin(k * Math.PI) * 0.5;
        if (this.once(a, "fire", k, 0.5)) {
          const n = this.phase === 1 ? 5 : this.phase === 2 ? 7 : 9;
          const base = yawTo(this.position.x, this.position.z, p.x, p.z);
          for (let i = 0; i < n; i++) {
            const ang = base + (i - (n - 1) / 2) * 0.16;
            const from = this.forward(3, 0, 3.4);
            const to = new Vector3(from.x + Math.sin(ang) * 30, p.y + 1, from.z + Math.cos(ang) * 30);
            g.combat.spawnProjectile({ from, target: to, speed: 20, damage: dmg * 0.8, owner: "enemy", element: "ice", color: "#9fe8ff", size: 0.6, life: 2.5 });
          }
          g.audio.sfx("iceShards", this.position);
        }
        break;
      }
      case "freeze": {
        if (this.once(a, "go", k, 0.12)) {
          const n = this.phase === 1 ? 3 : this.phase === 2 ? 4 : 6;
          g.audio.sfx("bossRoar", this.position);
          for (let i = 0; i < n; i++) {
            const x = i === 0 ? p.x : this.arenaCenter.x + this.rng.range(-this.arenaR * 0.8, this.arenaR * 0.8);
            const z = i === 0 ? p.z : this.arenaCenter.z + this.rng.range(-this.arenaR * 0.8, this.arenaR * 0.8);
            g.combat.delayedStrike(x, z, {
              radius: 3.5, delay: 1.1, damage: dmg * 0.8, element: "ice", color: "#4ab4ff", knock: 3,
              onStrike: (pos) => {
                g.combat.hazard(pos.x, pos.z, { radius: 3.5, dps: 8, element: "ice", life: 6, color: "#aee6ff" });
                g.fx.burst(pos.add(new Vector3(0, 0.4, 0)), { count: 40, color1: new Color4(0.8, 0.95, 1, 1), color2: new Color4(0.5, 0.8, 1, 1), size: [0.1, 0.5], speed: [3, 8], tex: "star" });
                g.audio.sfx("iceShatter", pos);
              },
            });
          }
        }
        break;
      }
      case "tail": {
        this.root.rotation.y = this.yaw + easeInOut(k) * Math.PI * 2;
        if (this.once(a, "hit1", k, 0.4) || this.once(a, "hit2", k, 0.7)) {
          g.combat.aoeHitPlayer(this.position, 7.5, dmg, { element: "physical", knockback: 10, unblockable: false });
          g.audio.sfx("swingHeavy", this.position);
        }
        break;
      }
      case "flight": {
        if (k < 0.18) {
          this.flying = lerp(0, 9, easeInOut(k / 0.18));
          if (this.once(a, "up", k, 0.01)) {
            g.audio.sfx("wings", this.position);
            const ang = yawTo(this.position.x, this.position.z, p.x, p.z);
            a.data.dest = new Vector3(this.arenaCenter.x + Math.sin(ang) * this.arenaR * 0.7, 0, this.arenaCenter.z + Math.cos(ang) * this.arenaR * 0.7);
          }
        } else if (k < 0.75) {
          const d: Vector3 = a.data.dest;
          const toD = yawTo(this.position.x, this.position.z, d.x, d.z);
          this.yaw = dampAngle(this.yaw, toD, 4, dt);
          const dd = Math.hypot(d.x - this.position.x, d.z - this.position.z);
          const sp = Math.min(16, dd * 2);
          this.velocity.set(Math.sin(this.yaw) * sp, 0, Math.cos(this.yaw) * sp);
          if (Math.floor(a.t * 3) !== a.data.tick) {
            a.data.tick = Math.floor(a.t * 3);
            const tx = p.x + this.rng.range(-3, 3), tz = p.z + this.rng.range(-3, 3);
            g.combat.delayedStrike(tx, tz, {
              radius: 2.6, delay: 0.9, damage: dmg * 0.8, element: "ice", color: "#4ab4ff",
              onStrike: (pos) => g.fx.burst(pos.add(new Vector3(0, 0.5, 0)), { count: 30, color1: new Color4(0.8, 0.95, 1, 1), size: [0.1, 0.5], speed: [3, 7], tex: "star" }),
            });
          }
        } else {
          this.velocity.scaleInPlace(0.9);
          this.flying = lerp(9, 0, easeInOut((k - 0.75) / 0.25));
          if (this.once(a, "land", k, 0.98)) {
            g.combat.shockwave(this.position.x, this.position.y, this.position.z, { maxR: 12, speed: 11, damage: dmg * 0.6, element: "ice", color: "#9fe8ff" });
            g.camera.shake(0.6);
            g.audio.sfx("slam", this.position);
          }
        }
        break;
      }
    }
  }

  protected override onPhase(p: number): void {
    if (p === 3 && !this.snow) {
      this.snow = this.game.fx.emitter(this.arenaCenter.add(new Vector3(0, 14, 0)), { rate: 160, color1: new Color4(1, 1, 1, 0.8), color2: new Color4(0.8, 0.9, 1, 0.6), size: [0.05, 0.18], life: [3, 5], speed: [0.5, 2], gravity: -2, box: this.arenaR, boxY: 1, capacity: 800, dir: [new Vector3(-1, -1, -0.3), new Vector3(1, -1, 0.3)] });
      this.game.ui.toast("A blizzard howls through the hollow!", "warn");
    }
  }

  protected animate(dt: number, moving: number): void {
    const P = this.parts;
    const ph = this.t * (2 + moving);
    const amp = Math.min(1, moving / 3) * 0.5 * (this.flying > 1 ? 0 : 1);
    P.lf.rotation.x = Math.sin(ph) * amp;
    P.rb.rotation.x = Math.sin(ph) * amp;
    P.rf.rotation.x = -Math.sin(ph) * amp;
    P.lb.rotation.x = -Math.sin(ph) * amp;
    const flap = this.flying > 0.5 ? Math.sin(this.t * 7) * 0.7 : Math.sin(this.t * 1.2) * 0.08 - 0.3;
    P.wingL.rotation.z = flap;
    P.wingR.rotation.z = -flap;
    for (let k = 0; k < 4; k++) P["tail" + k].rotation.y = Math.sin(this.t * 1.6 - k * 0.6) * 0.25;
    if (!this.attack || (this.attack.name !== "breath" && this.attack.name !== "shards")) {
      P.neck0.rotation.x = damp(P.neck0.rotation.x, this.state === "dormant" ? 0.6 : Math.sin(this.t * 0.9) * 0.08, 4, dt);
      P.head.rotation.x = damp(P.head.rotation.x, this.state === "dormant" ? 0.5 : 0, 4, dt);
    }
  }

  override dispose(): void {
    if (this.snow) {
      this.snow.stop();
      this.snow.disposeOnStop = true;
    }
    super.dispose();
  }

  protected override startDying(): void {
    if (this.snow) {
      this.snow.stop();
      this.snow.disposeOnStop = true;
      this.snow = null;
    }
    this.flying = 0;
    super.startDying();
  }
}

// =================================================================================================
// 4. THE SHADOW KNIGHT — Darkness — White shard
// =================================================================================================
export class ShadowKnight extends Boss {
  rig!: Humanoid;
  private aura: any = null;
  private hidden = false;
  constructor(game: Game) {
    super(game, { id: "shadow", name: "The Shadow Knight", title: "Last Warden of Enclar", shard: "white", hp: 950, radius: 1.3, height: 4.2, interior: null });
    this.dark = true;
    this.moveSpeed = 5.5;
    this.preferredDist = 4;
    this.poiseMax = 8;
    this.build();
  }

  build(): void {
    const g = this.game;
    this.rig = new Humanoid(g.scene, { skin: "#111018", hair: "#000", top: "#17141f", bottom: "#100e16", boots: "#0a080e", armor: "#26212f", eyeGlow: "#ffffff", hat: "greathelm", hatColor: "#1d1925", cape: "#0c0a12", scale: 2.3, bulk: 1.1 }, "shadowKnight");
    this.rig.root.parent = this.root;
    const w = buildWeapon(g.scene, { model: "dark" });
    w.root.parent = this.rig.handR;
    w.root.rotation.set(Math.PI / 2, 0, 0);
    w.root.scaling.setAll(1.3);
    g.glow.addIncludedOnlyMesh(w.blade);
    for (const m of this.rig.root.getChildMeshes(false)) g.env.addCaster(m, false);
    this.aura = g.fx.emitter(this.rig.bones.chest as any, { rate: 30, color1: new Color4(0.15, 0.1, 0.2, 0.7), color2: new Color4(0.3, 0.25, 0.4, 0.5), colorDead: new Color4(0, 0, 0, 0), size: [0.5, 1.4], life: [0.8, 1.6], speed: [0.2, 0.8], tex: "smoke", additive: false, box: 0.6, capacity: 80 });
  }

  private setHidden(h: boolean): void {
    this.hidden = h;
    this.rig.root.setEnabled(!h);
    this.invulnerable = h;
  }

  protected chooseAttack(dist: number): BossAttack | null {
    const opts: [string, number][] = [["combo", dist < 7 ? 5 : 1], ["teleport", this.phase === 3 ? 4 : 2], ["wave", dist > 6 ? 3 : 1]];
    const total = opts.reduce((s, o) => s + o[1], 0);
    let r = this.rng.next() * total;
    let pick = opts[0][0];
    for (const [n, w] of opts) {
      r -= w;
      if (r <= 0) {
        pick = n;
        break;
      }
    }
    const durs: Record<string, number> = { combo: 2.3, teleport: 1.8, wave: 1.5 };
    return this.startAttack(pick, durs[pick] / (this.phase === 3 ? 1.2 : 1));
  }

  protected runAttack(dt: number, a: BossAttack, k: number): void {
    const g = this.game;
    const p = g.player.position;
    const dmg = 20 * this.rage;
    switch (a.name) {
      case "combo": {
        const hits = [0.25, 0.52, 0.8];
        const idx = k < hits[0] ? 0 : k < hits[1] ? 1 : 2;
        a.data.anim = idx === 0 ? "attack1" : idx === 1 ? "attack2" : "attack3";
        const segStart = idx === 0 ? 0 : hits[idx - 1];
        a.data.animT = clamp01((k - segStart) / (hits[idx] - segStart + 0.08)) * 0.75;
        hits.forEach((h, i) => {
          if (k > h - 0.12 && k < h) {
            this.faceP(dt, 6);
            const sp = 9;
            this.velocity.set(Math.sin(this.yaw) * sp, 0, Math.cos(this.yaw) * sp);
          }
          if (this.once(a, "h" + i, k, h)) {
            this.velocity.scaleInPlace(0.2);
            g.combat.meleeHitPlayer(this.position, this.yaw, 4.4, i === 2 ? 1.2 : 2.4, dmg * (i === 2 ? 1.4 : 1), { knockback: i === 2 ? 10 : 5, element: "dark", source: this });
            g.audio.sfx("swingHeavy", this.position);
          }
        });
        break;
      }
      case "teleport": {
        if (this.once(a, "vanish", k, 0.05)) {
          g.fx.deathPuff(this.lockPoint(), 1.2, new Color4(0.05, 0.03, 0.08, 0.9));
          g.audio.sfx("teleport", this.position);
          this.setHidden(true);
          const behind = new Vector3(p.x - Math.sin(g.player.yaw) * 3.2, 0, p.z - Math.cos(g.player.yaw) * 3.2);
          a.data.dest = behind;
          g.fx.telegraph(behind.x, behind.z, { radius: 2.2, delay: 0.85, color: "#c0c0ff" });
        }
        if (this.once(a, "appear", k, 0.5)) {
          const d: Vector3 = a.data.dest;
          this.position.x = d.x;
          this.position.z = d.z;
          this.yaw = yawTo(d.x, d.z, p.x, p.z);
          this.setHidden(false);
          g.fx.deathPuff(this.lockPoint(), 1, new Color4(0.05, 0.03, 0.08, 0.9));
          g.audio.sfx("teleport", this.position);
        }
        if (k > 0.5) {
          a.data.anim = "attack3";
          a.data.animT = clamp01((k - 0.5) / 0.25) * 0.75;
        }
        if (this.once(a, "slash", k, 0.72)) {
          g.combat.meleeHitPlayer(this.position, this.yaw, 4.6, 2.0, dmg * 1.3, { knockback: 9, element: "dark", source: this });
          g.audio.sfx("swingHeavy", this.position);
        }
        break;
      }
      case "wave": {
        this.faceP(dt, 4);
        a.data.anim = "attack3";
        a.data.animT = clamp01(k / 0.5) * 0.75;
        if (this.once(a, "tele", k, 0.05)) g.fx.telegraph(this.position.x, this.position.z, { radius: 30, delay: 0.6, shape: "rect", width: 3.2, length: 30, yaw: this.yaw, color: "#8a7aff" });
        if (this.once(a, "go", k, 0.45)) {
          this.shadowWave(this.yaw);
          if (this.phase === 3) {
            this.shadowWave(this.yaw + 0.5);
            this.shadowWave(this.yaw - 0.5);
          }
          g.audio.sfx("darkWave", this.position);
        }
        break;
      }
    }
  }

  /** A low wall of shadow sliding along the ground; jump or dodge through it. */
  private shadowWave(yaw: number): void {
    const g = this.game;
    const wall = MeshBuilder.CreateBox("swave", { width: 3.2, height: 1.4, depth: 0.6 }, g.scene);
    const mat = new StandardMaterial("swaveMat", g.scene);
    mat.emissiveColor = new Color3(0.45, 0.35, 0.9);
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.alpha = 0.75;
    wall.material = mat;
    wall.rotation.y = yaw;
    g.glow.addIncludedOnlyMesh(wall);
    const ps = g.fx.emitter(wall, { rate: 60, color1: new Color4(0.2, 0.15, 0.4, 0.8), color2: new Color4(0.6, 0.5, 1, 0.6), size: [0.3, 0.9], life: [0.3, 0.7], speed: [0.5, 2], box: 1.4, boxY: 0.5, tex: "smoke", additive: false });
    let t = 0;
    const start = this.position.clone();
    let hit = false;
    g.fx.addUpdater((dt) => {
      t += dt;
      const d = 1.5 + t * 15;
      const x = start.x + Math.sin(yaw) * d, z = start.z + Math.cos(yaw) * d;
      const y = g.physics.groundHeight(x, z, 1e5);
      wall.position.set(x, y + 0.7, z);
      const pp = g.player.position;
      const lx = (pp.x - x) * Math.cos(yaw) - (pp.z - z) * Math.sin(yaw);
      const lz = (pp.x - x) * Math.sin(yaw) + (pp.z - z) * Math.cos(yaw);
      const airborne = pp.y - g.physics.groundHeight(pp.x, pp.z, pp.y) > 0.8;
      if (!hit && Math.abs(lx) < 1.9 && Math.abs(lz) < 0.9 && !airborne) hit = g.player.takeDamage(16 * this.rage, new Vector3(x, y, z), { knockback: 6, element: "dark", unblockable: false });
      if (t > 2.2) {
        wall.dispose();
        ps.stop();
        ps.disposeOnStop = true;
        return false;
      }
      return true;
    });
  }

  protected override onPhase(p: number): void {
    const g = this.game;
    if (p === 2) {
      g.ui.toast("The Shadow Knight summons his fallen soldiers!", "warn");
      for (let i = 0; i < 2; i++) {
        const ang = this.yaw + (i ? 1.5 : -1.5);
        const pos = new Vector3(this.position.x + Math.sin(ang) * 6, 0, this.position.z + Math.cos(ang) * 6);
        pos.y = g.physics.groundHeight(pos.x, pos.z, 1e5);
        g.enemies.spawn("skeleton", pos, null, 3);
      }
    }
    if (p === 3) this.moveSpeed = 7;
  }

  protected animate(dt: number, moving: number): void {
    if (this.hidden) return;
    const a = this.attack;
    const act = a && a.data.anim ? a.data.anim : this.state === "dormant" ? "kneel" : this.state === "stagger" ? "hit" : this.state === "phase" ? "roar" : null;
    const at = a && a.data.anim ? a.data.animT : this.state === "phase" ? 1 - this.stateT / 2.2 : 0.5;
    this.rig.animate(dt, { speed: moving * 0.6, grounded: true, vy: 0, action: act, actionT: at, actionDur: 1, blocking: false, armed: true });
    void wrapAngle;
  }

  protected override animateDeath(dt: number, k: number): void {
    this.rig.animate(dt, { speed: 0, grounded: true, vy: 0, action: k < 0.5 ? "kneel" : "death", actionT: k < 0.5 ? 0.5 : (k - 0.5) * 2, actionDur: 1, blocking: false, armed: true });
    if (k > 0.8) this.root.scaling.setAll(Math.max(0.01, 1 - (k - 0.8) * 5));
  }

  override dispose(): void {
    if (this.aura) {
      this.aura.stop();
      this.aura.disposeOnStop = true;
    }
    super.dispose();
  }
}

// =================================================================================================
// 5. THE THUNDER TITAN — Lightning — Yellow shard
// =================================================================================================
export class ThunderTitan extends Boss {
  private stormT = 0;
  private arcs: Mesh[] = [];
  private orbit: TransformNode[] = [];
  constructor(game: Game) {
    super(game, { id: "thunder", name: "The Thunder Titan", title: "Colossus of the Pessons Summit", shard: "yellow", hp: 1100, radius: 2.6, height: 8.5, interior: null });
    this.moveSpeed = 3.2;
    this.preferredDist = 6;
    this.poiseMax = 14;
    this.build();
  }

  build(): void {
    const s = this.game.scene;
    const pb = new PartBuilder(s);
    const st = "#6d6a66", st2 = "#55524e", st3 = "#83807a";
    const hips = this.mk("hips", null, 0, 3.6, 0);
    pb.box(st2, 2.6, 1.2, 1.6, {});
    this.merge(pb, "thips", hips);
    const torso = this.mk("torso", hips, 0, 0.6, 0);
    pb.box(st, 3.6, 2.8, 2.2, { pos: [0, 1.5, 0] });
    pb.box(st3, 4.2, 1.0, 2.4, { pos: [0, 2.9, 0] });
    pb.ico(st2, 0.9, { pos: [-2.0, 3.3, 0] }, 1, 0.1);
    pb.ico(st2, 0.9, { pos: [2.0, 3.3, 0] }, 1, 0.1);
    for (let k = 0; k < 5; k++) pb.box("#3d3a37", 0.12, 1.6, 0.08, { pos: [-1.2 + k * 0.6, 1.4, 1.12], rot: [0, 0, (k - 2) * 0.3] });
    this.merge(pb, "ttorso", torso);
    this.glow("#ffe14a", "box", [1.0, 1.0, 0.1], torso, [0, 1.6, 1.13], 2).rotation.z = Math.PI / 4;
    const head = this.mk("head", torso, 0, 3.6, 0.1);
    pb.box(st3, 1.5, 1.3, 1.4, {});
    pb.box(st2, 1.7, 0.4, 1.6, { pos: [0, 0.7, 0] });
    this.merge(pb, "thead", head);
    this.glow("#ffe14a", "box", [0.35, 0.15, 0.1], head, [-0.35, 0.1, 0.71], 2.5);
    this.glow("#ffe14a", "box", [0.35, 0.15, 0.1], head, [0.35, 0.1, 0.71], 2.5);
    for (const side of [-1, 1]) {
      const sh = this.mk(side < 0 ? "shL" : "shR", torso, side * 2.3, 2.9, 0);
      pb.box(st, 1.1, 2.4, 1.1, { pos: [0, -1.2, 0] });
      this.merge(pb, "tarm", sh);
      const el = this.mk(side < 0 ? "elL" : "elR", sh, 0, -2.4, 0);
      pb.box(st2, 1.0, 2.2, 1.0, { pos: [0, -1.1, 0] });
      pb.box(st3, 1.5, 1.4, 1.5, { pos: [0, -2.6, 0] });
      this.merge(pb, "tfore", el);
      this.glow("#ffe14a", "box", [0.1, 1.0, 0.1], el, [side * 0.52, -1.0, 0.3], 2);
    }
    for (const side of [-1, 1]) {
      const leg = this.mk(side < 0 ? "legL" : "legR", hips, side * 0.9, -0.3, 0);
      pb.box(st2, 1.2, 3.3, 1.3, { pos: [0, -1.6, 0] });
      pb.box(st, 1.5, 0.5, 1.9, { pos: [0, -3.2, 0.2] });
      this.merge(pb, "tleg", leg);
    }
    // orbiting stones with electric arcs
    for (let k = 0; k < 6; k++) {
      const o = this.mk("orb" + k, null, 0, 0, 0);
      pb.ico(st3, 0.4 + this.rng.next() * 0.4, {}, 1, 0.15);
      this.merge(pb, "orbM", o);
      this.orbit.push(o);
    }
    const arcMat = glowMaterial(s, "#fff27a", 2.5);
    for (let k = 0; k < 4; k++) {
      const arc = MeshBuilder.CreateCylinder("arc", { height: 1, diameter: 0.07, tessellation: 4 }, s);
      arc.material = arcMat;
      arc.parent = this.root;
      this.game.glow.addIncludedOnlyMesh(arc);
      this.arcs.push(arc);
    }
  }

  protected chooseAttack(dist: number): BossAttack | null {
    const opts: [string, number][] = [["lightning", 3], ["slam", dist < 12 ? 3 : 1.5]];
    if (dist < 7) opts.push(["punch", 4]);
    const total = opts.reduce((s, o) => s + o[1], 0);
    let r = this.rng.next() * total;
    let pick = opts[0][0];
    for (const [n, w] of opts) {
      r -= w;
      if (r <= 0) {
        pick = n;
        break;
      }
    }
    const durs: Record<string, number> = { lightning: 2.2, slam: 2.0, punch: 1.6 };
    return this.startAttack(pick, durs[pick] / (this.phase === 3 ? 1.12 : 1));
  }

  private bolt(pos: Vector3): void {
    const g = this.game;
    const m = MeshBuilder.CreateCylinder("bolt", { height: 60, diameterTop: 0.6, diameterBottom: 0.35, tessellation: 6 }, g.scene);
    m.material = glowMaterial(g.scene, "#fffbd0", 3);
    m.position.set(pos.x, pos.y + 30, pos.z);
    g.glow.addIncludedOnlyMesh(m);
    g.fx.animateMesh(m, 0.25, (k, mm) => {
      mm.visibility = 1 - k;
      mm.position.x = pos.x + (Math.random() - 0.5) * 0.4;
    });
    g.fx.flashLight(pos.add(new Vector3(0, 4, 0)), new Color3(1, 0.95, 0.6), 6, 30, 0.3);
    g.fx.burst(pos.add(new Vector3(0, 0.3, 0)), { count: 40, color1: new Color4(1, 0.95, 0.5, 1), color2: new Color4(1, 1, 1, 1), tex: "spark", size: [0.05, 0.3], speed: [4, 10], life: [0.2, 0.5] });
    g.audio.sfx("thunder", pos);
    g.camera.shake(0.3);
    g.ui.screenFlash(0.25);
  }

  protected runAttack(dt: number, a: BossAttack, k: number): void {
    const g = this.game;
    const p = g.player.position;
    const dmg = 20 * this.rage;
    const P = this.parts;
    switch (a.name) {
      case "lightning": {
        P.shR.rotation.x = -Math.sin(k * Math.PI) * 2.8;
        P.shL.rotation.x = -Math.sin(k * Math.PI) * 2.8;
        if (this.once(a, "go", k, 0.2)) {
          const n = this.phase === 1 ? 3 : this.phase === 2 ? 5 : 7;
          g.audio.sfx("charge", this.position);
          for (let i = 0; i < n; i++) {
            const x = i === 0 ? p.x : p.x + this.rng.range(-9, 9), z = i === 0 ? p.z : p.z + this.rng.range(-9, 9);
            g.combat.delayedStrike(x, z, { radius: 2.8, delay: 1.0 + i * 0.1, damage: dmg, element: "lightning", color: "#ffe14a", onStrike: (pos) => this.bolt(pos) });
          }
        }
        break;
      }
      case "slam": {
        const up = k < 0.45;
        P.hips.position.y = 3.6 + (up ? Math.sin((k / 0.45) * Math.PI * 0.5) * 2.5 : Math.max(0, 2.5 - (k - 0.45) * 40));
        P.shL.rotation.x = up ? -2.6 * (k / 0.45) : -0.4;
        P.shR.rotation.x = up ? -2.6 * (k / 0.45) : -0.4;
        if (this.once(a, "tele", k, 0.05)) g.fx.telegraph(this.position.x, this.position.z, { radius: 7, delay: 0.85, color: "#ffe14a" });
        if (this.once(a, "slam", k, 0.5)) {
          g.combat.aoeHitPlayer(this.position, 6.5, dmg * 1.2, { element: "lightning", knockback: 10 });
          const rings = this.phase;
          for (let i = 0; i < rings; i++) {
            setTimeout(() => {
              if (this.alive) g.combat.shockwave(this.position.x, this.position.y, this.position.z, { maxR: 22, speed: 13, damage: dmg * 0.8, element: "lightning", color: "#ffe14a" });
            }, i * 450);
          }
          g.camera.shake(1);
          g.audio.sfx("slam", this.position);
          g.fx.burst(this.position.add(new Vector3(0, 0.5, 0)), { count: 60, color1: new Color4(0.55, 0.5, 0.45, 1), color2: new Color4(1, 0.9, 0.4, 1), tex: "smoke", additive: false, size: [0.6, 2], speed: [3, 9] });
        }
        break;
      }
      case "punch": {
        this.faceP(dt, k < 0.45 ? 3 : 0.4);
        P.shR.rotation.x = k < 0.45 ? lerp(0, -2.4, easeInOut(k / 0.45)) : lerp(-2.4, -1.4, clamp01((k - 0.45) * 6));
        P.torso.rotation.y = k < 0.45 ? 0.5 * (k / 0.45) : lerp(0.5, -0.4, clamp01((k - 0.45) * 5));
        if (this.once(a, "hit", k, 0.55)) {
          g.combat.meleeHitPlayer(this.position, this.yaw, 7, 1.4, dmg * 1.4, { knockback: 12, element: "lightning", source: this });
          g.audio.sfx("slam", this.forward(5));
          g.camera.shake(0.5);
        }
        break;
      }
    }
  }

  protected override onPhase(p: number): void {
    if (p === 2) this.game.ui.toast("The storm answers the Titan's call!", "warn");
    if (p === 3) this.game.ui.toast("The Titan crackles with lethal energy — keep your distance!", "warn");
  }

  override update(dt: number): void {
    super.update(dt);
    const g = this.game;
    if (this.state !== "fight" && this.state !== "stagger") return;
    // storm follows the player
    if (this.phase >= 2) {
      this.stormT -= dt;
      if (this.stormT <= 0) {
        this.stormT = this.phase === 2 ? 2.0 : 1.2;
        const p = g.player.position;
        const lead = g.player.velocity.scale(0.6);
        g.combat.delayedStrike(p.x + lead.x, p.z + lead.z, { radius: 2.4, delay: 0.95, damage: 14 * this.rage, element: "lightning", color: "#ffe14a", onStrike: (pos) => this.bolt(pos) });
      }
    }
    // electric aura
    if (this.phase === 3) {
      const d = Math.hypot(g.player.position.x - this.position.x, g.player.position.z - this.position.z);
      if (d < this.radius + 2.5 && Math.random() < dt * 2) g.player.takeDamage(6, this.position, { knockback: 3, element: "lightning", unblockable: true });
    }
  }

  protected animate(dt: number, moving: number): void {
    const P = this.parts;
    const ph = this.t * 1.8;
    const amp = Math.min(1, moving / 2) * 0.35;
    P.legL.rotation.x = Math.sin(ph) * amp;
    P.legR.rotation.x = -Math.sin(ph) * amp;
    if (!this.attack) {
      P.shL.rotation.x = damp(P.shL.rotation.x, -Math.sin(ph) * amp * 0.6, 4, dt);
      P.shR.rotation.x = damp(P.shR.rotation.x, Math.sin(ph) * amp * 0.6, 4, dt);
      P.torso.rotation.y = damp(P.torso.rotation.y, 0, 4, dt);
      P.hips.position.y = damp(P.hips.position.y, this.state === "dormant" ? 2.4 : 3.6, 3, dt);
    }
    // orbiting stones & arcs
    const n = this.orbit.length;
    const pts: Vector3[] = [];
    this.orbit.forEach((o, i) => {
      const a = this.t * (0.8 + i * 0.07) + (i / n) * Math.PI * 2;
      const r = 4 + Math.sin(this.t + i) * 0.5;
      o.position.set(Math.sin(a) * r, 5 + Math.sin(this.t * 1.3 + i) * 1.5, Math.cos(a) * r);
      o.rotation.set(this.t + i, this.t * 0.7, 0);
      pts.push(o.position);
    });
    this.arcs.forEach((arc, i) => {
      const visible = Math.random() < (this.phase === 3 ? 0.9 : 0.5);
      arc.isVisible = visible;
      if (!visible) return;
      const a = pts[(i * 2) % n], b = this.rng.chance(0.5) ? pts[(i * 2 + 1) % n] : new Vector3(0, 4, 0);
      const mid = a.add(b).scale(0.5);
      const d = b.subtract(a);
      arc.position.copyFrom(mid);
      arc.scaling.y = d.length();
      const dir = d.normalize();
      arc.rotation.set(Math.acos(dir.y), 0, 0);
      arc.rotation.y = Math.atan2(dir.x, dir.z);
    });
  }
}

void wrapAngle;
