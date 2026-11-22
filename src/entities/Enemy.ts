import { Vector3, TransformNode, Mesh, Color3, AbstractMesh, Color4 } from "@babylonjs/core";
import type { Game } from "../core/Game";
import type { Combatant, HitInfo, Element } from "../systems/CombatSystem";
import { Humanoid, HumanoidLook } from "./Humanoid";
import { PartBuilder, glowPart } from "./CharacterKit";
import { buildWeapon } from "./Props";
import { clamp01, damp, dampAngle, yawTo, wrapAngle, RNG } from "../core/MathUtil";

export type EnemyKind = "goblin" | "shaman" | "wolf" | "skeleton" | "slime" | "bat" | "darkknight" | "fireimp" | "iceimp" | "sprout";

interface KindDef {
  name: string;
  hp: number;
  damage: number;
  speed: number;
  sight: number;
  reach: number;
  cooldown: number;
  windup: number;
  radius: number;
  height: number;
  dark: boolean;
  ranged?: { range: number; element: Element; color: string; speed: number };
  flying?: boolean;
  knock: number;
  loot: [string, number][];
  coins: [number, number];
  heavy?: boolean;
  element?: Element;
}

export const KINDS: Record<EnemyKind, KindDef> = {
  goblin: { name: "Goblin", hp: 42, damage: 10, speed: 4.4, sight: 24, reach: 1.9, cooldown: 1.5, windup: 0.5, radius: 0.45, height: 1.5, dark: true, knock: 4, loot: [["goblin_horn", 0.5], ["apple", 0.25], ["health_potion", 0.08]], coins: [3, 9] },
  shaman: { name: "Goblin Shaman", hp: 36, damage: 12, speed: 3.6, sight: 28, reach: 14, cooldown: 2.6, windup: 0.8, radius: 0.45, height: 1.5, dark: true, ranged: { range: 15, element: "poison", color: "#8f3cff", speed: 13 }, knock: 3, loot: [["mountain_herb", 0.5], ["slime_gel", 0.3], ["purity_tonic", 0.1]], coins: [6, 14] },
  wolf: { name: "Shadow Wolf", hp: 34, damage: 8, speed: 7.8, sight: 28, reach: 2.2, cooldown: 1.3, windup: 0.35, radius: 0.6, height: 1.1, dark: false, knock: 3, loot: [["wolf_pelt", 0.6], ["roast_meat", 0.35]], coins: [0, 3] },
  skeleton: { name: "Restless Skeleton", hp: 58, damage: 14, speed: 4.0, sight: 22, reach: 2.1, cooldown: 1.6, windup: 0.6, radius: 0.45, height: 1.8, dark: true, knock: 5, loot: [["iron_ore", 0.35], ["ancient_ore", 0.08]], coins: [5, 15] },
  slime: { name: "Poison Slime", hp: 30, damage: 9, speed: 3.2, sight: 18, reach: 1.8, cooldown: 1.8, windup: 0.6, radius: 0.7, height: 1.2, dark: true, knock: 3, loot: [["slime_gel", 0.7]], coins: [1, 5], element: "poison" },
  bat: { name: "Cave Bat", hp: 16, damage: 6, speed: 7, sight: 20, reach: 1.6, cooldown: 1.6, windup: 0.3, radius: 0.5, height: 1, dark: true, flying: true, knock: 2, loot: [["crystal_shard", 0.08]], coins: [0, 3] },
  darkknight: { name: "Dark Knight", hp: 140, damage: 22, speed: 4.6, sight: 26, reach: 2.6, cooldown: 1.4, windup: 0.65, radius: 0.55, height: 2.1, dark: true, knock: 7, heavy: true, ranged: { range: 16, element: "dark", color: "#a23cff", speed: 14 }, loot: [["shadow_essence", 0.6], ["greater_potion", 0.15]], coins: [15, 30] },
  fireimp: { name: "Fire Imp", hp: 30, damage: 10, speed: 5, sight: 26, reach: 13, cooldown: 2.2, windup: 0.6, radius: 0.4, height: 1.2, dark: true, flying: true, ranged: { range: 14, element: "fire", color: "#ff6a1a", speed: 14 }, knock: 3, loot: [["crystal_shard", 0.15]], coins: [4, 10] },
  iceimp: { name: "Ice Imp", hp: 30, damage: 10, speed: 5, sight: 26, reach: 13, cooldown: 2.2, windup: 0.6, radius: 0.4, height: 1.2, dark: true, flying: true, ranged: { range: 14, element: "ice", color: "#8fe0ff", speed: 14 }, knock: 3, loot: [["crystal_shard", 0.15]], coins: [4, 10] },
  sprout: { name: "Thorn Sprout", hp: 22, damage: 8, speed: 0, sight: 20, reach: 12, cooldown: 2.0, windup: 0.5, radius: 0.5, height: 1.4, dark: false, ranged: { range: 13, element: "nature", color: "#7dff4a", speed: 15 }, knock: 2, loot: [["mountain_herb", 0.4]], coins: [0, 2] },
};

type AIState = "idle" | "patrol" | "alert" | "chase" | "windup" | "strike" | "recover" | "hurt" | "flee" | "return" | "dead" | "strafe";

let uid = 0;

export class Enemy implements Combatant {
  id: string;
  name: string;
  def: KindDef;
  alive = true;
  position: Vector3;
  velocity = new Vector3();
  yaw = 0;
  hp: number;
  maxHp: number;
  radius: number;
  height: number;
  dark: boolean;
  isBoss = false;
  interior: string | null;
  state: AIState = "idle";
  stateT = 0;
  cooldown = 1;
  home: Vector3;
  leash = 45;
  rig: Humanoid | null = null;
  model: TransformNode;
  parts: Record<string, TransformNode> = {};
  frozenT = 0;
  private flashT = 0;
  deadT = 0;
  private rng: RNG;
  private patrolTarget: Vector3 | null = null;
  private animT = Math.random() * 10;
  private hitDone = false;
  removed = false;
  campId: string | null = null;
  level = 1;
  private strafeDir = 1;
  summoned = false;

  constructor(private game: Game, public kind: EnemyKind, pos: Vector3, interior: string | null, level = 1) {
    this.id = `${kind}_${uid++}`;
    this.def = KINDS[kind];
    this.level = level;
    this.name = this.def.name;
    this.maxHp = Math.round(this.def.hp * (1 + (level - 1) * 0.35));
    this.hp = this.maxHp;
    this.radius = this.def.radius;
    this.height = this.def.height;
    this.dark = this.def.dark;
    this.interior = interior;
    this.position = pos.clone();
    this.home = pos.clone();
    this.rng = new RNG(uid * 977);
    this.yaw = this.rng.next() * Math.PI * 2;
    this.model = this.buildModel();
    game.combat.register(this);
  }

  private buildModel(): TransformNode {
    const g = this.game;
    const s = g.scene;
    switch (this.kind) {
      case "goblin":
      case "shaman":
      case "skeleton":
      case "darkknight":
      case "fireimp":
      case "iceimp": {
        let look: HumanoidLook;
        let weapon: string | null = null;
        if (this.kind === "goblin") {
          look = { skin: "#6f8f4a", hair: "#2a2a1a", top: "#5a4630", bottom: "#4a3a28", boots: "#3a2a1a", hairStyle: "spiky", ears: true, eyeGlow: "#ff3a1a", scale: 0.82, bulk: 1.15, belt: "#3a2a1a" };
          weapon = "club";
        } else if (this.kind === "shaman") {
          look = { skin: "#7a8f5a", hair: "#ddd", top: "#4a2a5a", bottom: "#3a2040", boots: "#2a1a1a", hairStyle: "long", ears: true, eyeGlow: "#c04aff", scale: 0.8, skirt: "#4a2a5a", hat: "hood", hatColor: "#3a1a4a" };
          weapon = "spear";
        } else if (this.kind === "skeleton") {
          look = { skin: "#e0d8c0", hair: "#000", top: "#d8d0b8", bottom: "#d8d0b8", boots: "#d8d0b8", skeleton: true, eyeGlow: "#7affea", hairStyle: "bald", hat: this.rng.chance(0.4) ? "helmet" : "none", hatColor: "#6b6b6b" };
          weapon = "bone";
        } else if (this.kind === "darkknight") {
          look = { skin: "#1a1420", hair: "#000", top: "#1f1a26", bottom: "#17121c", boots: "#100c14", armor: "#2a2433", eyeGlow: "#ff1a2a", hat: "greathelm", hatColor: "#231d2b", scale: 1.15, bulk: 1.15, cape: "#3a0a12" };
          weapon = "dark";
        } else {
          const fire = this.kind === "fireimp";
          look = { skin: fire ? "#a8321a" : "#4a8ab8", hair: fire ? "#ff8a1a" : "#d8f4ff", top: fire ? "#6a1a0a" : "#2a5a8a", bottom: fire ? "#4a1008" : "#1a3a5a", boots: "#111", hairStyle: "spiky", ears: true, eyeGlow: fire ? "#ffd21a" : "#ffffff", scale: 0.62 };
        }
        const rig = new Humanoid(s, look, this.id);
        this.rig = rig;
        if (weapon) {
          const w = buildWeapon(s, { model: weapon });
          w.root.parent = rig.handR;
          w.root.rotation.set(Math.PI / 2, 0, 0);
          if (weapon === "dark") g.glow.addIncludedOnlyMesh(w.blade);
        }
        if (this.kind === "fireimp" || this.kind === "iceimp") {
          // little wings
          const pb = new PartBuilder(s);
          const wc = this.kind === "fireimp" ? "#4a0a0a" : "#a8d8ff";
          pb.box(wc, 0.9, 0.5, 0.03, { pos: [-0.45, 0.1, -0.15], rot: [0, 0.4, 0.3] });
          const lw = pb.merge("wingL", rig.bones.chest);
          pb.box(wc, 0.9, 0.5, 0.03, { pos: [0.45, 0.1, -0.15], rot: [0, -0.4, -0.3] });
          const rw = pb.merge("wingR", rig.bones.chest);
          if (lw && rw) {
            this.parts.wingL = lw;
            this.parts.wingR = rw;
          }
          const orb = glowPart(s, "sphere", this.kind === "fireimp" ? "#ff6a1a" : "#8fe0ff", 0.3, rig.handR, [0, -0.1, 0.1], 2);
          g.glow.addIncludedOnlyMesh(orb);
        }
        return rig.root;
      }
      case "wolf": {
        const root = new TransformNode(this.id, s);
        const body = new TransformNode("body", s);
        body.parent = root;
        body.position.y = 0.75;
        const pb = new PartBuilder(s);
        const fur = this.rng.chance(0.5) ? "#4a4a52" : "#3a3540";
        pb.capsule(fur, 1.3, 0.32, { rot: [Math.PI / 2, 0, 0] });
        pb.sphere(fur, 0.62, { pos: [0, 0.08, 0.45] });
        pb.box("#2a2630", 0.3, 0.15, 0.6, { pos: [0, 0.32, -0.1] });
        this.meshes(pb.merge("wbody", body));
        const head = new TransformNode("head", s);
        head.parent = body;
        head.position.set(0, 0.25, 0.75);
        pb.box(fur, 0.34, 0.32, 0.36, {});
        pb.box("#2f2b34", 0.2, 0.17, 0.34, { pos: [0, -0.06, 0.3] });
        pb.cone(fur, 0.2, 0.12, { pos: [-0.1, 0.24, -0.05] }, 4);
        pb.cone(fur, 0.2, 0.12, { pos: [0.1, 0.24, -0.05] }, 4);
        pb.box("#eee", 0.16, 0.04, 0.1, { pos: [0, -0.14, 0.42] });
        this.meshes(pb.merge("whead", head));
        glowPart(s, "sphere", "#ffb21a", 0.06, head, [-0.09, 0.06, 0.17], 2.2);
        glowPart(s, "sphere", "#ffb21a", 0.06, head, [0.09, 0.06, 0.17], 2.2);
        const legs: [string, number, number][] = [["lf", -0.2, 0.45], ["rf", 0.2, 0.45], ["lb", -0.2, -0.45], ["rb", 0.2, -0.45]];
        for (const [n, x, z] of legs) {
          const leg = new TransformNode(n, s);
          leg.parent = body;
          leg.position.set(x, -0.1, z);
          pb.capsule(fur, 0.7, 0.08, { pos: [0, -0.32, 0] });
          this.meshes(pb.merge("leg", leg));
          this.parts[n] = leg;
        }
        const tail = new TransformNode("tail", s);
        tail.parent = body;
        tail.position.set(0, 0.1, -0.7);
        pb.capsule(fur, 0.6, 0.08, { pos: [0, 0, -0.25], rot: [Math.PI / 2 + 0.5, 0, 0] });
        this.meshes(pb.merge("tail", tail));
        this.parts.body = body;
        this.parts.head = head;
        this.parts.tail = tail;
        return root;
      }
      case "slime": {
        const root = new TransformNode(this.id, s);
        const body = new TransformNode("body", s);
        body.parent = root;
        const pb = new PartBuilder(s);
        pb.sphere("#6a2a8a", 1.4, { pos: [0, 0.6, 0], scale: [1, 0.85, 1] }, 12);
        pb.sphere("#9a4ac0", 0.5, { pos: [0.2, 0.95, 0.25] }, 8);
        this.meshes(pb.merge("slime", body));
        const e1 = glowPart(s, "sphere", "#9aff4a", 0.16, body, [-0.2, 0.8, 0.55], 2);
        const e2 = glowPart(s, "sphere", "#9aff4a", 0.16, body, [0.2, 0.8, 0.55], 2);
        g.glow.addIncludedOnlyMesh(e1);
        g.glow.addIncludedOnlyMesh(e2);
        this.parts.body = body;
        g.fx.emitter(body as any, { rate: 6, color1: new Color4(0.5, 0.2, 0.7, 0.6), color2: new Color4(0.3, 0.8, 0.3, 0.5), size: [0.2, 0.5], life: [0.8, 1.6], speed: [0.1, 0.4], box: 0.5, tex: "smoke", additive: false, capacity: 20 });
        return root;
      }
      case "bat": {
        const root = new TransformNode(this.id, s);
        const body = new TransformNode("body", s);
        body.parent = root;
        const pb = new PartBuilder(s);
        pb.sphere("#2a2228", 0.45, { scale: [1, 0.9, 1.3] });
        pb.cone("#2a2228", 0.15, 0.1, { pos: [-0.12, 0.22, 0.05] }, 4);
        pb.cone("#2a2228", 0.15, 0.1, { pos: [0.12, 0.22, 0.05] }, 4);
        this.meshes(pb.merge("bat", body));
        glowPart(s, "sphere", "#ff2a2a", 0.05, body, [-0.07, 0.05, 0.25], 2);
        glowPart(s, "sphere", "#ff2a2a", 0.05, body, [0.07, 0.05, 0.25], 2);
        for (const side of [-1, 1]) {
          const wing = new TransformNode("wing", s);
          wing.parent = body;
          wing.position.x = side * 0.15;
          pb.box("#1a1418", 0.8, 0.02, 0.45, { pos: [side * 0.4, 0, 0] });
          this.meshes(pb.merge("wing", wing));
          this.parts[side < 0 ? "wingL" : "wingR"] = wing;
        }
        this.parts.body = body;
        return root;
      }
      case "sprout": {
        const root = new TransformNode(this.id, s);
        const body = new TransformNode("body", s);
        body.parent = root;
        const pb = new PartBuilder(s);
        for (let k = 0; k < 5; k++) pb.cone("#3f7a2a", 0.9, 0.35, { pos: [Math.sin(k * 1.25) * 0.4, 0.3, Math.cos(k * 1.25) * 0.4], rot: [Math.cos(k * 1.25) * 0.8, 0, -Math.sin(k * 1.25) * 0.8] }, 4);
        pb.cyl("#4a8a2a", 0.9, 0.18, 0.25, { pos: [0, 0.6, 0] }, 6);
        this.meshes(pb.merge("stem", body));
        const head = new TransformNode("head", s);
        head.parent = body;
        head.position.y = 1.15;
        pb.sphere("#a83a5a", 0.6, { scale: [1, 0.8, 1] }, 8);
        pb.box("#2a0a10", 0.3, 0.12, 0.1, { pos: [0, -0.05, 0.27] });
        this.meshes(pb.merge("bulb", head));
        this.parts.body = body;
        this.parts.head = head;
        return root;
      }
    }
  }

  private meshes(m: Mesh | null): void {
    void m;
  }

  allMeshes(): AbstractMesh[] {
    return this.model.getChildMeshes(false);
  }

  lockPoint(): Vector3 {
    return this.position.add(new Vector3(0, this.height * 0.65, 0));
  }

  setVisible(v: boolean): void {
    this.model.setEnabled(v);
  }

  get aggression(): number {
    return this.game.evolution ? this.game.evolution.aggression : 1;
  }

  freeze(dur: number): void {
    this.frozenT = Math.max(this.frozenT, dur);
    this.setOverlay(new Color3(0.6, 0.85, 1), 0.55);
  }

  private setOverlay(c: Color3 | null, alpha = 0.6): void {
    for (const m of this.allMeshes()) {
      if (!c) {
        m.renderOverlay = false;
        continue;
      }
      m.renderOverlay = true;
      m.overlayColor = c;
      m.overlayAlpha = alpha;
    }
  }

  takeHit(h: HitInfo): void {
    if (!this.alive) return;
    const g = this.game;
    this.hp -= h.damage;
    this.flashT = 0.12;
    this.setOverlay(new Color3(1, 1, 1), 0.65);
    // knockback
    const dx = this.position.x - h.from.x, dz = this.position.z - h.from.z;
    const l = Math.hypot(dx, dz) || 1;
    const heavyFoe = this.def.heavy ? 0.4 : 1;
    this.velocity.x = (dx / l) * h.knockback * 2 * heavyFoe;
    this.velocity.z = (dz / l) * h.knockback * 2 * heavyFoe;
    if (h.element === "fire") g.fx.burst(this.lockPoint(), { count: 15, color1: new Color4(1, 0.5, 0.1, 1), tex: "spark", speed: [1, 3] });
    if (h.element === "ice" && Math.random() < 0.5) this.freeze(1.5);
    if (this.hp <= 0) {
      this.die();
      return;
    }
    if (!this.def.heavy || h.heavy) {
      this.state = "hurt";
      this.stateT = h.heavy ? 0.6 : 0.3;
    }
    if (this.state === "idle" || this.state === "patrol") this.state = "alert";
    // alert friends
    g.enemies.alertNear(this.position, 20);
  }

  alert(): void {
    if (this.alive && (this.state === "idle" || this.state === "patrol" || this.state === "return")) {
      this.state = "chase";
      this.stateT = 0;
    }
  }

  die(): void {
    if (!this.alive) return;
    const g = this.game;
    this.alive = false;
    this.state = "dead";
    this.deadT = 0;
    g.combat.unregister(this);
    g.audio.sfx("enemyDie", this.position);
    // loot
    for (const [id, p] of this.def.loot) if (Math.random() < p) g.inventory.spawnPickup(id, this.position.add(new Vector3(this.rng.range(-1, 1), 0.4, this.rng.range(-1, 1))));
    const fortune = g.inventory.has("charm_fortune") ? 1.6 : 1;
    const coins = Math.round(this.rng.range(this.def.coins[0], this.def.coins[1]) * fortune * (1 + (this.level - 1) * 0.3));
    if (coins > 0) g.inventory.spawnCoins(coins, this.position.add(new Vector3(0, 0.5, 0)));
    if (this.kind === "slime") g.combat.hazard(this.position.x, this.position.z, { radius: 2.5, dps: 6, element: "poison", life: 5, color: "#7a3aa0" });
    g.events.emit("enemyKilled", this);
  }

  // -------------------------------------------------------------------------------- AI
  update(dt: number): void {
    const g = this.game;
    this.animT += dt;
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.setOverlay(this.frozenT > 0 ? new Color3(0.6, 0.85, 1) : null, 0.55);
    }
    if (this.state === "dead") {
      this.deadT += dt;
      this.animateModel(dt, 0, "death", Math.min(1, this.deadT / 1.0));
      if (this.deadT > 1.1 && !this.removed) {
        this.removed = true;
        g.fx.deathPuff(this.lockPoint(), this.kind === "darkknight" ? 1.4 : 1);
        this.model.dispose();
      }
      return;
    }
    if (this.frozenT > 0) {
      this.frozenT -= dt;
      if (this.frozenT <= 0) this.setOverlay(null);
      this.snapGround(dt);
      this.model.position.copyFrom(this.position);
      return;
    }
    const p = g.player;
    const aggr = this.aggression;
    const dx = p.position.x - this.position.x, dz = p.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const toPlayer = Math.atan2(dx, dz);
    const night = g.env.daylight < 0.3 ? 0.75 : 1;
    const sameSpace = (g.interiors.current?.def.id ?? null) === this.interior;
    const canSense = sameSpace && !p.dead && g.state === "playing";
    const facing = Math.abs(wrapAngle(toPlayer - this.yaw)) < 1.4;
    const sight = this.def.sight * aggr * night * (p.sprinting ? 1.25 : 1);
    const sees = canSense && dist < sight && (facing || dist < sight * 0.35);
    this.cooldown -= dt;
    this.stateT -= dt;
    let moveSpeed = 0;
    let moveDir = this.yaw;
    const homeDist = Math.hypot(this.position.x - this.home.x, this.position.z - this.home.z);
    const sp = this.def.speed * (1 + (aggr - 1) * 0.25);

    switch (this.state) {
      case "idle":
        if (sees) {
          this.state = "alert";
          this.stateT = 0.5 / aggr;
          g.ui.enemyAlert(this);
          g.audio.sfx(this.kind === "wolf" ? "growl" : "alert", this.position);
          break;
        }
        if (this.stateT <= 0) {
          this.state = "patrol";
          this.patrolTarget = this.home.add(new Vector3(this.rng.range(-12, 12), 0, this.rng.range(-12, 12)));
          this.stateT = 6;
        }
        break;
      case "patrol":
        if (sees) {
          this.state = "alert";
          this.stateT = 0.5 / aggr;
          g.ui.enemyAlert(this);
          g.audio.sfx(this.kind === "wolf" ? "growl" : "alert", this.position);
          break;
        }
        if (this.patrolTarget && this.def.speed > 0) {
          const d = Math.hypot(this.patrolTarget.x - this.position.x, this.patrolTarget.z - this.position.z);
          moveDir = yawTo(this.position.x, this.position.z, this.patrolTarget.x, this.patrolTarget.z);
          moveSpeed = sp * 0.35;
          if (d < 1.5) this.patrolTarget = null;
        }
        if (this.stateT <= 0 || !this.patrolTarget) {
          this.state = "idle";
          this.stateT = this.rng.range(1.5, 4);
        }
        break;
      case "alert":
        this.yaw = dampAngle(this.yaw, toPlayer, 8, dt);
        if (this.stateT <= 0) this.state = "chase";
        break;
      case "chase": {
        if (!canSense || dist > sight * 1.8 || homeDist > this.leash * aggr) {
          this.state = "return";
          break;
        }
        const ranged = this.def.ranged;
        const wantRange = ranged ? ranged.range * 0.7 : this.def.reach + this.radius;
        if (ranged && dist < wantRange && this.cooldown <= 0) {
          this.state = "windup";
          this.stateT = this.def.windup;
          this.hitDone = false;
          break;
        }
        if (!ranged && dist < this.def.reach + 0.6 && this.cooldown <= 0) {
          this.state = "windup";
          this.stateT = this.def.windup / Math.min(1.4, aggr);
          this.hitDone = false;
          g.audio.sfx("windup", this.position);
          break;
        }
        moveDir = toPlayer;
        if (ranged && dist < wantRange * 0.6) moveDir = toPlayer + Math.PI; // keep distance
        else if (!ranged && dist < this.def.reach + 0.4) {
          // circle while waiting for cooldown
          moveDir = toPlayer + this.strafeDir * Math.PI * 0.5;
          if (this.rng.chance(dt * 0.3)) this.strafeDir *= -1;
        }
        moveSpeed = this.def.speed === 0 ? 0 : sp * (ranged && dist < wantRange ? 0.5 : 1);
        this.yaw = dampAngle(this.yaw, toPlayer, 7, dt);
        // low HP goblins may flee
        if (this.kind === "goblin" && this.hp < this.maxHp * 0.25 && this.rng.chance(dt * 0.2)) {
          this.state = "flee";
          this.stateT = 3;
        }
        break;
      }
      case "windup":
        this.yaw = dampAngle(this.yaw, toPlayer, 6, dt);
        if (this.kind === "wolf" && this.stateT < 0.1) {
          // lunge
          this.velocity.x = Math.sin(this.yaw) * 9;
          this.velocity.z = Math.cos(this.yaw) * 9;
        }
        if (this.stateT <= 0) {
          this.state = "strike";
          this.stateT = 0.3;
          this.performAttack(dist);
        }
        break;
      case "strike":
        if (this.stateT <= 0) {
          this.state = "recover";
          this.stateT = 0.4;
          this.cooldown = this.def.cooldown / Math.min(1.5, aggr) * this.rng.range(0.8, 1.3);
        }
        break;
      case "recover":
        if (this.stateT <= 0) this.state = "chase";
        break;
      case "hurt":
        if (this.stateT <= 0) this.state = "chase";
        break;
      case "flee":
        moveDir = toPlayer + Math.PI;
        moveSpeed = sp;
        if (this.stateT <= 0) this.state = "chase";
        break;
      case "return":
        if (sees && homeDist < this.leash * 0.8) {
          this.state = "chase";
          break;
        }
        moveDir = yawTo(this.position.x, this.position.z, this.home.x, this.home.z);
        moveSpeed = sp * 0.6;
        if (homeDist < 2) {
          this.state = "idle";
          this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.5);
        }
        break;
    }
    // movement
    if (this.def.speed > 0 && moveSpeed > 0) {
      const tx = Math.sin(moveDir) * moveSpeed, tz = Math.cos(moveDir) * moveSpeed;
      this.velocity.x = damp(this.velocity.x, tx, 8, dt);
      this.velocity.z = damp(this.velocity.z, tz, 8, dt);
      if (this.state !== "chase" && this.state !== "flee") this.yaw = dampAngle(this.yaw, moveDir, 6, dt);
      else if (this.state === "flee") this.yaw = dampAngle(this.yaw, moveDir, 8, dt);
    } else {
      this.velocity.x = damp(this.velocity.x, 0, 6, dt);
      this.velocity.z = damp(this.velocity.z, 0, 6, dt);
    }
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    if (this.interior === (g.interiors.current?.def.id ?? null)) g.physics.resolve(this.position, this.radius, this.height);
    // avoid deep water
    if (!this.interior && g.physics.waterLevel(this.position.x, this.position.z) > g.physics.terrainHeight(this.position.x, this.position.z) + 1) {
      this.position.x -= this.velocity.x * dt * 2;
      this.position.z -= this.velocity.z * dt * 2;
    }
    this.snapGround(dt);
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    this.animateModel(dt, hs, this.state, 0);
  }

  private snapGround(dt: number): void {
    const g = this.game;
    let gy = g.physics.groundHeight(this.position.x, this.position.z, this.position.y + 1);
    if (this.def.flying) gy += 1.8 + Math.sin(this.animT * 2) * 0.4 + (this.state === "windup" && this.kind === "bat" ? -1.2 : 0);
    this.position.y = this.def.flying ? damp(this.position.y, gy, 4, dt) : gy;
    this.model.position.copyFrom(this.position);
    this.model.rotation.y = this.yaw;
  }

  private performAttack(dist: number): void {
    const g = this.game;
    const r = this.def.ranged;
    const dmg = this.def.damage * (1 + (this.aggression - 1) * 0.5) * (1 + (this.level - 1) * 0.3);
    if (r && (dist > this.def.reach * 0.25 || this.kind !== "darkknight")) {
      const from = this.position.add(new Vector3(Math.sin(this.yaw) * 0.6, this.height * 0.75, Math.cos(this.yaw) * 0.6));
      const target = g.player.position.add(new Vector3(0, 1.0, 0));
      g.combat.spawnProjectile({ from, target, speed: r.speed, damage: dmg, owner: "enemy", element: r.element, color: r.color, size: 0.5, homing: this.kind === "shaman" ? 0.8 : 0.4, aoe: r.element === "poison" ? 2 : 0 });
      g.audio.sfx(r.element === "fire" ? "fireball" : "magicCast", from);
      if (this.kind === "darkknight") return;
      return;
    }
    const hit = g.combat.meleeHitPlayer(this.position, this.yaw, this.def.reach + 0.3, 1.8, dmg, { knockback: this.def.knock, element: this.def.element, source: this });
    g.audio.sfx(this.kind === "wolf" ? "bite" : "enemySwing", this.position);
    if (hit) g.audio.sfx("hit");
  }

  /** Parry response. */
  stagger(): void {
    if (!this.alive) return;
    this.state = "hurt";
    this.stateT = 1.4;
    this.setOverlay(new Color3(1, 1, 0.5), 0.5);
    this.flashT = 0.3;
  }

  private animateModel(dt: number, speed: number, state: string, deathK: number): void {
    const t = this.animT;
    if (this.rig) {
      let action: string | null = null;
      let at = 0, ad = 1;
      if (state === "windup") {
        action = this.def.ranged ? "cast" : "attack3";
        at = (1 - Math.max(0, this.stateT) / this.def.windup) * 0.35;
        ad = 1;
      } else if (state === "strike") {
        action = this.def.ranged ? "cast" : "attack3";
        at = 0.35 + (1 - Math.max(0, this.stateT) / 0.3) * 0.4;
      } else if (state === "hurt") {
        action = "hit";
        at = 0.5 - Math.max(0, this.stateT) * 0.5;
        ad = 1;
      } else if (state === "alert") action = "roar";
      else if (state === "death" || state === "dead") {
        action = "death";
        at = deathK;
      }
      this.rig.animate(dt, { speed, grounded: true, vy: 0, action, actionT: at, actionDur: ad, blocking: false, armed: !this.def.ranged && this.kind !== "fireimp" && this.kind !== "iceimp" });
      if (this.parts.wingL) {
        this.parts.wingL.rotation.z = Math.sin(t * 18) * 0.6;
        this.parts.wingR.rotation.z = -Math.sin(t * 18) * 0.6;
      }
      return;
    }
    const P = this.parts;
    if (this.kind === "wolf") {
      const ph = t * (4 + speed * 1.2);
      const amp = Math.min(1, speed / 4) * 0.7;
      P.lf.rotation.x = Math.sin(ph) * amp;
      P.rb.rotation.x = Math.sin(ph) * amp;
      P.rf.rotation.x = -Math.sin(ph) * amp;
      P.lb.rotation.x = -Math.sin(ph) * amp;
      P.body.position.y = 0.75 + Math.abs(Math.sin(ph)) * 0.06 * amp;
      P.tail.rotation.y = Math.sin(t * 6) * 0.4;
      P.head.rotation.x = state === "windup" ? -0.3 : state === "strike" ? 0.4 : 0;
      if (state === "dead") {
        P.body.rotation.z = deathK * 1.5;
        P.body.position.y = 0.75 - deathK * 0.4;
      }
    } else if (this.kind === "slime") {
      const hop = Math.abs(Math.sin(t * 4)) * (speed > 0.5 ? 1 : 0.2);
      P.body.position.y = hop * 0.8;
      const sq = state === "windup" ? 0.7 : 1 - hop * 0.15;
      P.body.scaling.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      if (state === "dead") P.body.scaling.set(1 + deathK, 1 - deathK * 0.9, 1 + deathK);
    } else if (this.kind === "bat") {
      P.wingL.rotation.z = Math.sin(t * 22) * 0.9;
      P.wingR.rotation.z = -Math.sin(t * 22) * 0.9;
      if (state === "dead") P.body.rotation.z = deathK * 3;
    } else if (this.kind === "sprout") {
      P.head.rotation.x = state === "windup" ? -0.5 : state === "strike" ? 0.4 : Math.sin(t * 1.5) * 0.1;
      P.body.rotation.y = Math.sin(t * 0.8) * 0.2;
      if (state === "dead") P.body.scaling.y = 1 - deathK * 0.9;
    }
    void clamp01;
  }

  dispose(): void {
    this.game.combat.unregister(this);
    if (!this.removed) this.model.dispose();
    this.removed = true;
    this.alive = false;
  }
}
