import { Vector3, Color4, Color3, MeshBuilder, StandardMaterial, Mesh, PointLight } from "@babylonjs/core";
import type { Game } from "../core/Game";
import { buildWeapon, rainbowMaterial } from "../entities/Props";
import { SHARD_INFO, SHARD_ORDER } from "../data/items";
import { easeInOut, yawTo } from "../core/MathUtil";
import type { Combatant } from "./CombatSystem";

export interface Ability {
  key: string;
  name: string;
  color: string;
  cost: number;
  cooldown: number;
  cd: number;
}

/** The Rainbow Sword: forging cinematic, five shard abilities and the prismatic ultimate. */
export class MagicWeaponSystem {
  energy = 50;
  maxEnergy = 100;
  abilities: Ability[] = [
    { key: "Digit1", name: "Flame Wave", color: "#ff3b30", cost: 20, cooldown: 3, cd: 0 },
    { key: "Digit2", name: "Nature's Grace", color: "#34e05a", cost: 25, cooldown: 10, cd: 0 },
    { key: "Digit3", name: "Frost Nova", color: "#3ab0ff", cost: 25, cooldown: 8, cd: 0 },
    { key: "Digit4", name: "Light Beam", color: "#f4f4ff", cost: 30, cooldown: 6, cd: 0 },
    { key: "Digit5", name: "Chain Lightning", color: "#ffd60a", cost: 30, cooldown: 7, cd: 0 },
  ];
  ultimateCd = 0;
  forged = false;
  private healT = 0;

  constructor(private game: Game) {}

  init(): void {}

  get active(): boolean {
    return this.forged && this.game.player.weaponId === "rainbow_sword";
  }

  addEnergy(n: number): void {
    this.energy = Math.min(this.maxEnergy, this.energy + n);
  }

  update(dt: number): void {
    const g = this.game;
    for (const a of this.abilities) a.cd = Math.max(0, a.cd - dt);
    this.ultimateCd = Math.max(0, this.ultimateCd - dt);
    if (this.forged) this.addEnergy(dt * 2.5);
    if (this.healT > 0) {
      this.healT -= dt;
      g.player.hp = Math.min(g.player.maxHp, g.player.hp + 6 * dt);
    }
    if (!this.active || g.state !== "playing" || !g.player.canAct()) return;
    const inp = g.input;
    this.abilities.forEach((a, i) => {
      if (inp.wasPressed(a.key)) this.cast(i);
    });
    if (inp.wasPressed("KeyR")) this.ultimate();
  }

  private cast(i: number): void {
    const g = this.game;
    const a = this.abilities[i];
    if (a.cd > 0) return;
    if (this.energy < a.cost) {
      g.ui.toast("Not enough prismatic energy", "warn");
      g.audio.sfx("fizzle");
      return;
    }
    this.energy -= a.cost;
    a.cd = a.cooldown;
    const p = g.player;
    const lock = g.combat.lockTarget;
    if (lock && lock.alive) p.yaw = yawTo(p.position.x, p.position.z, lock.position.x, lock.position.z);
    const fwd = new Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const chest = p.position.add(new Vector3(0, 1.3, 0));
    const col = Color3.FromHexString(a.color);
    p.playAction(i === 1 ? "raise" : "cast", 0.55);
    g.audio.sfx("ability" + (i + 1));
    switch (i) {
      case 0: {
        // Fire slash: a wave of flames
        for (let k = -2; k <= 2; k++) {
          const ang = p.yaw + k * 0.12;
          g.combat.spawnProjectile({ from: chest.add(fwd.scale(1)), dir: new Vector3(Math.sin(ang), 0, Math.cos(ang)), speed: 22, damage: 38, owner: "player", element: "fire", color: "#ff5a1a", size: 0.8, life: 1.2, pierce: true, knock: 5 });
        }
        g.fx.burst(chest.add(fwd.scale(1.5)), { count: 50, color1: new Color4(1, 0.5, 0.1, 1), color2: new Color4(1, 0.2, 0.05, 1), tex: "spark", size: [0.2, 0.6], speed: [4, 10], dir: fwd, spread: 0.5 });
        break;
      }
      case 1: {
        // Nature strike: heal + push enemies
        p.heal(25);
        this.healT = 5;
        g.combat.damageArea(p.position, 5, 25, "nature", 8);
        g.fx.burst(chest, { count: 70, color1: new Color4(0.3, 1, 0.4, 1), color2: new Color4(0.9, 1, 0.5, 1), tex: "star", size: [0.1, 0.4], speed: [1, 5], gravity: 1 });
        g.fx.shockRing(p.position.x, p.position.y, p.position.z, "#34e05a", 6, 0.5);
        break;
      }
      case 2: {
        // Ice blast: freeze enemies
        const hit = g.combat.damageArea(p.position, 8, 28, "ice", 2);
        for (const c of hit) c.freeze?.(3.5);
        g.fx.shockRing(p.position.x, p.position.y, p.position.z, "#9fe8ff", 8, 0.5);
        g.fx.burst(p.position.add(new Vector3(0, 0.5, 0)), { count: 90, color1: new Color4(0.7, 0.9, 1, 1), color2: new Color4(1, 1, 1, 1), tex: "star", size: [0.1, 0.5], speed: [5, 12], gravity: -2 });
        break;
      }
      case 3: {
        // Light beam
        const len = 32;
        const beam = MeshBuilder.CreateCylinder("lightBeam", { height: len, diameter: 0.9, tessellation: 10 }, g.scene);
        const m = new StandardMaterial("beamMat", g.scene);
        m.emissiveColor = new Color3(1, 1, 0.95);
        m.diffuseColor = new Color3(0, 0, 0);
        m.alpha = 0.85;
        m.disableLighting = true;
        beam.material = m;
        beam.rotation.x = Math.PI / 2;
        beam.rotation.y = p.yaw;
        beam.position.copyFrom(chest.add(fwd.scale(len / 2 + 0.8)));
        g.glow.addIncludedOnlyMesh(beam);
        g.fx.animateMesh(beam, 0.5, (k, mm) => {
          mm.scaling.x = mm.scaling.z = 1 - k * 0.8;
          m.alpha = 0.85 * (1 - k);
        });
        const interior = g.interiors.current?.def.id ?? null;
        for (const c of g.combat.combatants) {
          if (!c.alive || c.interior !== interior) continue;
          const dx = c.position.x - p.position.x, dz = c.position.z - p.position.z;
          const along = dx * fwd.x + dz * fwd.z;
          const side = Math.abs(dx * fwd.z - dz * fwd.x);
          if (along > 0 && along < len && side < c.radius + 1.2) {
            const dmg = c.dark ? 90 : 40;
            c.takeHit({ damage: dmg, from: p.position.clone(), knockback: 4, element: "light", source: "magic" });
            g.ui.floatText(c.lockPoint().add(new Vector3(0, 0.8, 0)), `${dmg}`, "#ffffff", 1.3);
          }
        }
        g.fx.flashLight(chest.add(fwd.scale(6)), new Color3(1, 1, 0.9), 4, 30, 0.4);
        g.camera.shake(0.3);
        break;
      }
      case 4: {
        // Chain lightning on up to six nearby enemies
        const interior = g.interiors.current?.def.id ?? null;
        const targets = [...g.combat.combatants].filter((c) => c.alive && c.interior === interior && Math.hypot(c.position.x - p.position.x, c.position.z - p.position.z) < 20).slice(0, 6);
        let from = chest.clone();
        targets.forEach((c, k) => {
          setTimeout(() => {
            if (!c.alive) return;
            const to = c.lockPoint();
            this.bolt(from, to);
            c.takeHit({ damage: 48, from: p.position.clone(), knockback: 3, element: "lightning", source: "magic" });
            g.ui.floatText(to.add(new Vector3(0, 0.8, 0)), "48", "#ffe14a");
            from = to;
            g.audio.sfx("thunder", to);
          }, k * 110);
        });
        if (!targets.length) {
          const to = chest.add(fwd.scale(10)).add(new Vector3(0, -1, 0));
          this.bolt(chest, to);
        }
        break;
      }
    }
    g.fx.flashLight(chest, col, 2, 10, 0.3);
  }

  private bolt(a: Vector3, b: Vector3): void {
    const g = this.game;
    const d = b.subtract(a);
    const L = d.length();
    const m = MeshBuilder.CreateCylinder("chain", { height: L, diameter: 0.18, tessellation: 5 }, g.scene);
    const mat = new StandardMaterial("chainMat", g.scene);
    mat.emissiveColor = new Color3(1, 0.95, 0.5);
    mat.disableLighting = true;
    m.material = mat;
    m.position.copyFrom(a.add(d.scale(0.5)));
    const dir = d.normalize();
    m.rotation.x = Math.acos(Math.max(-1, Math.min(1, dir.y)));
    m.rotation.y = Math.atan2(dir.x, dir.z);
    g.glow.addIncludedOnlyMesh(m);
    g.fx.animateMesh(m, 0.25, (k, mm) => (mm.visibility = 1 - k));
    g.fx.burst(b, { count: 25, color1: new Color4(1, 0.95, 0.5, 1), tex: "spark", size: [0.05, 0.25], speed: [3, 8], life: [0.2, 0.4] });
  }

  private ultimate(): void {
    const g = this.game;
    if (this.energy < this.maxEnergy || this.ultimateCd > 0) {
      g.ui.toast(this.energy < this.maxEnergy ? "The Prismatic Nova needs full energy" : "Not ready", "warn");
      return;
    }
    this.energy = 0;
    this.ultimateCd = 20;
    const p = g.player;
    p.playAction("raise", 1.4);
    p.iframes = 1.6;
    g.addHitStop(0.25);
    g.audio.sfx("ultimate");
    const center = p.position.add(new Vector3(0, 1, 0));
    const cols = ["#ff3b30", "#34e05a", "#3ab0ff", "#f4f4ff", "#ffd60a"];
    cols.forEach((hex, i) => {
      setTimeout(() => {
        const c = Color3.FromHexString(hex);
        g.fx.shockRing(p.position.x, p.position.y, p.position.z, hex, 6 + i * 3.5, 0.7);
        g.fx.burst(center.add(new Vector3(0, 1, 0)), { count: 90, color1: new Color4(c.r, c.g, c.b, 1), color2: new Color4(1, 1, 1, 1), tex: "star", size: [0.2, 0.9], speed: [8, 22], gravity: -1, life: [0.6, 1.5] });
      }, i * 120);
    });
    setTimeout(() => {
      const dome = MeshBuilder.CreateSphere("nova", { diameter: 2, segments: 24 }, g.scene);
      const m = rainbowMaterial(g.scene).clone("novaMat") as StandardMaterial;
      m.alpha = 0.6;
      m.backFaceCulling = false;
      dome.material = m;
      dome.position.copyFrom(center);
      g.glow.addIncludedOnlyMesh(dome);
      g.fx.animateMesh(dome, 0.9, (k, mm) => {
        mm.scaling.setAll(1 + k * 17);
        m.alpha = 0.6 * (1 - k);
      });
      g.combat.damageArea(p.position, 17, 220, "rainbow", 14);
      g.fx.flashLight(center, new Color3(1, 1, 1), 10, 60, 1);
      g.ui.screenFlash(0.7, "#ffffff");
      g.camera.shake(1.2);
    }, 650);
  }

  // ------------------------------------------------------------------------------------ forging
  async forgeSword(): Promise<void> {
    const g = this.game;
    const cin = g.cinematics;
    const site = g.world.site("forge");
    const anvil = site.anchors.anvil;
    const smith = g.npcs.byId("swordmaker");
    cin.begin();
    g.audio.setMusic("forge");
    g.player.frozen = true;
    // put the player in front of the anvil
    const fwd = new Vector3(Math.sin(site.yaw), 0, Math.cos(site.yaw));
    const ppos = anvil.add(fwd.scale(3.2));
    ppos.y = g.physics.groundHeight(ppos.x, ppos.z, ppos.y + 2);
    g.player.teleport(ppos.x, ppos.y, ppos.z, site.yaw + Math.PI);
    // the ancient blade on the anvil
    const blade = buildWeapon(g.scene, { model: "rainbow" });
    const greyMat = new StandardMaterial("greyBlade", g.scene);
    greyMat.diffuseColor = new Color3(0.45, 0.45, 0.48);
    greyMat.specularColor = new Color3(0.6, 0.6, 0.6);
    blade.blade.material = greyMat;
    blade.root.position.copyFrom(anvil.add(new Vector3(0, 0.05, 0)));
    blade.root.rotation.set(Math.PI / 2, site.yaw + Math.PI / 2, 0);
    const side = new Vector3(Math.cos(site.yaw), 0, -Math.sin(site.yaw));
    const camPos = anvil.add(fwd.scale(5)).add(side.scale(3)).add(new Vector3(0, 2.4, 0));
    await cin.shot(camPos.add(new Vector3(0, 3, 0)), camPos, anvil.add(new Vector3(0, 2, 0)), anvil.add(new Vector3(0, 0.6, 0)), 2.5);
    g.ui.subtitle("Mestre Ferran: \"Fire, Nature, Ice, Light and Lightning... return to the blade you were born to be.\"");
    // shards fly in one by one
    const glows: Mesh[] = [];
    for (let i = 0; i < SHARD_ORDER.length; i++) {
      const color = SHARD_ORDER[i];
      const info = SHARD_INFO[color];
      const c = Color3.FromHexString(info.hex);
      const shard = MeshBuilder.CreatePolyhedron("flyShard", { type: 1, size: 0.3 }, g.scene);
      shard.scaling.set(0.7, 1.5, 0.7);
      const sm = new StandardMaterial("fs" + i, g.scene);
      sm.emissiveColor = c;
      sm.diffuseColor = c;
      shard.material = sm;
      g.glow.addIncludedOnlyMesh(shard);
      const start = g.player.position.add(new Vector3(0, 1.8, 0));
      const end = anvil.add(new Vector3(0, 0.3, 0)).add(side.scale((i - 2) * 0.22));
      g.audio.sfx("shardChime" + i);
      await new Promise<void>((res) => {
        let t = 0;
        g.fx.addUpdater((dt) => {
          t += dt;
          const k = easeInOut(Math.min(1, t / 0.9));
          const pos = Vector3.Lerp(start, end, k);
          pos.y += Math.sin(k * Math.PI) * 1.6;
          shard.position.copyFrom(pos);
          shard.rotation.y += dt * 10;
          if (k >= 1) {
            res();
            return false;
          }
          return true;
        });
      });
      shard.dispose();
      g.fx.burst(end, { count: 50, color1: new Color4(c.r, c.g, c.b, 1), color2: new Color4(1, 1, 1, 1), tex: "star", size: [0.05, 0.3], speed: [2, 6] });
      g.fx.flashLight(end.add(new Vector3(0, 0.5, 0)), c, 4, 15, 0.6);
      const stripe = MeshBuilder.CreateBox("stripe", { width: 0.03, height: 0.22, depth: 0.03 }, g.scene);
      stripe.material = sm;
      stripe.parent = blade.base;
      stripe.position.set(0, 0.3 + i * 0.22, 0.02);
      glows.push(stripe);
      g.glow.addIncludedOnlyMesh(stripe);
      await cin.wait(0.35);
    }
    // the smith strikes
    if (smith) smith.action = "hammer";
    g.ui.subtitle("Mestre Ferran: \"Now... the colours become one!\"");
    for (let k = 0; k < 3; k++) {
      await cin.wait(0.55);
      g.audio.sfx("anvil");
      g.fx.hitSpark(anvil.add(new Vector3(0, 0.5, 0)), new Color4(1, 0.9, 0.6, 1), true);
      g.camera.shake(0.25);
    }
    // explosion of coloured light
    g.audio.sfx("victoryBlast");
    for (const color of SHARD_ORDER) {
      const c = Color3.FromHexString(SHARD_INFO[color].hex);
      g.fx.burst(anvil.add(new Vector3(0, 0.8, 0)), { count: 140, color1: new Color4(c.r, c.g, c.b, 1), color2: new Color4(1, 1, 1, 1), tex: "star", size: [0.1, 0.7], speed: [5, 18], gravity: -1, life: [0.8, 2] });
    }
    const lights: PointLight[] = [];
    SHARD_ORDER.forEach((color, i) => {
      const l = new PointLight("forgeL" + i, anvil.add(new Vector3(Math.sin(i * 1.25) * 3, 2, Math.cos(i * 1.25) * 3)), g.scene);
      l.diffuse = Color3.FromHexString(SHARD_INFO[color].hex);
      l.intensity = 4;
      l.range = 25;
      lights.push(l);
    });
    g.ui.screenFlash(1.4, "#ffffff");
    g.camera.shake(1);
    for (const s of glows) s.dispose();
    blade.blade.material = rainbowMaterial(g.scene);
    g.glow.addIncludedOnlyMesh(blade.blade);
    const trailPs = g.fx.emitter(blade.tip as any, { rate: 80, color1: new Color4(1, 0.4, 0.4, 1), color2: new Color4(0.4, 0.6, 1, 1), size: [0.05, 0.3], life: [0.5, 1.2], speed: [0.5, 2], tex: "star", box: 0.3 });
    // the blade rises and spins
    const base = blade.root.position.clone();
    await new Promise<void>((res) => {
      let t = 0;
      g.fx.addUpdater((dt) => {
        t += dt;
        const k = Math.min(1, t / 2.6);
        blade.root.position.copyFrom(base.add(new Vector3(0, easeInOut(k) * 2.2, 0)));
        blade.root.rotation.set(0, t * 4, 0);
        for (const l of lights) l.intensity = 4 * (1 - k * 0.7);
        if (k >= 1) {
          res();
          return false;
        }
        return true;
      });
    });
    g.ui.bigTitle("THE RAINBOW SWORD", "Forged from the five shards of Andorra", "#ffffff", 4);
    await cin.orbit(blade.root.position, 4.5, 0.5, Math.atan2(camPos.x - anvil.x, camPos.z - anvil.z), Math.atan2(camPos.x - anvil.x, camPos.z - anvil.z) + 1.4, 3.2);
    // the sword flies into the hero's hand
    const from = blade.root.position.clone();
    await new Promise<void>((res) => {
      let t = 0;
      g.fx.addUpdater((dt) => {
        t += dt;
        const k = easeInOut(Math.min(1, t / 0.8));
        blade.root.position.copyFrom(Vector3.Lerp(from, g.player.position.add(new Vector3(0, 2.5, 0)), k));
        if (k >= 1) {
          res();
          return false;
        }
        return true;
      });
    });
    trailPs.stop();
    trailPs.disposeOnStop = true;
    blade.root.dispose();
    for (const l of lights) l.dispose();
    this.forged = true;
    this.energy = this.maxEnergy;
    g.inventory.add("rainbow_sword", 1, true);
    g.inventory.equip("rainbow_sword");
    g.player.buildRig();
    g.player.playAction("raise", 2.5);
    g.fx.burst(g.player.position.add(new Vector3(0, 2.8, 0)), { count: 160, color1: new Color4(1, 0.5, 0.8, 1), color2: new Color4(0.5, 0.9, 1, 1), tex: "star", size: [0.1, 0.5], speed: [3, 10], life: [0.6, 1.6] });
    const pp = g.player.position;
    await cin.shot(pp.add(new Vector3(Math.sin(site.yaw) * -2 + 2, 2, Math.cos(site.yaw) * -2)), pp.add(new Vector3(Math.sin(site.yaw + Math.PI) * 4, 2.5, Math.cos(site.yaw + Math.PI) * 4)), pp.add(new Vector3(0, 2, 0)), pp.add(new Vector3(0, 2.2, 0)), 2.5);
    g.ui.subtitle(null);
    if (smith) smith.action = null;
    cin.end();
    g.player.frozen = false;
    g.audio.setMusic("explore");
    g.events.emit("swordForged");
    await g.dialogue.run(async () => {
      await g.dialogue.say("Mestre Ferran", [
        "It is done. The Rainbow Sword lives again.",
        this.game.ui.isTouch
          ? "Its five colours answer your will: Flame Wave, Nature's Grace, Frost Nova, Light Beam and Chain Lightning. Tap their icons to call on them."
          : "Its five colours answer your will: [1] Flame Wave, [2] Nature's Grace, [3] Frost Nova, [4] Light Beam, [5] Chain Lightning.",
        `Strike your foes to charge its prismatic energy, then ${this.game.ui.isTouch ? "tap the rainbow icon" : "press [R]"} to unleash the Prismatic Nova.`,
        "Its light softens the poison cloud's bite. Now go — Comapedrosa. Only this blade can end Zorg forever.",
      ]);
    });
    g.save.autosave("forge");
  }

  serialize() {
    return { energy: this.energy, forged: this.forged };
  }
  deserialize(d: any) {
    if (!d) return;
    this.energy = d.energy ?? 50;
    this.forged = !!d.forged;
  }

  /** Used by UI. */
  lockTargetName(): string | null {
    const t: Combatant | null = this.game.combat.lockTarget;
    return t ? t.name : null;
  }
}
