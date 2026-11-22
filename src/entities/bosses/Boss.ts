import { Vector3, TransformNode, Color3, AbstractMesh, Mesh, MeshBuilder, StandardMaterial } from "@babylonjs/core";
import type { Game } from "../../core/Game";
import type { Combatant, HitInfo } from "../../systems/CombatSystem";
import type { ShardColor } from "../../data/items";
import { clamp01, damp, dampAngle, yawTo, wrapAngle, RNG } from "../../core/MathUtil";
import { PartBuilder, glowMaterial } from "../CharacterKit";

export interface BossAttack {
  name: string;
  t: number;
  dur: number;
  data: any;
  fired: Set<string>;
}

export type BossState = "dormant" | "intro" | "fight" | "stagger" | "phase" | "dying" | "dead";

/**
 * Base class for all bosses. Handles phases, attack scheduling, poise/stagger, hit flashes,
 * movement toward the player and death. Subclasses provide the model and attack patterns.
 */
export abstract class Boss implements Combatant {
  id: string;
  name: string;
  title: string;
  shard: ShardColor | null;
  alive = true;
  position = new Vector3();
  yaw = 0;
  hp: number;
  maxHp: number;
  radius: number;
  height: number;
  dark = false;
  isBoss = true;
  interior: string | null;
  root: TransformNode;
  parts: Record<string, TransformNode> = {};
  phase = 1;
  state: BossState = "dormant";
  stateT = 0;
  attack: BossAttack | null = null;
  cooldown = 2;
  arenaCenter = new Vector3();
  arenaR = 20;
  invulnerable = false;
  protected t = 0;
  protected rng: RNG;
  protected poise = 0;
  protected poiseMax = 6;
  protected flashT = 0;
  protected velocity = new Vector3();
  protected moveSpeed = 4;
  protected preferredDist = 6;
  deathT = 0;
  hitsTaken = 0;
  /** extra damage multiplier from phase */
  protected get rage(): number {
    return this.phase === 1 ? 1 : this.phase === 2 ? 1.25 : 1.5;
  }

  constructor(protected game: Game, opts: { id: string; name: string; title: string; shard: ShardColor | null; hp: number; radius: number; height: number; interior: string | null }) {
    this.id = opts.id;
    this.name = opts.name;
    this.title = opts.title;
    this.shard = opts.shard;
    this.hp = this.maxHp = opts.hp;
    this.radius = opts.radius;
    this.height = opts.height;
    this.interior = opts.interior;
    this.rng = new RNG(opts.id.length * 7919);
    this.root = new TransformNode("boss_" + opts.id, game.scene);
  }

  abstract build(): void;
  protected abstract chooseAttack(dist: number): BossAttack | null;
  protected abstract runAttack(dt: number, a: BossAttack, k: number): void;
  protected abstract animate(dt: number, moving: number): void;
  /** called when entering phase 2/3 */
  protected onPhase(p: number): void {
    void p;
  }

  protected mk(name: string, parent: TransformNode | null, x: number, y: number, z: number): TransformNode {
    const t = new TransformNode(name, this.game.scene);
    t.parent = parent ?? this.root;
    t.position.set(x, y, z);
    this.parts[name] = t;
    return t;
  }

  protected glow(hex: string, kind: "sphere" | "box" | "cyl", size: number | [number, number, number], parent: TransformNode, pos: [number, number, number], intensity = 1.5): Mesh {
    let m: Mesh;
    if (kind === "sphere") m = MeshBuilder.CreateSphere("g", { diameter: size as number, segments: 8 }, this.game.scene);
    else if (kind === "box") {
      const s = size as [number, number, number];
      m = MeshBuilder.CreateBox("g", { width: s[0], height: s[1], depth: s[2] }, this.game.scene);
    } else {
      const s = size as [number, number, number];
      m = MeshBuilder.CreateCylinder("g", { height: s[0], diameterTop: s[1], diameterBottom: s[2], tessellation: 8 }, this.game.scene);
    }
    m.material = glowMaterial(this.game.scene, hex, intensity);
    m.parent = parent;
    m.position.set(pos[0], pos[1], pos[2]);
    this.game.glow.addIncludedOnlyMesh(m);
    return m;
  }

  protected merge(pb: PartBuilder, name: string, parent: TransformNode): Mesh | null {
    const m = pb.merge(name, parent);
    if (m) this.game.env.addCaster(m, false);
    return m;
  }

  place(center: Vector3, arenaR: number, pos: Vector3, yaw: number): void {
    this.arenaCenter.copyFrom(center);
    this.arenaR = arenaR;
    this.position.copyFrom(pos);
    this.yaw = yaw;
    this.root.position.copyFrom(pos);
    this.root.rotation.y = yaw;
  }

  lockPoint(): Vector3 {
    return this.position.add(new Vector3(0, this.height * 0.55, 0));
  }

  allMeshes(): AbstractMesh[] {
    return this.root.getChildMeshes(false);
  }

  protected overlay(c: Color3 | null, a = 0.5): void {
    for (const m of this.allMeshes()) {
      if (!c) m.renderOverlay = false;
      else {
        m.renderOverlay = true;
        m.overlayColor = c;
        m.overlayAlpha = a;
      }
    }
  }

  /** Damage multiplier for hits on this boss (Zorg overrides). */
  protected damageFilter(h: HitInfo): number {
    void h;
    return 1;
  }

  takeHit(h: HitInfo): void {
    if (!this.alive || this.state === "dormant" || this.state === "intro" || this.state === "dying") return;
    const g = this.game;
    if (this.invulnerable) {
      g.ui.floatText(this.lockPoint(), "IMMUNE", "#aaaaaa");
      return;
    }
    const mult = this.damageFilter(h);
    if (mult <= 0) return;
    this.hp -= h.damage * mult;
    this.hitsTaken++;
    this.flashT = 0.1;
    this.overlay(new Color3(1, 1, 1), 0.45);
    this.poise += h.heavy ? 2 : 1;
    if (h.element === "ice" && this.id !== "frost") this.poise += 1;
    if (this.poise >= this.poiseMax && this.state === "fight" && !this.attack) {
      this.poise = 0;
      this.state = "stagger";
      this.stateT = 1.8;
      g.ui.floatText(this.lockPoint().add(new Vector3(0, 1, 0)), "STAGGERED", "#ffe680", 1.3);
      g.audio.sfx("bossStagger", this.position);
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.startDying();
      return;
    }
    const frac = this.hp / this.maxHp;
    const newPhase = frac < 0.33 ? 3 : frac < 0.66 ? 2 : 1;
    if (newPhase > this.phase) {
      this.phase = newPhase;
      this.state = "phase";
      this.stateT = 2.2;
      this.attack = null;
      this.invulnerable = true;
      g.combat.clearHostile();
      g.audio.sfx("bossRoar", this.position);
      g.camera.shake(0.8);
      g.ui.bossPhase(this.phase);
      this.onPhase(newPhase);
    }
  }

  freeze(dur: number): void {
    if (!this.alive) return;
    this.poise += 2;
    this.overlay(new Color3(0.6, 0.85, 1), 0.5);
    this.flashT = Math.min(0.6, dur * 0.2);
  }

  stagger(): void {
    if (this.state !== "fight") return;
    this.poise += 3;
    if (this.attack) {
      this.attack = null;
      this.state = "stagger";
      this.stateT = 1.2;
    }
  }

  protected startDying(): void {
    this.alive = false;
    this.state = "dying";
    this.deathT = 0;
    this.attack = null;
    this.game.combat.unregister(this);
    this.game.combat.clearHostile();
    this.game.bosses.onBossDefeated(this);
  }

  activate(): void {
    this.state = "fight";
    this.cooldown = 1.5;
    this.game.combat.register(this);
  }

  /** Movement helper (stays within the arena). */
  protected approach(dt: number, dist: number, speedMul = 1): number {
    const p = this.game.player.position;
    const toP = yawTo(this.position.x, this.position.z, p.x, p.z);
    this.yaw = dampAngle(this.yaw, toP, 3.5 * speedMul, dt);
    let sp = 0;
    if (dist > this.preferredDist) sp = this.moveSpeed * speedMul * this.rage;
    else if (dist < this.preferredDist * 0.5) sp = -this.moveSpeed * 0.4;
    this.velocity.x = damp(this.velocity.x, Math.sin(this.yaw) * sp, 4, dt);
    this.velocity.z = damp(this.velocity.z, Math.cos(this.yaw) * sp, 4, dt);
    return Math.abs(sp);
  }

  protected faceP(dt: number, rate = 4): void {
    const p = this.game.player.position;
    this.yaw = dampAngle(this.yaw, yawTo(this.position.x, this.position.z, p.x, p.z), rate, dt);
  }

  protected startAttack(name: string, dur: number, data: any = {}): BossAttack {
    return { name, t: 0, dur, data, fired: new Set() };
  }

  /** fire once when attack progress passes k */
  protected once(a: BossAttack, key: string, k: number, at: number): boolean {
    if (k >= at && !a.fired.has(key)) {
      a.fired.add(key);
      return true;
    }
    return false;
  }

  protected forward(dist: number, side = 0, up = 0): Vector3 {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    return new Vector3(this.position.x + s * dist + c * side, this.position.y + up, this.position.z + c * dist - s * side);
  }

  update(dt: number): void {
    const g = this.game;
    this.t += dt;
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.overlay(null);
    }
    if (this.state === "dead") return;
    if (this.state === "dying") {
      this.deathT += dt;
      this.animateDeath(dt, clamp01(this.deathT / 3));
      return;
    }
    const p = g.player.position;
    const dist = Math.hypot(p.x - this.position.x, p.z - this.position.z);
    let moving = 0;
    if (this.state === "dormant" || this.state === "intro") {
      this.animate(dt, 0);
      this.syncRoot();
      return;
    }
    if (this.state === "phase") {
      this.stateT -= dt;
      if (this.stateT <= 0) {
        this.state = "fight";
        this.invulnerable = false;
        this.cooldown = 0.8;
      }
    } else if (this.state === "stagger") {
      this.stateT -= dt;
      this.velocity.scaleInPlace(0.9);
      if (this.stateT <= 0) this.state = "fight";
    } else if (this.state === "fight") {
      if (this.attack) {
        const a = this.attack;
        a.t += dt;
        const k = clamp01(a.t / a.dur);
        this.runAttack(dt, a, k);
        if (a.t >= a.dur) {
          this.attack = null;
          this.cooldown = (this.phase === 1 ? 1.6 : this.phase === 2 ? 1.1 : 0.7) * this.rng.range(0.8, 1.2);
        }
      } else {
        moving = this.approach(dt, dist);
        this.cooldown -= dt;
        if (this.cooldown <= 0 && !g.player.dead) {
          const a = this.chooseAttack(dist);
          if (a) {
            this.attack = a;
            this.velocity.scaleInPlace(0.3);
          }
        }
      }
    }
    // integrate & clamp to arena
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    const dx = this.position.x - this.arenaCenter.x, dz = this.position.z - this.arenaCenter.z;
    const dd = Math.hypot(dx, dz);
    const lim = this.arenaR - this.radius * 0.5;
    if (dd > lim) {
      this.position.x = this.arenaCenter.x + (dx / dd) * lim;
      this.position.z = this.arenaCenter.z + (dz / dd) * lim;
    }
    this.groundSnap(dt);
    // push the player out of the boss body
    const pp = g.player.position;
    const px = pp.x - this.position.x, pz = pp.z - this.position.z;
    const pd = Math.hypot(px, pz);
    if (pd < this.radius + 0.45 && pd > 0.01 && pp.y < this.position.y + this.height * 0.8) {
      pp.x = this.position.x + (px / pd) * (this.radius + 0.45);
      pp.z = this.position.z + (pz / pd) * (this.radius + 0.45);
    }
    this.animate(dt, moving);
    this.syncRoot();
    void wrapAngle;
  }

  protected flying = 0; // height offset for flying bosses
  protected groundSnap(dt: number): void {
    const gy = this.game.physics.groundHeight(this.position.x, this.position.z, this.position.y + 3);
    this.position.y = damp(this.position.y, gy + this.flying, 10, dt);
  }

  protected syncRoot(): void {
    this.root.position.copyFrom(this.position);
    this.root.rotation.y = this.yaw;
  }

  protected animateDeath(dt: number, k: number): void {
    // default: sink, tilt and shrink; dark particles handled by manager
    this.root.rotation.z = k * 0.6;
    this.root.position.y = this.position.y - k * this.height * 0.3;
    const s = 1 - Math.max(0, k - 0.7) * 3;
    this.root.scaling.setAll(Math.max(0.01, s));
    void dt;
  }

  dispose(): void {
    this.game.combat.unregister(this);
    this.root.dispose();
  }
}

export function lavaMaterial(game: Game): StandardMaterial {
  return glowMaterial(game.scene, "#ff5a10", 1.4);
}
