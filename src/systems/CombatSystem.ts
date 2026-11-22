import { Vector3, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, ParticleSystem } from "@babylonjs/core";
import type { Game } from "../core/Game";
import { clamp, wrapAngle, yawTo } from "../core/MathUtil";
import { glowMaterial } from "../entities/CharacterKit";

export type Element = "fire" | "ice" | "lightning" | "nature" | "dark" | "poison" | "physical" | "light" | "rainbow";

export interface HitInfo {
  damage: number;
  from: Vector3;
  knockback: number;
  element?: Element;
  source: "player" | "magic" | "environment";
  heavy?: boolean;
}

/** Anything the player can fight. */
export interface Combatant {
  id: string;
  name: string;
  alive: boolean;
  position: Vector3;
  radius: number;
  height: number;
  dark: boolean;
  isBoss: boolean;
  hp: number;
  maxHp: number;
  lockPoint(): Vector3;
  takeHit(h: HitInfo): void;
  freeze?(dur: number): void;
  interior: string | null;
}

interface Projectile {
  pos: Vector3;
  vel: Vector3;
  radius: number;
  damage: number;
  owner: "enemy" | "player";
  element: Element;
  mesh: Mesh;
  ps: ParticleSystem | null;
  life: number;
  gravity: number;
  aoe: number;
  homing: number;
  explodeColor: string;
  hit: Set<Combatant>;
  pierce: boolean;
  knock: number;
}

interface Hazard {
  x: number;
  y: number;
  z: number;
  r: number;
  dps: number;
  element: Element;
  life: number;
  owner: "enemy" | "player";
  mesh: Mesh | null;
  ps: ParticleSystem | null;
  tick: number;
}

interface Shockwave {
  x: number;
  y: number;
  z: number;
  r: number;
  maxR: number;
  speed: number;
  damage: number;
  element: Element;
  hit: boolean;
  mesh: Mesh;
  thickness: number;
}

export interface AttackDef {
  dur: number;
  window: [number, number];
  mult: number;
  reach: number;
  arc: number;
  knock: number;
}

export class CombatSystem {
  combatants = new Set<Combatant>();
  lockTarget: Combatant | null = null;
  private projectiles: Projectile[] = [];
  private hazards: Hazard[] = [];
  private waves: Shockwave[] = [];
  private projMats = new Map<string, StandardMaterial>();

  constructor(private game: Game) {}

  register(c: Combatant): void {
    this.combatants.add(c);
  }
  unregister(c: Combatant): void {
    this.combatants.delete(c);
    if (this.lockTarget === c) this.lockTarget = null;
  }

  private activeInterior(): string | null {
    return this.game.interiors.current ? this.game.interiors.current.def.id : null;
  }

  nearestEnemy(pos: Vector3, range: number, yaw?: number, arc?: number): Combatant | null {
    let best: Combatant | null = null;
    let bd = range;
    const interior = this.activeInterior();
    for (const c of this.combatants) {
      if (!c.alive || c.interior !== interior) continue;
      const d = Math.hypot(c.position.x - pos.x, c.position.z - pos.z) - c.radius;
      if (d > bd) continue;
      if (yaw !== undefined && arc !== undefined) {
        const a = Math.abs(wrapAngle(yawTo(pos.x, pos.z, c.position.x, c.position.z) - yaw));
        if (a > arc) continue;
      }
      bd = d;
      best = c;
    }
    return best;
  }

  toggleLock(): void {
    if (this.lockTarget) {
      this.lockTarget = null;
      return;
    }
    const g = this.game;
    const p = g.player.position;
    const camYaw = g.camera.yaw;
    let best: Combatant | null = null;
    let bestScore = Infinity;
    const interior = this.activeInterior();
    for (const c of this.combatants) {
      if (!c.alive || c.interior !== interior) continue;
      const d = Math.hypot(c.position.x - p.x, c.position.z - p.z);
      if (d > 35) continue;
      const a = Math.abs(wrapAngle(yawTo(p.x, p.z, c.position.x, c.position.z) - camYaw));
      if (a > 1.3) continue;
      const score = d + a * 12 - (c.isBoss ? 20 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    this.lockTarget = best;
    if (best) g.audio.sfx("lock");
  }

  /** Player melee swing evaluation (called each frame during the hit window). */
  playerSwing(name: string, a: AttackDef, hitDone: Set<any>, landed = false): void {
    const g = this.game;
    const pl = g.player;
    const w = pl.weaponStats;
    const reach = w.reach * a.reach;
    const p = pl.position;
    const interior = this.activeInterior();
    for (const c of this.combatants) {
      if (!c.alive || hitDone.has(c) || c.interior !== interior) continue;
      const dx = c.position.x - p.x, dz = c.position.z - p.z;
      const d = Math.hypot(dx, dz) - c.radius;
      if (d > reach) continue;
      if (c.position.y > p.y + 2.5 || c.position.y + c.height < p.y - 0.5) continue;
      if (a.arc < 6) {
        const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - pl.yaw));
        if (ang > a.arc / 2 && d > 0.6) continue;
      }
      hitDone.add(c);
      let dmg = w.damage * (1 + 0.15 * (g.inventory.upgrades[pl.weaponId] ?? 0)) * a.mult * (0.9 + Math.random() * 0.2);
      const crit = Math.random() < 0.1;
      if (crit) dmg *= 1.5;
      const rainbow = pl.weaponId === "rainbow_sword";
      if (rainbow && c.dark) dmg *= 1.5;
      const element: Element = rainbow ? "rainbow" : w.element === "fire" ? "fire" : w.element === "ice" ? "ice" : "physical";
      c.takeHit({ damage: dmg, from: p.clone(), knockback: a.knock, element, source: "player", heavy: name === "heavy" || name === "attack3" || name === "plunge" });
      const hitPos = new Vector3(c.position.x - (dx / (d + c.radius || 1)) * c.radius * 0.8, Math.max(p.y + 1.1, c.position.y + Math.min(c.height * 0.5, 2)), c.position.z - (dz / (d + c.radius || 1)) * c.radius * 0.8);
      g.fx.hitSpark(hitPos, rainbow ? new Color4(Math.random(), Math.random(), 1, 1) : new Color4(1, 0.85, 0.5, 1), name === "heavy" || crit);
      g.ui.floatText(hitPos.add(new Vector3(0, 0.6, 0)), `${Math.round(dmg)}${crit ? "!" : ""}`, crit ? "#ffd84a" : rainbow ? "#ff9cf0" : "#ffffff", crit ? 1.4 : 1);
      g.addHitStop(name === "heavy" || name === "attack3" ? 0.09 : 0.05);
      g.camera.shake(name === "heavy" ? 0.35 : 0.18);
      g.audio.sfx(c.isBoss ? "hitHeavy" : "hit");
      if (rainbow) g.magic.addEnergy(dmg * 0.5);
    }
    // trees
    if (!hitDone.has("tree") && !landed) {
      const tx = p.x + Math.sin(pl.yaw) * 1.4, tz = p.z + Math.cos(pl.yaw) * 1.4;
      const trees = g.world.vegetation.treesNear(tx, tz, reach * 0.7);
      if (trees.length) {
        hitDone.add("tree");
        const tr = trees[0];
        const res = g.world.vegetation.hitTree(tr, pl.yaw);
        g.audio.sfx("chop");
        g.fx.burst(new Vector3(tr.x, tr.y + 1.2, tr.z), { count: 12, color1: new Color4(0.55, 0.4, 0.25, 1), color2: new Color4(0.4, 0.6, 0.2, 1), tex: "soft", size: [0.06, 0.18], additive: false, gravity: -9, speed: [1, 4] });
        if (tr.type === 2 && Math.random() < 0.3) g.inventory.spawnPickup("apple", new Vector3(tr.x + Math.random() - 0.5, tr.y + 0.3, tr.z + 1.2));
        if (res.felled) {
          g.audio.sfx("treeFall");
          g.inventory.spawnPickup("wood", new Vector3(tr.x + 1.2, tr.y + 0.3, tr.z));
          g.inventory.spawnPickup("wood", new Vector3(tr.x - 1.0, tr.y + 0.3, tr.z + 0.6));
          if (Math.random() < 0.15) g.inventory.spawnPickup("mushroom", new Vector3(tr.x, tr.y + 0.3, tr.z - 1.2));
          g.events.emit("treeFelled");
        }
      }
    }
  }

  /** Generic AoE damage to combatants (player magic). */
  damageArea(center: Vector3, radius: number, damage: number, element: Element, knock = 4, filter?: (c: Combatant) => boolean): Combatant[] {
    const out: Combatant[] = [];
    const interior = this.activeInterior();
    for (const c of this.combatants) {
      if (!c.alive || c.interior !== interior) continue;
      if (Math.hypot(c.position.x - center.x, c.position.z - center.z) - c.radius > radius) continue;
      if (filter && !filter(c)) continue;
      let dmg = damage;
      if (c.dark && (element === "light" || element === "rainbow")) dmg *= 1.8;
      c.takeHit({ damage: dmg, from: center.clone(), knockback: knock, element, source: "magic" });
      this.game.ui.floatText(c.lockPoint().add(new Vector3(0, 0.8, 0)), `${Math.round(dmg)}`, "#9fe8ff");
      out.push(c);
    }
    return out;
  }

  // ------------------------------------------------------------------ attacks on the player
  meleeHitPlayer(from: Vector3, yaw: number, reach: number, arc: number, damage: number, opts: { knockback?: number; element?: Element; unblockable?: boolean; source?: any } = {}): boolean {
    const p = this.game.player;
    const dx = p.position.x - from.x, dz = p.position.z - from.z;
    const d = Math.hypot(dx, dz);
    if (d > reach + 0.4) return false;
    if (Math.abs(p.position.y - from.y) > 3.5) return false;
    const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - yaw));
    if (ang > arc / 2 && d > 1.2) return false;
    return p.takeDamage(damage, from, { knockback: opts.knockback ?? 4, element: opts.element as any, unblockable: opts.unblockable, source: opts.source });
  }

  aoeHitPlayer(center: Vector3, radius: number, damage: number, opts: { knockback?: number; element?: Element; unblockable?: boolean; source?: any } = {}): boolean {
    const p = this.game.player;
    if (Math.hypot(p.position.x - center.x, p.position.z - center.z) > radius + 0.4) return false;
    if (Math.abs(p.position.y - center.y) > radius + 2) return false;
    return p.takeDamage(damage, center, { knockback: opts.knockback ?? 6, element: opts.element as any, unblockable: opts.unblockable ?? true, source: opts.source });
  }

  coneHitPlayer(origin: Vector3, yaw: number, halfAngle: number, range: number, damage: number, element: Element, source?: any): boolean {
    const p = this.game.player;
    const dx = p.position.x - origin.x, dz = p.position.z - origin.z;
    const d = Math.hypot(dx, dz);
    if (d > range) return false;
    const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - yaw));
    if (ang > halfAngle) return false;
    return p.takeDamage(damage, origin, { knockback: 2, element: element as any, unblockable: false, source });
  }

  private projMat(color: string): StandardMaterial {
    let m = this.projMats.get(color);
    if (!m) {
      m = glowMaterial(this.game.scene, color, 1.6);
      this.projMats.set(color, m);
    }
    return m;
  }

  spawnProjectile(o: {
    from: Vector3; dir?: Vector3; target?: Vector3; speed: number; damage: number; owner: "enemy" | "player"; element: Element; color: string;
    size?: number; gravity?: number; aoe?: number; homing?: number; life?: number; arc?: boolean; pierce?: boolean; knock?: number;
  }): void {
    const g = this.game;
    const size = o.size ?? 0.5;
    const mesh = MeshBuilder.CreateSphere("proj", { diameter: size, segments: 8 }, g.scene);
    mesh.material = this.projMat(o.color);
    mesh.position.copyFrom(o.from);
    g.glow.addIncludedOnlyMesh(mesh);
    let vel: Vector3;
    const grav = o.gravity ?? 0;
    if (o.target && o.arc) {
      // ballistic arc to target
      const d = o.target.subtract(o.from);
      const horiz = Math.hypot(d.x, d.z);
      const tFlight = Math.max(0.6, horiz / o.speed);
      vel = new Vector3(d.x / tFlight, (d.y + 0.5 * grav * tFlight * tFlight) / tFlight, d.z / tFlight);
    } else if (o.target) {
      vel = o.target.subtract(o.from).normalize().scale(o.speed);
    } else vel = (o.dir ?? new Vector3(0, 0, 1)).normalize().scale(o.speed);
    const c = Color3.FromHexString(o.color);
    const ps = g.fx.emitter(mesh, { rate: 60, color1: new Color4(c.r, c.g, c.b, 1), color2: new Color4(1, 1, 1, 0.6), size: [size * 0.3, size * 0.9], life: [0.2, 0.5], speed: [0.1, 0.5], box: size * 0.3, capacity: 80, tex: o.element === "fire" ? "spark" : "soft" });
    this.projectiles.push({
      pos: o.from.clone(), vel, radius: size * 0.6, damage: o.damage, owner: o.owner, element: o.element, mesh, ps, life: o.life ?? 6, gravity: grav,
      aoe: o.aoe ?? 0, homing: o.homing ?? 0, explodeColor: o.color, hit: new Set(), pierce: !!o.pierce, knock: o.knock ?? 4,
    });
  }

  /** Telegraphed strike from the sky / ground after a delay. */
  delayedStrike(x: number, z: number, o: { radius: number; delay: number; damage: number; element: Element; color?: string; owner?: "enemy" | "player"; onStrike?: (pos: Vector3) => void; knock?: number }): void {
    const g = this.game;
    g.fx.telegraph(x, z, { radius: o.radius, delay: o.delay, color: o.color ?? "#ff3322" }, () => {
      const y = g.physics.groundHeight(x, z, 1e5);
      const pos = new Vector3(x, y, z);
      o.onStrike?.(pos);
      if ((o.owner ?? "enemy") === "enemy") this.aoeHitPlayer(pos, o.radius, o.damage, { element: o.element, knockback: o.knock ?? 6 });
      else this.damageArea(pos, o.radius, o.damage, o.element, o.knock ?? 6);
    });
  }

  hazard(x: number, z: number, o: { radius: number; dps: number; element: Element; life: number; color: string; owner?: "enemy" | "player"; particles?: boolean }): void {
    const g = this.game;
    const y = g.physics.groundHeight(x, z, 1e5);
    const mesh = g.fx.groundDecal(x, z, { radius: o.radius, color: o.color, alpha: 0.45 });
    const c = Color3.FromHexString(o.color);
    const ps = o.particles === false ? null : g.fx.emitter(new Vector3(x, y + 0.5, z), { rate: 25 + o.radius * 6, color1: new Color4(c.r, c.g, c.b, 0.8), color2: new Color4(c.r * 0.6, c.g * 0.6, c.b * 0.6, 0.5), size: [0.4, 1.4], life: [0.8, 1.8], speed: [0.3, 1.2], box: o.radius * 0.7, boxY: 0.2, tex: o.element === "poison" ? "smoke" : "soft", additive: o.element !== "poison", capacity: 200 });
    this.hazards.push({ x, y, z, r: o.radius, dps: o.dps, element: o.element, life: o.life, owner: o.owner ?? "enemy", mesh, ps, tick: 0 });
  }

  shockwave(x: number, y: number, z: number, o: { maxR: number; speed: number; damage: number; element: Element; color: string; thickness?: number }): void {
    const g = this.game;
    const mesh = MeshBuilder.CreateTorus("wave", { diameter: 2, thickness: 0.35, tessellation: 48 }, g.scene);
    mesh.material = this.projMat(o.color);
    mesh.position.set(x, y + 0.3, z);
    mesh.scaling.set(0.1, 1, 0.1);
    this.waves.push({ x, y, z, r: 0.1, maxR: o.maxR, speed: o.speed, damage: o.damage, element: o.element, hit: false, mesh, thickness: o.thickness ?? 1.6 });
  }

  clearHostile(): void {
    for (const p of this.projectiles) this.disposeProj(p);
    this.projectiles = [];
    for (const h of this.hazards) this.disposeHazard(h);
    this.hazards = [];
    for (const w of this.waves) w.mesh.dispose();
    this.waves = [];
  }

  private disposeProj(p: Projectile): void {
    p.mesh.dispose();
    if (p.ps) {
      p.ps.stop();
      p.ps.disposeOnStop = true;
    }
  }
  private disposeHazard(h: Hazard): void {
    h.mesh?.dispose();
    if (h.ps) {
      h.ps.stop();
      h.ps.disposeOnStop = true;
    }
  }

  private explode(p: Projectile): void {
    const g = this.game;
    const c = Color3.FromHexString(p.explodeColor);
    g.fx.burst(p.pos, { count: 40, color1: new Color4(c.r, c.g, c.b, 1), color2: new Color4(1, 1, 1, 0.8), size: [0.2, 0.9], life: [0.3, 0.8], speed: [3, 9], tex: p.element === "fire" ? "spark" : "soft" });
    g.fx.flashLight(p.pos, c, 2, 12, 0.35);
    g.audio.sfx(p.element === "ice" ? "iceShatter" : p.element === "fire" ? "explosion" : "magicHit", p.pos);
    if (p.aoe > 0) {
      if (p.owner === "enemy") this.aoeHitPlayer(p.pos, p.aoe, p.damage, { element: p.element, knockback: p.knock });
      else this.damageArea(p.pos, p.aoe, p.damage, p.element, p.knock);
      g.fx.shockRing(p.pos.x, p.pos.y - 0.3, p.pos.z, p.explodeColor, p.aoe, 0.35);
    }
  }

  update(dt: number): void {
    const g = this.game;
    const pl = g.player;
    // lock-on
    if (g.state === "playing" && (g.input.wasPressed("Tab") || g.input.mouseWasPressed(1) || g.input.wasPressed("KeyF"))) this.toggleLock();
    if (this.lockTarget) {
      const t = this.lockTarget;
      if (!t.alive || Math.hypot(t.position.x - pl.position.x, t.position.z - pl.position.z) > 45) this.lockTarget = null;
    }
    // projectiles
    const interior = this.activeInterior();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.homing > 0 && p.owner === "enemy") {
        const to = pl.position.add(new Vector3(0, 1.2, 0)).subtract(p.pos).normalize().scale(p.vel.length());
        p.vel = Vector3.Lerp(p.vel, to, clamp(p.homing * dt, 0, 1));
      }
      p.vel.y -= p.gravity * dt;
      p.pos.addInPlace(p.vel.scale(dt));
      p.mesh.position.copyFrom(p.pos);
      let done = p.life <= 0;
      const gh = g.physics.groundHeight(p.pos.x, p.pos.z, p.pos.y + 1);
      if (p.pos.y < gh) done = true;
      if (g.physics.interior && g.physics.interior.isSolid(p.pos.x, p.pos.z)) done = true;
      if (!done && p.owner === "enemy" && !pl.dead) {
        const dx = pl.position.x - p.pos.x, dz = pl.position.z - p.pos.z, dy = pl.position.y + 1 - p.pos.y;
        if (Math.hypot(dx, dz) < p.radius + 0.5 && Math.abs(dy) < 1.4) {
          if (!p.aoe) pl.takeDamage(p.damage, p.pos, { knockback: p.knock, element: p.element as any });
          done = true;
        }
      }
      if (!done && p.owner === "player") {
        for (const c of this.combatants) {
          if (!c.alive || p.hit.has(c) || c.interior !== interior) continue;
          if (Math.hypot(c.position.x - p.pos.x, c.position.z - p.pos.z) < c.radius + p.radius && p.pos.y > c.position.y - 0.5 && p.pos.y < c.position.y + c.height + 0.5) {
            p.hit.add(c);
            if (!p.aoe) {
              let dmg = p.damage;
              if (c.dark && (p.element === "light" || p.element === "rainbow")) dmg *= 1.8;
              c.takeHit({ damage: dmg, from: p.pos.subtract(p.vel.normalizeToNew()), knockback: p.knock, element: p.element, source: "magic" });
              g.ui.floatText(c.lockPoint().add(new Vector3(0, 0.8, 0)), `${Math.round(dmg)}`, "#ffb36b");
            }
            if (!p.pierce) {
              done = true;
              break;
            }
          }
        }
      }
      if (done) {
        this.explode(p);
        this.disposeProj(p);
        this.projectiles.splice(i, 1);
      }
    }
    // hazards
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.life -= dt;
      h.tick += dt;
      if (h.tick > 0.25) {
        const tick = h.tick;
        h.tick = 0;
        if (h.owner === "enemy") {
          if (Math.hypot(pl.position.x - h.x, pl.position.z - h.z) < h.r && Math.abs(pl.position.y - h.y) < 3 && !pl.dead) {
            if (h.element === "poison") pl.takePoison(h.dps * tick * (g.poison.immuneMinutes > 0 ? 0.2 : 1));
            else {
              pl.takePoison(h.dps * tick);
              if (h.element === "fire") pl.burnT = Math.max(pl.burnT, 1);
              if (h.element === "ice") pl.slowT = Math.max(pl.slowT, 1);
            }
            g.ui.damageFlash(0.15);
          }
        } else {
          for (const c of this.combatants) {
            if (!c.alive || c.interior !== interior) continue;
            if (Math.hypot(c.position.x - h.x, c.position.z - h.z) < h.r + c.radius) c.takeHit({ damage: h.dps * tick, from: new Vector3(h.x, h.y, h.z), knockback: 0, element: h.element, source: "magic" });
          }
        }
      }
      if (h.mesh) h.mesh.visibility = Math.min(1, h.life * 2);
      if (h.life <= 0) {
        this.disposeHazard(h);
        this.hazards.splice(i, 1);
      }
    }
    // shockwaves
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.r += w.speed * dt;
      w.mesh.scaling.set(w.r, 1, w.r);
      const k = w.r / w.maxR;
      (w.mesh.material as StandardMaterial).alpha = 1;
      w.mesh.visibility = 1 - k * 0.7;
      if (!w.hit && !pl.dead) {
        const d = Math.hypot(pl.position.x - w.x, pl.position.z - w.z);
        const airborne = pl.position.y - g.physics.groundHeight(pl.position.x, pl.position.z, pl.position.y) > 0.5;
        if (Math.abs(d - w.r) < w.thickness * 0.5 && !airborne) {
          w.hit = pl.takeDamage(w.damage, new Vector3(w.x, w.y, w.z), { knockback: 7, element: w.element as any, unblockable: true });
          if (w.hit && w.element === "lightning") pl.stunT = 0.6;
        }
      }
      if (w.r >= w.maxR) {
        w.mesh.dispose();
        this.waves.splice(i, 1);
      }
    }
    // HUD helpers
    g.ui.updateEnemyBars([...this.combatants].filter((c) => c.alive && !c.isBoss && c.interior === interior && c.hp < c.maxHp && Math.hypot(c.position.x - pl.position.x, c.position.z - pl.position.z) < 30));
    g.ui.updateLock(this.lockTarget);
  }
}
