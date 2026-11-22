import { Vector3, Color4, Color3, MeshBuilder, Mesh, StandardMaterial } from "@babylonjs/core";
import type { Game } from "../../core/Game";
import { Boss, BossAttack } from "./Boss";
import { Humanoid } from "../Humanoid";
import { buildWeapon } from "../Props";
import type { HitInfo } from "../../systems/CombatSystem";
import { clamp01, yawTo } from "../../core/MathUtil";

/** ZORG, Lord of the Dark Side. Three phases: Dark Lord, Poison Master, Final Darkness. */
export class Zorg extends Boss {
  rig!: Humanoid;
  private aura: any = null;
  private shell: Mesh | null = null;
  private hidden = false;
  private immuneMsgT = 0;

  constructor(game: Game) {
    super(game, { id: "zorg", name: "ZORG", title: "Lord of the Dark Side", shard: null, hp: 3200, radius: 2.4, height: 8, interior: "zorg_cave" });
    this.dark = true;
    this.moveSpeed = 4.2;
    this.preferredDist = 6.5;
    this.poiseMax = 18;
    this.build();
  }

  build(): void {
    const g = this.game;
    this.rig = new Humanoid(g.scene, {
      skin: "#0d0a12", hair: "#000", top: "#16121c", bottom: "#100d15", boots: "#0a080d", armor: "#221b2b", eyeGlow: "#ff1a1a",
      hat: "horned", hatColor: "#1a141f", cape: "#3a0610", scale: 4.3, bulk: 1.25, beard: undefined,
    }, "zorg");
    this.rig.root.parent = this.root;
    const w = buildWeapon(g.scene, { model: "dark" });
    w.root.parent = this.rig.handR;
    w.root.rotation.set(Math.PI / 2, 0, 0);
    w.root.scaling.set(1.5, 1.8, 1.5);
    g.glow.addIncludedOnlyMesh(w.blade);
    for (const m of this.rig.root.getChildMeshes(false)) g.env.addCaster(m, false);
    this.aura = g.fx.emitter(this.rig.bones.chest as any, { rate: 50, color1: new Color4(0.3, 0.05, 0.4, 0.8), color2: new Color4(0.1, 0.02, 0.15, 0.6), colorDead: new Color4(0, 0, 0, 0), size: [0.8, 2.4], life: [1, 2], speed: [0.5, 1.5], tex: "smoke", additive: false, box: 1.2, boxY: 2, capacity: 150 });
  }

  protected override damageFilter(h: HitInfo): number {
    const rainbow = h.element === "rainbow" || h.element === "light";
    if (this.phase === 3 && !rainbow) {
      if (this.immuneMsgT <= 0) {
        this.game.ui.toast("Only the Rainbow Sword can pierce the Final Darkness!", "warn");
        this.immuneMsgT = 3;
      }
      return 0;
    }
    if (!rainbow) return 0.5;
    if (h.element === "light") return 2.0;
    return 1;
  }

  protected chooseAttack(dist: number): BossAttack | null {
    const opts: [string, number][] = [];
    if (dist < 10) opts.push(["sweep", 4], ["overhead", 3]);
    opts.push(["orbs", dist > 8 ? 4 : 1.5]);
    if (this.phase >= 2) opts.push(["toxic", 2.5], ["poisonRain", 2], ["breath", dist < 14 ? 2 : 0.5]);
    if (this.phase === 2) opts.push(["slimes", 1]);
    if (this.phase === 3) opts.push(["meteors", 3], ["teleport", 3], ["combo", dist < 10 ? 4 : 1]);
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
    const durs: Record<string, number> = { sweep: 1.6, overhead: 1.9, orbs: 1.7, toxic: 2.4, poisonRain: 2.2, breath: 3.2, slimes: 1.8, meteors: 2.6, teleport: 2.0, combo: 3.0 };
    return this.startAttack(pick, durs[pick] / (this.phase === 3 ? 1.2 : 1));
  }

  protected runAttack(dt: number, a: BossAttack, k: number): void {
    const g = this.game;
    const p = g.player.position;
    const dmg = 24 * this.rage;
    const seg = (s: number, e: number) => clamp01((k - s) / (e - s));
    switch (a.name) {
      case "sweep": {
        a.data.anim = "attack1";
        a.data.animT = k * 0.85;
        if (k < 0.4) this.faceP(dt, 3);
        if (this.once(a, "tele", k, 0.02)) g.fx.telegraph(this.position.x, this.position.z, { radius: 10, delay: 0.6, shape: "cone", angle: 1.4, yaw: this.yaw, color: "#c01a3a" });
        if (this.once(a, "hit", k, 0.45)) {
          g.combat.meleeHitPlayer(this.position, this.yaw, 10, 2.8, dmg, { knockback: 10, element: "dark", source: this });
          g.audio.sfx("swingHeavy", this.position);
          g.camera.shake(0.4);
        }
        break;
      }
      case "overhead": {
        a.data.anim = "attack3";
        a.data.animT = k * 0.8;
        if (k < 0.35) this.faceP(dt, 3);
        if (this.once(a, "tele", k, 0.05)) {
          const f = this.forward(6.5);
          a.data.f = f;
          g.fx.telegraph(f.x, f.z, { radius: 4.5, delay: 0.75, color: "#c01a3a" });
        }
        if (this.once(a, "hit", k, 0.48)) {
          const f: Vector3 = a.data.f;
          g.combat.aoeHitPlayer(f, 4.5, dmg * 1.5, { element: "dark", knockback: 12 });
          g.combat.shockwave(f.x, this.position.y, f.z, { maxR: 16, speed: 13, damage: dmg * 0.6, element: "dark", color: "#a23cff" });
          g.fx.burst(f.add(new Vector3(0, 0.5, 0)), { count: 70, color1: new Color4(0.4, 0.1, 0.6, 1), color2: new Color4(1, 0.2, 0.3, 1), size: [0.4, 1.4], speed: [4, 10] });
          g.camera.shake(0.9);
          g.audio.sfx("slam", f);
        }
        break;
      }
      case "combo": {
        const segs: [string, number, number][] = [["attack1", 0, 0.33], ["attack2", 0.33, 0.62], ["attack3", 0.62, 1]];
        for (const [anim, s, e] of segs) if (k >= s && k < e) {
          a.data.anim = anim;
          a.data.animT = seg(s, e) * 0.85;
        }
        this.faceP(dt, 2.5);
        for (const [i, at] of [[0, 0.17], [1, 0.47], [2, 0.82]] as [number, number][]) {
          if (this.once(a, "h" + i, k, at)) {
            g.combat.meleeHitPlayer(this.position, this.yaw, 10, i === 2 ? 1.4 : 2.8, dmg * (i === 2 ? 1.5 : 1), { knockback: 10, element: "dark", source: this });
            g.audio.sfx("swingHeavy", this.position);
            if (i === 2) g.combat.shockwave(this.forward(6).x, this.position.y, this.forward(6).z, { maxR: 14, speed: 14, damage: dmg * 0.6, element: "dark", color: "#a23cff" });
          }
        }
        break;
      }
      case "orbs": {
        a.data.anim = "cast";
        a.data.animT = k;
        this.faceP(dt, 3);
        if (this.once(a, "fire", k, 0.45)) {
          const n = this.phase === 1 ? 5 : 7;
          const base = yawTo(this.position.x, this.position.z, p.x, p.z);
          for (let i = 0; i < n; i++) {
            const ang = base + (i - (n - 1) / 2) * 0.22;
            const from = this.forward(2.5, 0, 6);
            g.combat.spawnProjectile({ from, dir: new Vector3(Math.sin(ang), -0.12, Math.cos(ang)), speed: 15, damage: dmg * 0.6, owner: "enemy", element: "dark", color: "#a23cff", size: 0.9, homing: 0.5, life: 4 });
          }
          g.audio.sfx("darkWave", this.position);
        }
        break;
      }
      case "toxic": {
        a.data.anim = "roar";
        a.data.animT = k;
        if (this.once(a, "go", k, 0.15)) {
          g.audio.sfx("bossRoar", this.position);
          g.ui.toast("Zorg floods the arena with toxic clouds!", "warn");
          const q = Math.floor(this.rng.next() * 4);
          for (let i = 0; i < 2; i++) {
            const ang = ((q + i * 2) / 4) * Math.PI * 2 + Math.PI / 4;
            const R = this.arenaR * 0.55;
            const x = this.arenaCenter.x + Math.sin(ang) * R, z = this.arenaCenter.z + Math.cos(ang) * R;
            g.fx.telegraph(x, z, { radius: this.arenaR * 0.42, delay: 1.3, color: "#6aff3a" }, () => g.combat.hazard(x, z, { radius: this.arenaR * 0.42, dps: 14, element: "poison", life: 10, color: "#5a2a7a" }));
          }
        }
        break;
      }
      case "poisonRain": {
        a.data.anim = "cast";
        a.data.animT = k;
        if (this.once(a, "go", k, 0.2)) {
          for (let i = 0; i < 8; i++) {
            const x = p.x + this.rng.range(-10, 10), z = p.z + this.rng.range(-10, 10);
            g.combat.delayedStrike(i === 0 ? p.x : x, i === 0 ? p.z : z, {
              radius: 2.5, delay: 1.0 + i * 0.1, damage: dmg * 0.6, element: "poison", color: "#7aff3a",
              onStrike: (pos) => {
                g.fx.burst(pos.add(new Vector3(0, 0.5, 0)), { count: 25, color1: new Color4(0.4, 1, 0.3, 1), color2: new Color4(0.6, 0.2, 0.8, 1), size: [0.2, 0.7], speed: [2, 6] });
                g.combat.hazard(pos.x, pos.z, { radius: 2.2, dps: 8, element: "poison", life: 4, color: "#5a2a7a", particles: false });
              },
            });
          }
          g.audio.sfx("magicCast", this.position);
        }
        break;
      }
      case "breath": {
        a.data.anim = "roar";
        a.data.animT = Math.min(0.5, k);
        if (k < 0.3) this.faceP(dt, 3);
        else if (k < 0.9) {
          this.faceP(dt, 1);
          if (!a.data.fx) {
            const mouth = this.rig.bones.head;
            a.data.fx = g.fx.emitter(mouth as any, { rate: 200, color1: new Color4(0.4, 0.9, 0.2, 0.9), color2: new Color4(0.5, 0.1, 0.6, 0.8), colorDead: new Color4(0.1, 0.1, 0.1, 0), size: [0.8, 2.2], life: [0.6, 1], speed: [12, 18], tex: "smoke", additive: false, box: 0.3, capacity: 300 });
            g.audio.sfx("poisonBreath", this.position);
          }
          const dir = new Vector3(Math.sin(this.yaw), -0.35, Math.cos(this.yaw));
          a.data.fx.direction1 = dir.add(new Vector3(-0.25, -0.05, -0.25));
          a.data.fx.direction2 = dir.add(new Vector3(0.25, 0.05, 0.25));
          if (Math.floor(a.t * 5) !== a.data.tick) {
            a.data.tick = Math.floor(a.t * 5);
            g.combat.coneHitPlayer(this.position, this.yaw, 0.5, 18, dmg * 0.4, "poison", this);
          }
        } else if (a.data.fx) {
          a.data.fx.stop();
          a.data.fx.disposeOnStop = true;
          a.data.fx = null;
        }
        break;
      }
      case "slimes": {
        a.data.anim = "cast";
        a.data.animT = k;
        if (this.once(a, "go", k, 0.5)) {
          for (let i = 0; i < 3; i++) {
            const ang = this.rng.next() * Math.PI * 2;
            const x = this.arenaCenter.x + Math.sin(ang) * this.arenaR * 0.6, z = this.arenaCenter.z + Math.cos(ang) * this.arenaR * 0.6;
            g.enemies.spawn("slime", new Vector3(x, g.physics.groundHeight(x, z, 1e5), z), "zorg_cave", 3);
          }
          g.audio.sfx("summon", this.position);
        }
        break;
      }
      case "meteors": {
        a.data.anim = "cast";
        a.data.animT = k;
        if (this.once(a, "go", k, 0.15)) {
          g.audio.sfx("bossRoar", this.position);
          for (let i = 0; i < 12; i++) {
            const x = i < 2 ? p.x : this.arenaCenter.x + this.rng.range(-this.arenaR * 0.85, this.arenaR * 0.85);
            const z = i < 2 ? p.z : this.arenaCenter.z + this.rng.range(-this.arenaR * 0.85, this.arenaR * 0.85);
            g.combat.delayedStrike(x, z, {
              radius: 3, delay: 1.1 + i * 0.12, damage: dmg, element: "dark", color: "#c01a3a", knock: 8,
              onStrike: (pos) => {
                g.fx.burst(pos.add(new Vector3(0, 1, 0)), { count: 50, color1: new Color4(0.5, 0.1, 0.7, 1), color2: new Color4(1, 0.2, 0.3, 1), size: [0.3, 1.2], speed: [5, 12], life: [0.3, 0.9] });
                g.fx.flashLight(pos.add(new Vector3(0, 3, 0)), new Color3(0.7, 0.1, 0.9), 3, 16, 0.4);
                g.audio.sfx("explosion", pos);
              },
            });
          }
        }
        break;
      }
      case "teleport": {
        if (this.once(a, "vanish", k, 0.05)) {
          g.fx.deathPuff(this.lockPoint(), 2.2, new Color4(0.05, 0.02, 0.08, 0.95));
          this.hidden = true;
          this.rig.root.setEnabled(false);
          this.invulnerable = true;
          a.data.dest = p.clone();
          g.fx.telegraph(p.x, p.z, { radius: 5, delay: 1.0, color: "#c01a3a" });
          g.audio.sfx("teleport", this.position);
        }
        if (this.once(a, "slam", k, 0.55)) {
          const d: Vector3 = a.data.dest;
          this.position.x = d.x - 1.5;
          this.position.z = d.z - 1.5;
          this.hidden = false;
          this.rig.root.setEnabled(true);
          this.invulnerable = false;
          g.combat.aoeHitPlayer(d, 5, dmg * 1.4, { element: "dark", knockback: 13 });
          g.combat.shockwave(d.x, d.y, d.z, { maxR: 15, speed: 12, damage: dmg * 0.5, element: "dark", color: "#a23cff" });
          g.camera.shake(1);
          g.audio.sfx("slam", d);
        }
        a.data.anim = "attack3";
        a.data.animT = 0.4 + k * 0.4;
        break;
      }
    }
  }

  protected override onPhase(p: number): void {
    const g = this.game;
    if (p === 2) {
      g.ui.bigTitle("PHASE II", "The Poison Master", "#7aff3a");
      g.audio.setMusic("finalboss2");
    }
    if (p === 3) {
      g.ui.bigTitle("PHASE III", "The Final Darkness", "#ff2a4a");
      g.audio.setMusic("finalboss3");
      this.moveSpeed = 5.5;
      // dark energy shell
      this.shell = MeshBuilder.CreateSphere("zorgShell", { diameter: 13, segments: 20 }, g.scene);
      const m = new StandardMaterial("shellMat", g.scene);
      m.emissiveColor = new Color3(0.35, 0.02, 0.45);
      m.diffuseColor = new Color3(0, 0, 0);
      m.alpha = 0.22;
      m.backFaceCulling = false;
      this.shell.material = m;
      this.shell.parent = this.root;
      this.shell.position.y = 4.5;
      if (this.aura) this.aura.emitRate = 120;
    }
  }

  protected animate(dt: number, moving: number): void {
    this.immuneMsgT -= dt;
    if (this.hidden) return;
    const a = this.attack;
    const act = a && a.data.anim ? a.data.anim : this.state === "dormant" ? "sit" : this.state === "stagger" ? "hit" : this.state === "phase" || this.state === "intro" ? "roar" : null;
    const at = a && a.data.anim !== undefined ? a.data.animT : this.state === "phase" ? 1 - this.stateT / 2.2 : this.state === "intro" ? 0.5 : 0.5;
    this.rig.animate(dt, { speed: moving * 0.5, grounded: true, vy: 0, action: act, actionT: at, actionDur: 1, blocking: false, armed: true });
    if (this.shell) {
      this.shell.rotation.y += dt * 0.6;
      const s = 1 + Math.sin(this.t * 3) * 0.04;
      this.shell.scaling.setAll(s);
    }
  }

  protected override animateDeath(dt: number, k: number): void {
    this.rig.animate(dt, { speed: 0, grounded: true, vy: 0, action: k < 0.6 ? "kneel" : "death", actionT: k < 0.6 ? 0.5 : (k - 0.6) * 2.5, actionDur: 1, blocking: false, armed: true });
    if (this.shell) this.shell.scaling.setAll(1 + k * 2);
    if (this.shell) (this.shell.material as StandardMaterial).alpha = 0.22 * (1 - k);
  }

  override dispose(): void {
    if (this.aura) {
      this.aura.stop();
      this.aura.disposeOnStop = true;
    }
    super.dispose();
  }
}
