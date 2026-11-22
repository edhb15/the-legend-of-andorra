import { Vector3, TransformNode, TrailMesh, StandardMaterial, Color3, Mesh, ParticleSystem, Color4 } from "@babylonjs/core";
import type { Game } from "../core/Game";
import { Humanoid, HumanoidLook } from "./Humanoid";
import { buildWeapon, buildShield, WeaponModel, rainbowMaterial } from "./Props";
import { clamp, clamp01, damp, dampAngle, yawTo, wrapAngle } from "../core/MathUtil";
import { item, WeaponStats } from "../data/items";

export type PlayerActionName = "attack1" | "attack2" | "attack3" | "heavy" | "charge" | "plunge" | "dodge" | "backstep" | "hit" | "death" | "drink" | "pickup" | "raise" | "kneel" | "cast" | "cheer";

interface ActiveAction {
  name: PlayerActionName;
  t: number;
  dur: number;
  hitDone: Set<any>;
  hitWindow: [number, number] | null;
  lunge: number;
}

export interface DamageOpts {
  knockback?: number;
  element?: "fire" | "ice" | "lightning" | "nature" | "dark" | "poison" | "physical";
  unblockable?: boolean;
  source?: any;
  stagger?: boolean;
}

const ATTACKS: Record<string, { dur: number; window: [number, number]; mult: number; reach: number; arc: number; knock: number; stamina: number; lunge: number }> = {
  attack1: { dur: 0.42, window: [0.3, 0.62], mult: 1, reach: 1, arc: 2.2, knock: 2.5, stamina: 3, lunge: 2.5 },
  attack2: { dur: 0.42, window: [0.28, 0.6], mult: 1.05, reach: 1, arc: 2.2, knock: 2.5, stamina: 3, lunge: 2.5 },
  attack3: { dur: 0.62, window: [0.38, 0.62], mult: 1.6, reach: 1.1, arc: 1.4, knock: 7, stamina: 5, lunge: 4 },
  heavy: { dur: 0.75, window: [0.12, 0.88], mult: 2.3, reach: 1.15, arc: 6.3, knock: 9, stamina: 22, lunge: 0 },
  plunge: { dur: 0.5, window: [0.0, 0.3], mult: 2.0, reach: 1.2, arc: 6.3, knock: 8, stamina: 8, lunge: 0 },
};

/** The hero: third-person movement, combat actions, health/stamina, status effects. */
export class PlayerController {
  rig!: Humanoid;
  root!: TransformNode;
  position = new Vector3();
  velocity = new Vector3();
  yaw = 0;
  onGround = true;
  hp = 100;
  maxHp = 100;
  stamina = 100;
  maxStamina = 100;
  private staminaDelay = 0;
  exhausted = false;
  action: ActiveAction | null = null;
  comboIndex = 0;
  private comboQueued = false;
  private comboTimer = 0;
  blocking = false;
  private blockStart = 0;
  iframes = 0;
  invulnerable = false;
  frozen = false; // controlled by cinematics
  dead = false;
  swimming = false;
  burnT = 0;
  slowT = 0;
  rootT = 0;
  stunT = 0;
  private airMaxY = 0;
  private charging = false;
  private chargeT = 0;
  weapon: WeaponModel | null = null;
  weaponStats: WeaponStats = item("traveler_sword").weapon!;
  weaponId = "traveler_sword";
  shield: TransformNode | null = null;
  trail: TrailMesh | null = null;
  private trailMat: StandardMaterial;
  private trailTimer = 0;
  sprinting = false;
  speed = 0;
  private footT = 0;
  private burnFx: ParticleSystem | null = null;
  private lastPos = new Vector3();
  look: HumanoidLook = {
    skin: "#e2b48e", hair: "#4a2f1c", top: "#2f5d8a", bottom: "#5b4a3a", boots: "#3b2a1e", belt: "#6b4a2a",
    hairStyle: "short", cape: "#7a2e2e", sleeves: "#284e75",
  };

  constructor(private game: Game) {
    this.trailMat = new StandardMaterial("trailMat", game.scene);
    this.trailMat.emissiveColor = new Color3(0.8, 0.85, 1);
    this.trailMat.diffuseColor = new Color3(0, 0, 0);
    this.trailMat.alpha = 0.35;
    this.trailMat.disableLighting = true;
    this.trailMat.backFaceCulling = false;
    this.buildRig();
    const home = game.world.homeVillage();
    this.teleport(home.x + 4, home.y, home.z - 6, 0);
  }

  // -------------------------------------------------------------------------------- appearance
  buildRig(): void {
    const g = this.game;
    const inv = g.inventory;
    const look = { ...this.look };
    if (inv) {
      const cape = inv.equipped.cape ? item(inv.equipped.cape).cosmetic : null;
      if (cape?.color) look.cape = cape.color;
      const hat = inv.equipped.hat ? item(inv.equipped.hat).cosmetic : null;
      if (hat?.hat) {
        look.hat = hat.hat as any;
        look.hatColor = hat.color;
      }
      const armor = inv.equipped.armor;
      if (armor === "chainmail") look.armor = "#8f969e";
      if (armor === "guardian_plate") look.armor = "#c9b27a";
      if (armor === "leather_tunic") look.top = "#7a5a3a";
    }
    const oldPos = this.position.clone();
    if (this.rig) {
      this.detachWeapon();
      this.rig.dispose();
    }
    this.rig = new Humanoid(g.scene, look, "player");
    this.root = this.rig.root;
    this.rig.setPosition(oldPos.x, oldPos.y, oldPos.z, this.yaw);
    this.shield = buildShield(g.scene, g.inventory?.has("rainbow_sword") ? "knight" : "wood");
    this.shield.parent = this.rig.handL;
    this.shield.rotation.set(0, -Math.PI / 2, 0);
    this.shield.position.set(-0.05, 0, 0);
    this.equipWeapon(this.weaponId);
    this.refreshShadowCasting();
  }

  refreshShadowCasting(): void {
    for (const m of this.rig.root.getChildMeshes(false)) {
      this.game.env.addCaster(m, false);
      (m as Mesh).receiveShadows = false;
    }
  }

  private detachWeapon(): void {
    if (this.trail) {
      this.trail.dispose();
      this.trail = null;
    }
    if (this.weapon) {
      this.game.glow.removeIncludedOnlyMesh(this.weapon.blade);
      this.weapon.root.dispose();
      this.weapon = null;
    }
  }

  equipWeapon(id: string): void {
    const def = item(id);
    if (!def.weapon) return;
    this.weaponId = id;
    this.weaponStats = def.weapon;
    this.detachWeapon();
    const w = buildWeapon(this.game.scene, def.weapon);
    w.root.parent = this.rig.handR;
    w.root.rotation.set(Math.PI / 2, 0, 0);
    if (def.weapon.model === "claymore") w.root.scaling.setAll(1.05);
    this.weapon = w;
    if (def.weapon.model === "rainbow" || def.weapon.model === "ember" || def.weapon.model === "frost") this.game.glow.addIncludedOnlyMesh(w.blade);
    this.trail = new TrailMesh("swordTrail", w.tip, this.game.scene, { diameter: 0.5, length: 14, segments: 14, autoStart: false });
    if (def.weapon.model === "rainbow") this.trail.material = rainbowMaterial(this.game.scene);
    else {
      this.trail.material = this.trailMat;
      const c = def.weapon.model === "ember" ? new Color3(1, 0.45, 0.1) : def.weapon.model === "frost" ? new Color3(0.5, 0.85, 1) : new Color3(0.8, 0.85, 1);
      this.trailMat.emissiveColor = c;
    }
    this.trail.isVisible = false;
    this.game.env.addCaster(w.blade, false);
  }

  teleport(x: number, y: number, z: number, yaw: number): void {
    this.position.set(x, y, z);
    this.velocity.setAll(0);
    this.yaw = yaw;
    this.airMaxY = y;
    this.rig.setPosition(x, y, z, yaw);
    this.game.camera.snapBehindPlayer();
    this.trail?.reset();
  }

  // -------------------------------------------------------------------------------- stats
  get defense(): number {
    const a = this.game.inventory.equipped.armor;
    return a ? item(a).armor?.defense ?? 0 : 0;
  }
  poisonResistance(): number {
    let r = 1;
    if (this.game.inventory.has("lantern_purity")) r *= 0.6;
    if (this.weaponId === "rainbow_sword") r *= 0.5;
    return r;
  }
  canAct(): boolean {
    return !this.dead && !this.frozen && this.stunT <= 0 && (!this.action || this.action.name === "charge");
  }
  isAttacking(): boolean {
    return !!this.action && ["attack1", "attack2", "attack3", "heavy", "plunge"].includes(this.action.name);
  }

  heal(n: number): void {
    this.hp = Math.min(this.maxHp, this.hp + n);
    this.game.ui.floatText(this.position.add(new Vector3(0, 2.2, 0)), `+${Math.round(n)}`, "#7dff8a");
  }
  restoreStamina(n: number): void {
    this.stamina = Math.min(this.maxStamina, this.stamina + n);
    if (this.stamina > this.maxStamina * 0.3) this.exhausted = false;
  }
  useStamina(n: number): boolean {
    if (this.stamina <= 0) return false;
    this.stamina = Math.max(0, this.stamina - n);
    this.staminaDelay = 0.9;
    if (this.stamina <= 0) {
      this.exhausted = true;
      this.game.ui.toast("Out of stamina!", "warn");
    }
    return true;
  }

  playAction(name: PlayerActionName, dur: number): void {
    this.action = { name, t: 0, dur, hitDone: new Set(), hitWindow: null, lunge: 0 };
  }

  // -------------------------------------------------------------------------------- damage
  takeDamage(amount: number, from: Vector3 | null, opts: DamageOpts = {}): boolean {
    const g = this.game;
    if (this.dead || this.invulnerable || g.state !== "playing") return false;
    if (this.iframes > 0) return false;
    let dmg = amount;
    const toSrc = from ? yawTo(this.position.x, this.position.z, from.x, from.z) : this.yaw;
    const facing = Math.abs(wrapAngle(toSrc - this.yaw)) < 1.0;
    if (this.blocking && facing && !opts.unblockable && opts.element !== "poison") {
      const since = g.elapsed - this.blockStart;
      if (since < 0.28) {
        // perfect parry
        g.events.emit("parry", opts.source);
        g.audio.sfx("parry");
        g.fx.hitSpark(this.rig.handPosition().add(new Vector3(0, 0.3, 0)), new Color4(1, 1, 0.6, 1), true);
        g.ui.floatText(this.position.add(new Vector3(0, 2.3, 0)), "PARRY!", "#ffe680");
        g.addHitStop(0.12);
        return false;
      }
      dmg *= 0.2;
      this.useStamina(amount * 0.7);
      g.audio.sfx("block");
      g.fx.hitSpark(this.position.add(new Vector3(Math.sin(this.yaw) * 0.6, 1.3, Math.cos(this.yaw) * 0.6)), new Color4(1, 0.9, 0.6, 1));
      if (this.stamina <= 0) {
        this.blocking = false;
        this.playAction("hit", 0.8);
        g.ui.toast("Guard broken!", "warn");
      }
    }
    const def = this.defense;
    dmg = Math.max(1, dmg * (60 / (60 + def * 3)));
    this.hp -= dmg;
    g.ui.floatText(this.position.add(new Vector3(0, 2.2, 0)), `-${Math.round(dmg)}`, "#ff6060");
    g.ui.damageFlash(clamp01(dmg / 30));
    g.camera.shake(clamp(dmg / 25, 0.2, 1));
    g.audio.sfx("playerHurt");
    this.iframes = 0.45;
    if (from && (opts.knockback ?? 3) > 0) {
      const dx = this.position.x - from.x, dz = this.position.z - from.z;
      const l = Math.hypot(dx, dz) || 1;
      const kb = opts.knockback ?? 3;
      this.velocity.x = (dx / l) * kb * 2.2;
      this.velocity.z = (dz / l) * kb * 2.2;
      if (kb > 6) this.velocity.y = Math.max(this.velocity.y, 4);
    }
    if (!this.isAttacking() || (opts.knockback ?? 0) > 6) this.playAction("hit", 0.35);
    switch (opts.element) {
      case "fire":
        this.burnT = 3;
        break;
      case "ice":
        this.slowT = 2.5;
        break;
      case "lightning":
        this.stunT = 0.5;
        break;
      case "nature":
        break;
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
    }
    return true;
  }

  takePoison(dmg: number): void {
    if (this.dead || this.invulnerable) return;
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
    }
  }

  rootPlayer(t: number): void {
    this.rootT = Math.max(this.rootT, t);
  }

  die(): void {
    if (this.dead) return;
    this.dead = true;
    this.charging = false;
    this.blocking = false;
    this.playAction("death", 1.6);
    this.trail?.stop();
    this.game.combat.lockTarget = null;
    this.game.respawn.startDeath();
  }

  revive(): void {
    this.dead = false;
    this.hp = this.maxHp;
    this.stamina = this.maxStamina;
    this.exhausted = false;
    this.action = null;
    this.burnT = this.slowT = this.rootT = this.stunT = 0;
    this.iframes = 2;
  }

  // -------------------------------------------------------------------------------- update
  update(dt: number): void {
    const g = this.game;
    const inp = g.input;
    const controllable = g.state === "playing" && !this.dead && !this.frozen;
    this.iframes = Math.max(0, this.iframes - dt);
    this.staminaDelay = Math.max(0, this.staminaDelay - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    this.rootT = Math.max(0, this.rootT - dt);
    this.stunT = Math.max(0, this.stunT - dt);
    if (this.burnT > 0) {
      this.burnT -= dt;
      this.takePoison(3 * dt);
      if (!this.burnFx) this.burnFx = g.fx.emitter(this.root as any, { rate: 40, color1: new Color4(1, 0.6, 0.1, 1), color2: new Color4(1, 0.2, 0, 0.8), size: [0.15, 0.4], life: [0.2, 0.6], speed: [0.5, 2], tex: "spark", box: 0.4, boxY: 0.9 });
      this.burnFx.minEmitBox.y = 0;
      this.burnFx.maxEmitBox.y = 1.6;
    } else if (this.burnFx) {
      this.burnFx.stop();
      this.burnFx.disposeOnStop = true;
      this.burnFx = null;
    }

    // ---- input: movement direction
    let mx = 0, mz = 0;
    let analog = 1;
    if (controllable && this.stunT <= 0) {
      if (inp.isDown("KeyW")) mz += 1;
      if (inp.isDown("KeyS")) mz -= 1;
      if (inp.isDown("KeyA")) mx -= 1;
      if (inp.isDown("KeyD")) mx += 1;
      if (!mx && !mz) {
        // touch joystick: any direction, and a light push walks slowly
        const ax = inp.moveAxis();
        const m = Math.hypot(ax.x, ax.y);
        if (m > 0.02) {
          mx = ax.x;
          mz = ax.y;
          analog = Math.min(1, 0.35 + m * 1.1);
        }
      }
    }
    const f = g.camera.forwardXZ();
    let dx = f.x * mz + f.z * mx;
    let dz = f.z * mz - f.x * mx;
    const ml = Math.hypot(dx, dz);
    if (ml > 0) {
      dx /= ml;
      dz /= ml;
    }
    const moving = ml > 0;

    // ---- actions
    if (controllable) this.handleActions(dt, moving, dx, dz);
    if (this.action) {
      const a = this.action;
      a.t += dt;
      if (a.hitWindow) {
        const k = a.t / a.dur;
        if (k >= a.hitWindow[0] && k <= a.hitWindow[1]) {
          if (!this.trail?.isVisible && this.trail) {
            this.trail.reset();
            this.trail.start();
            this.trail.isVisible = true;
          }
          g.combat.playerSwing(a.name, ATTACKS[a.name], a.hitDone);
        }
      }
      if (a.name === "plunge" && this.onGround && a.t > 0.05 && !a.hitDone.has("landed")) {
        a.hitDone.add("landed");
        g.combat.playerSwing("plunge", ATTACKS.plunge, a.hitDone, true);
        g.fx.shockRing(this.position.x, this.position.y, this.position.z, "#ffffff", 5, 0.4);
        g.camera.shake(0.5);
      }
      if (a.t >= a.dur && a.name !== "charge" && a.name !== "death") {
        if (["attack1", "attack2", "attack3"].includes(a.name) && this.comboQueued) {
          this.comboQueued = false;
          this.startAttack(a.name === "attack1" ? "attack2" : a.name === "attack2" ? "attack3" : "attack1");
        } else {
          if (["attack1", "attack2", "attack3"].includes(a.name)) this.comboTimer = 0.35;
          this.action = null;
        }
      }
    }
    if (this.trail && this.trail.isVisible) {
      this.trailTimer += dt;
      const inWindow = this.action?.hitWindow && this.action.t / this.action.dur <= this.action.hitWindow[1] + 0.15;
      if (!inWindow) {
        this.trail.stop();
        this.trail.isVisible = this.weaponId === "rainbow_sword" && this.trailTimer < 0.3;
        if (!this.trail.isVisible) this.trailTimer = 0;
      }
    }

    // ---- speed selection
    const actName = this.action?.name;
    let target = 0;
    if (moving && !actName && this.rootT <= 0) {
      const wantSprint = inp.isDown("ShiftLeft") || inp.isDown("ShiftRight");
      this.sprinting = wantSprint && !this.exhausted && this.stamina > 0 && !this.blocking && !this.swimming;
      target = this.blocking ? 2.4 : this.charging ? 2.2 : this.sprinting ? 9.2 : 5.4;
      if (this.swimming) target = this.sprinting ? 4.5 : 3.0;
      if (g.inventory.has("amulet_swiftness")) target *= 1.12;
      if (this.slowT > 0) target *= 0.5;
      if (!this.sprinting) target *= analog;
    } else this.sprinting = false;
    if (this.charging && moving && this.rootT <= 0) target = 2.2;
    if (this.sprinting) {
      this.stamina -= 13 * dt;
      this.staminaDelay = 0.6;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.exhausted = true;
      }
    }
    // slope handling
    const n = g.physics.interior ? null : g.terrain.getNormal(this.position.x, this.position.z);
    let slopeDeg = 0;
    if (n && this.onGround) {
      slopeDeg = (Math.acos(n.y) * 180) / Math.PI;
      const uphill = -(n.x * dx + n.z * dz) / Math.max(0.001, Math.hypot(n.x, n.z));
      if (uphill > 0 && slopeDeg > 28) target *= clamp(1 - ((slopeDeg - 28) / 30) * uphill, 0.25, 1);
    }
    // ---- horizontal velocity
    const accel = this.onGround || this.swimming ? 14 : 3;
    if (!actName || actName === "charge") {
      this.velocity.x = damp(this.velocity.x, dx * target, accel, dt);
      this.velocity.z = damp(this.velocity.z, dz * target, accel, dt);
    } else if (actName === "dodge" || actName === "backstep") {
      const a = this.action!;
      const k = 1 - a.t / a.dur;
      const sp = (actName === "dodge" ? 11 : 8) * k;
      const dir = (a as any).dir as { x: number; z: number };
      this.velocity.x = dir.x * sp;
      this.velocity.z = dir.z * sp;
    } else if (this.action && this.action.lunge > 0) {
      const a = this.action;
      const k = Math.max(0, 1 - a.t / (a.dur * 0.5));
      this.velocity.x = Math.sin(this.yaw) * a.lunge * k;
      this.velocity.z = Math.cos(this.yaw) * a.lunge * k;
    } else {
      this.velocity.x = damp(this.velocity.x, 0, 8, dt);
      this.velocity.z = damp(this.velocity.z, 0, 8, dt);
    }
    if (this.rootT > 0) {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }
    // steep slope sliding
    if (n && this.onGround && slopeDeg > 52) {
      this.velocity.x += n.x * 14 * dt * 4;
      this.velocity.z += n.z * 14 * dt * 4;
    }

    // ---- facing
    const lock = g.combat.lockTarget;
    if (!this.dead && !this.frozen) {
      if (lock && lock.alive && (moving || this.isAttacking() || this.blocking)) {
        const lp = lock.position;
        this.yaw = dampAngle(this.yaw, yawTo(this.position.x, this.position.z, lp.x, lp.z), 14, dt);
      } else if (moving && (!actName || actName === "charge")) {
        this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), this.sprinting ? 9 : 12, dt);
      }
    }

    // ---- vertical
    if (controllable && inp.wasPressed("Space") && (this.onGround || this.swimming) && !actName && this.rootT <= 0) {
      this.velocity.y = this.swimming ? 5 : 8.4;
      this.onGround = false;
      this.swimming = false;
      this.airMaxY = this.position.y;
      g.audio.sfx("jump");
    }
    this.velocity.y -= 24 * dt;
    if (this.velocity.y < -45) this.velocity.y = -45;
    this.lastPos.copyFrom(this.position);
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y += this.velocity.y * dt;
    g.physics.resolve(this.position, 0.42, 1.8);
    g.npcs.pushOut(this.position, 0.42);
    g.enemies.pushOut(this.position, 0.42);
    const gh = g.physics.groundHeight(this.position.x, this.position.z, this.position.y);
    const wl = g.physics.waterLevel(this.position.x, this.position.z);
    const depth = wl - gh;
    if (depth > 1.35 && this.position.y < wl - 0.9) {
      // swimming
      if (!this.swimming) {
        g.fx.burst(new Vector3(this.position.x, wl, this.position.z), { count: 30, color1: new Color4(0.8, 0.9, 1, 0.8), color2: new Color4(1, 1, 1, 0.6), tex: "soft", size: [0.1, 0.4], speed: [2, 5], gravity: -9, life: [0.4, 0.9] });
        g.audio.sfx("splash");
      }
      this.swimming = true;
      this.onGround = false;
      this.position.y = damp(this.position.y, wl - 1.25, 6, dt);
      this.velocity.y = 0;
      this.airMaxY = this.position.y;
      this.stamina -= (this.sprinting ? 10 : 3) * dt;
      this.staminaDelay = 0.5;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.exhausted = true;
        this.takePoison(8 * dt);
      }
    } else {
      this.swimming = false;
      if (this.position.y <= gh + 0.02 || (this.onGround && this.position.y - gh < 0.7 && this.velocity.y <= 0)) {
        if (!this.onGround) {
          const fall = this.airMaxY - gh;
          if (fall > 10 && !this.dead) {
            const dmg = (fall - 10) * 5.5;
            this.takeDamage(dmg, null, { knockback: 0, unblockable: true });
            g.audio.sfx("land");
          } else if (fall > 2) g.audio.sfx("land");
        }
        this.position.y = gh;
        if (this.velocity.y < 0) this.velocity.y = 0;
        this.onGround = true;
        this.airMaxY = gh;
      } else {
        this.onGround = false;
        this.airMaxY = Math.max(this.airMaxY, this.position.y);
      }
    }
    if (this.position.y < -1500) {
      // fell out of the world: put back on ground
      const h = g.physics.groundHeight(this.position.x, this.position.z, 1e5);
      this.position.y = h + 1;
    }

    // ---- stamina regen
    if (this.staminaDelay <= 0 && !this.sprinting && !this.swimming && !this.blocking) {
      const regen = (this.exhausted ? 22 : 32) * (g.inventory.has("ring_vigor") ? 1.4 : 1);
      this.stamina = Math.min(this.maxStamina, this.stamina + regen * dt);
      if (this.exhausted && this.stamina > this.maxStamina * 0.35) this.exhausted = false;
    }

    // ---- animate
    const hs = Math.hypot(this.position.x - this.lastPos.x, this.position.z - this.lastPos.z) / Math.max(dt, 1e-4);
    this.speed = damp(this.speed, Math.min(hs, 12), 10, dt);
    this.rig.setPosition(this.position.x, this.position.y, this.position.z, this.yaw);
    this.rig.animate(dt, {
      speed: this.onGround || this.swimming ? this.speed : 0,
      grounded: this.onGround,
      vy: this.velocity.y,
      action: this.action?.name ?? null,
      actionT: this.action?.t ?? 0,
      actionDur: this.action?.dur ?? 1,
      blocking: this.blocking,
      swim: this.swimming,
      armed: true,
    });
    // footsteps
    if (this.onGround && this.speed > 1) {
      this.footT += dt * (this.speed / 2.2);
      if (this.footT > 1) {
        this.footT = 0;
        g.audio.footstep(g.physics.interior ? "stone" : g.world.onRoad(this.position.x, this.position.z) ? "gravel" : "grass");
      }
    }
  }

  private startAttack(name: "attack1" | "attack2" | "attack3"): void {
    const a = ATTACKS[name];
    const sp = this.weaponStats.speed;
    this.useStamina(a.stamina);
    this.action = { name, t: 0, dur: a.dur / sp, hitDone: new Set(), hitWindow: a.window, lunge: a.lunge };
    this.game.audio.sfx(name === "attack3" ? "swingHeavy" : "swing");
    this.faceLockOrInput();
  }

  private faceLockOrInput(): void {
    const lock = this.game.combat.lockTarget;
    if (lock && lock.alive) this.yaw = yawTo(this.position.x, this.position.z, lock.position.x, lock.position.z);
    else {
      const near = this.game.combat.nearestEnemy(this.position, 4.5, this.yaw, 1.6);
      if (near) this.yaw = yawTo(this.position.x, this.position.z, near.position.x, near.position.z);
    }
  }

  private handleActions(dt: number, moving: boolean, dx: number, dz: number): void {
    const g = this.game;
    const inp = g.input;
    const act = this.action?.name;
    const busy = !!this.action && act !== "charge";
    // block
    const wantBlock = inp.mouseDown(2) && !this.swimming && this.onGround;
    if (wantBlock && !this.blocking && !busy) {
      this.blocking = true;
      this.blockStart = g.elapsed;
    }
    if (!wantBlock || busy) this.blocking = false;

    // dodge
    if (inp.wasPressed("KeyQ") && !busy && this.onGround && this.rootT <= 0) {
      if (this.stamina >= 8 && this.useStamina(18)) {
        const back = !moving;
        const dir = back ? { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) } : { x: dx, z: dz };
        this.charging = false;
        this.action = { name: back ? "backstep" : "dodge", t: 0, dur: back ? 0.35 : 0.55, hitDone: new Set(), hitWindow: null, lunge: 0 };
        (this.action as any).dir = dir;
        if (!back) this.yaw = Math.atan2(dir.x, dir.z);
        this.iframes = back ? 0.25 : 0.38;
        g.audio.sfx("dodge");
        return;
      }
    }
    // attacks
    if (this.swimming) return;
    if (inp.mouseWasPressed(0)) {
      if (!this.onGround && !busy && this.position.y - g.physics.groundHeight(this.position.x, this.position.z, this.position.y) > 1.5) {
        this.action = { name: "plunge", t: 0, dur: 0.9, hitDone: new Set(), hitWindow: null, lunge: 0 };
        this.velocity.y = -18;
        g.audio.sfx("swingHeavy");
        return;
      }
      if (busy && ["attack1", "attack2", "attack3"].includes(act!)) {
        const a = this.action!;
        if (a.t / a.dur > 0.35) this.comboQueued = true;
      } else if (!busy) {
        this.chargeT = 0;
        this.charging = true;
      }
    }
    if (this.charging) {
      this.chargeT += dt;
      if (this.chargeT > 0.32 && !this.action) {
        this.action = { name: "charge", t: 0, dur: 99, hitDone: new Set(), hitWindow: null, lunge: 0 };
        g.audio.sfx("charge");
      }
      if (this.action?.name === "charge" && this.chargeT > 0.9 && !(this.action as any).sparked) {
        (this.action as any).sparked = true;
        g.fx.hitSpark(this.rig.handPosition(), new Color4(1, 1, 0.8, 1), true);
      }
      if (!inp.mouseDown(0)) {
        this.charging = false;
        if (this.action?.name === "charge") {
          this.action = null;
          if (this.stamina >= 10 && this.chargeT > 0.5) {
            const a = ATTACKS.heavy;
            this.useStamina(a.stamina);
            this.action = { name: "heavy", t: 0, dur: a.dur / this.weaponStats.speed, hitDone: new Set(), hitWindow: a.window, lunge: 0 };
            g.audio.sfx("spin");
          } else this.startAttack("attack1");
        } else {
          const next = this.comboTimer > 0 && this.comboIndex < 3 ? this.comboIndex + 1 : 1;
          this.comboIndex = next > 3 ? 1 : next;
          this.startAttack(("attack" + this.comboIndex) as any);
        }
      }
    }
    if (this.action && ["attack1", "attack2", "attack3"].includes(this.action.name)) this.comboIndex = +this.action.name.slice(-1);
  }

  serialize() {
    return {
      pos: [this.position.x, this.position.y, this.position.z], yaw: this.yaw, hp: this.hp, maxHp: this.maxHp, stamina: this.stamina,
      maxStamina: this.maxStamina, weapon: this.weaponId,
    };
  }
  deserialize(d: any) {
    if (!d) return;
    this.maxHp = d.maxHp ?? 100;
    this.hp = Math.max(1, d.hp ?? this.maxHp);
    this.maxStamina = d.maxStamina ?? 100;
    this.stamina = d.stamina ?? this.maxStamina;
    this.weaponId = d.weapon ?? "traveler_sword";
    this.buildRig();
    if (d.pos) this.teleport(d.pos[0], d.pos[1], d.pos[2], d.yaw ?? 0);
  }
}
