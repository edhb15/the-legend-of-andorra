import { Vector3, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, PointLight } from "@babylonjs/core";
import type { Game } from "../core/Game";
import { Boss } from "../entities/bosses/Boss";
import { FlameBeast, ForestGuardian, FrostDragon, ShadowKnight, ThunderTitan } from "../entities/bosses/Bosses";
import { Zorg } from "../entities/bosses/Zorg";
import { SHARD_INFO, ShardColor } from "../data/items";
import { yawTo, easeInOut } from "../core/MathUtil";

export type BossId = "flame" | "forest" | "frost" | "shadow" | "thunder" | "zorg";

interface BossSlot {
  id: BossId;
  siteId: string;
  interior: string | null;
  boss: Boss | null;
  defeated: boolean;
  shardTaken: boolean;
  center: Vector3;
  r: number;
  barrier: Mesh | null;
  ringIdx: number;
  color: string;
  shardMesh: Mesh | null;
  fighting: boolean;
}

const COLORS: Record<BossId, string> = { flame: "#ff5a1a", forest: "#5aff3a", frost: "#6fd0ff", shadow: "#c8c8ff", thunder: "#ffe14a", zorg: "#a23cff" };

export class BossManager {
  slots: BossSlot[] = [];
  active: BossSlot | null = null;

  constructor(private game: Game) {}

  init(): void {
    const g = this.game;
    const defs: [BossId, string, string | null][] = [
      ["flame", "boss_flame", "flame_cave"], ["forest", "boss_forest", null], ["frost", "boss_frost", "frost_cave"],
      ["shadow", "boss_shadow", null], ["thunder", "boss_thunder", null], ["zorg", "zorgcave", "zorg_cave"],
    ];
    for (const [id, siteId, interior] of defs) {
      let center: Vector3, r: number;
      if (interior) {
        const a = g.interiors.level(interior).arena!;
        center = a.center;
        r = a.r;
      } else {
        const s = g.world.site(siteId);
        center = new Vector3(s.x, g.physics.groundHeight(s.x, s.z, 1e5), s.z);
        r = s.r;
      }
      g.physics.rings.push({ x: center.x, z: center.z, r: r + 1, inside: true, enabled: false });
      this.slots.push({ id, siteId, interior, boss: null, defeated: false, shardTaken: false, center, r, barrier: null, ringIdx: g.physics.rings.length - 1, color: COLORS[id], shardMesh: null, fighting: false });
    }
    this.updateSafeZones();
  }

  slot(id: BossId): BossSlot {
    return this.slots.find((s) => s.id === id)!;
  }

  defeatedCount(): number {
    return this.slots.filter((s) => s.defeated && s.id !== "zorg").length;
  }

  /** Lairs of living guardians repel the poison cloud. */
  updateSafeZones(): void {
    const g = this.game;
    for (const s of this.slots) {
      if (s.interior) continue;
      if (!s.defeated) g.poison.setSafeZone("boss_" + s.id, s.center.x, s.center.z, s.r + 45, 1);
      else g.poison.removeSafeZone("boss_" + s.id);
    }
    // cave mouths too
    for (const s of this.slots) {
      if (!s.interior) continue;
      const site = g.world.site(s.siteId);
      if (!s.defeated) g.poison.setSafeZone("cave_" + s.id, site.x, site.z, 40, s.id === "zorg" ? 0.6 : 1);
      else g.poison.removeSafeZone("cave_" + s.id);
    }
  }

  private makeBoss(id: BossId): Boss {
    const g = this.game;
    switch (id) {
      case "flame": return new FlameBeast(g);
      case "forest": return new ForestGuardian(g);
      case "frost": return new FrostDragon(g);
      case "shadow": return new ShadowKnight(g);
      case "thunder": return new ThunderTitan(g);
      case "zorg": return new Zorg(g);
    }
  }

  private ensureBoss(s: BossSlot): void {
    if (s.boss || s.defeated) return;
    const b = this.makeBoss(s.id);
    // face the arena entrance (towards the player's likely approach)
    const p = this.game.player.position;
    const yaw = yawTo(s.center.x, s.center.z, p.x, p.z);
    const pos = s.center.add(new Vector3(-Math.sin(yaw) * s.r * 0.35, 0, -Math.cos(yaw) * s.r * 0.35));
    b.place(s.center, s.r, pos, yaw);
    s.boss = b;
  }

  private disposeBoss(s: BossSlot): void {
    if (s.boss) {
      s.boss.dispose();
      s.boss = null;
    }
  }

  private setBarrier(s: BossSlot, on: boolean): void {
    const g = this.game;
    g.physics.rings[s.ringIdx].enabled = on;
    if (on && !s.barrier) {
      const m = MeshBuilder.CreateCylinder("barrier", { height: 16, diameter: (s.r + 1) * 2, tessellation: 48, cap: 0, sideOrientation: Mesh.DOUBLESIDE }, g.scene);
      const mat = new StandardMaterial("barrierMat", g.scene);
      const c = Color3.FromHexString(s.color);
      mat.emissiveColor = c.scale(0.6);
      mat.diffuseColor = new Color3(0, 0, 0);
      mat.alpha = 0.16;
      mat.backFaceCulling = false;
      mat.disableLighting = true;
      m.material = mat;
      m.position.set(s.center.x, s.center.y + 6, s.center.z);
      s.barrier = m;
    }
    if (s.barrier) s.barrier.setEnabled(on);
  }

  /** Called when the player dies: undefeated bosses reset. */
  resetActive(): void {
    const s = this.active;
    if (!s) return;
    this.setBarrier(s, false);
    s.fighting = false;
    this.disposeBoss(s);
    this.active = null;
    this.game.ui.hideBossBar();
    this.game.enemies.killAllHostile();
    this.game.combat.clearHostile();
  }

  private async startFight(s: BossSlot): Promise<void> {
    const g = this.game;
    const b = s.boss!;
    s.fighting = true;
    this.active = s;
    b.state = "intro";
    this.setBarrier(s, true);
    g.audio.setMusic(s.id === "zorg" ? "finalboss" : "boss");
    await g.cinematics.bossIntro(b, s.color);
    if (!s.boss || s.defeated) return;
    b.activate();
    g.ui.showBossBar(b.name, b.title);
    g.events.emit("bossFightStart", s.id);
  }

  onBossDefeated(b: Boss): void {
    const g = this.game;
    const s = this.slots.find((q) => q.boss === b);
    if (!s) return;
    s.defeated = true;
    s.fighting = false;
    this.active = null;
    g.ui.hideBossBar();
    g.enemies.killAllHostile();
    g.timeScale = 0.35;
    g.audio.sfx("bossDeath", b.position);
    g.audio.setMusic("victory");
    setTimeout(() => (g.timeScale = 1), 1800);
    g.events.emit("bossDefeated", s.id);
    if (s.id === "zorg") {
      g.cinematics.zorgDefeated(b);
      return;
    }
    // explosion of light after the death animation
    setTimeout(() => {
      const pos = b.lockPoint();
      g.fx.deathPuff(pos, 3, new Color4(0.1, 0.05, 0.12, 0.9));
      const c = Color3.FromHexString(s.color);
      g.fx.burst(pos, { count: 160, color1: new Color4(c.r, c.g, c.b, 1), color2: new Color4(1, 1, 1, 1), size: [0.2, 1], speed: [6, 18], life: [0.6, 1.6], tex: "star", gravity: -2 });
      g.fx.flashLight(pos, c, 8, 50, 1.2);
      g.ui.screenFlash(0.6);
      g.camera.shake(0.8);
      this.disposeBoss(s);
      this.setBarrier(s, false);
      this.spawnShard(s, pos);
      this.updateSafeZones();
      g.ui.bigTitle("VICTORY", `${b.name} has fallen`, s.color);
    }, 3200);
  }

  private spawnShard(s: BossSlot, pos: Vector3): void {
    const g = this.game;
    const color = this.shardColor(s.id);
    const info = SHARD_INFO[color];
    const m = MeshBuilder.CreatePolyhedron("shard", { type: 1, size: 0.55 }, g.scene);
    m.scaling.set(0.7, 1.6, 0.7);
    const mat = new StandardMaterial("shardMat_" + color, g.scene);
    const c = Color3.FromHexString(info.hex);
    mat.emissiveColor = c;
    mat.diffuseColor = c.scale(0.5);
    mat.specularColor = new Color3(1, 1, 1);
    m.material = mat;
    g.glow.addIncludedOnlyMesh(m);
    const base = new Vector3(pos.x, g.physics.groundHeight(pos.x, pos.z, pos.y + 5) + 0.5, pos.z);
    m.position.copyFrom(base);
    s.shardMesh = m;
    const light = new PointLight("shardLight", base.clone(), g.scene);
    light.diffuse = c;
    light.intensity = 2;
    light.range = 16;
    const ps = g.fx.emitter(m, { rate: 40, color1: new Color4(c.r, c.g, c.b, 1), color2: new Color4(1, 1, 1, 0.8), size: [0.05, 0.25], life: [0.6, 1.4], speed: [0.3, 1.2], tex: "star", box: 0.4, capacity: 80 });
    let t = 0;
    let collecting = false;
    let ct = 0;
    const start = new Vector3();
    g.fx.addUpdater((dt) => {
      t += dt;
      if (!collecting) {
        const rise = Math.min(1, t / 2) * 2.0;
        m.position.set(base.x, base.y + rise + Math.sin(t * 2) * 0.25, base.z);
        m.rotation.y += dt * 1.5;
        light.position.copyFrom(m.position);
        light.intensity = 2 + Math.sin(t * 4) * 0.6;
        const p = g.player.position;
        if (t > 2 && Math.hypot(p.x - m.position.x, p.z - m.position.z) < 4 && !g.player.dead && g.state === "playing") {
          collecting = true;
          start.copyFrom(m.position);
          g.audio.sfx("shardCollect");
          g.player.playAction("raise", 2.4);
          g.player.frozen = true;
        }
        return true;
      }
      ct += dt;
      const k = Math.min(1, ct / 1.0);
      const target = g.player.position.add(new Vector3(0, 2.3, 0));
      const pp = Vector3.Lerp(start, target, easeInOut(k));
      pp.y += Math.sin(k * Math.PI) * 2;
      m.position.copyFrom(pp);
      m.rotation.y += dt * 8;
      light.position.copyFrom(pp);
      if (k >= 1) {
        m.dispose();
        light.dispose();
        ps.stop();
        ps.disposeOnStop = true;
        s.shardTaken = true;
        s.shardMesh = null;
        g.fx.burst(target, { count: 120, color1: new Color4(c.r, c.g, c.b, 1), color2: new Color4(1, 1, 1, 1), size: [0.1, 0.6], speed: [4, 12], life: [0.5, 1.2], tex: "star", gravity: 0 });
        g.fx.flashLight(target, c, 6, 25, 1);
        g.ui.screenFlash(0.5, info.hex);
        g.inventory.add("shard_" + color, 1, true);
        g.ui.bigTitle(`${info.name.toUpperCase()} OBTAINED`, `The power of ${info.element} flows through you`, info.hex);
        g.events.emit("shardCollected", color);
        setTimeout(() => {
          g.player.frozen = false;
          g.save.autosave("shard");
        }, 2200);
        return false;
      }
      return true;
    });
  }

  shardColor(id: BossId): ShardColor {
    return ({ flame: "red", forest: "green", frost: "blue", shadow: "white", thunder: "yellow" } as Record<string, ShardColor>)[id];
  }

  update(dt: number): void {
    const g = this.game;
    const p = g.player.position;
    const interior = g.interiors.current?.def.id ?? null;
    for (const s of this.slots) {
      const sameSpace = s.interior === interior;
      const d = Math.hypot(p.x - s.center.x, p.z - s.center.z);
      if (s.defeated) {
        if (s.boss && s.boss.state === "dying") s.boss.update(dt);
        // a shard left behind (e.g. after loading a save) waits in the arena
        if (!s.boss && s.id !== "zorg" && !s.shardTaken && !s.shardMesh && sameSpace && d < 150) this.spawnShard(s, s.center.add(new Vector3(0, 1, 0)));
        continue;
      }
      if (sameSpace && d < (s.interior ? 400 : 260)) this.ensureBoss(s);
      else if (s.boss && !s.fighting) this.disposeBoss(s);
      if (!s.boss) continue;
      s.boss.update(dt);
      if (!s.fighting && sameSpace && d < s.r * 0.8 && g.state === "playing" && !g.player.dead) {
        if (s.id === "zorg" && !g.inventory.has("rainbow_sword")) continue;
        void this.startFight(s);
      }
      if (s.fighting && s.boss.alive) g.ui.updateBossBar(s.boss.hp / s.boss.maxHp, s.boss.phase);
    }
  }

  serialize() {
    return { slots: this.slots.map((s) => ({ id: s.id, defeated: s.defeated, shardTaken: s.shardTaken })) };
  }
  deserialize(d: any) {
    if (!d?.slots) return;
    for (const q of d.slots) {
      const s = this.slots.find((x) => x.id === q.id);
      if (!s) continue;
      s.defeated = !!q.defeated;
      s.shardTaken = !!q.shardTaken;
      if (s.defeated) this.disposeBoss(s);
      this.setBarrier(s, false);
      s.fighting = false;
    }
    this.active = null;
    this.updateSafeZones();
  }
}
