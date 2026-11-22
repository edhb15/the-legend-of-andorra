import { Vector3 } from "@babylonjs/core";
import type { Game } from "../core/Game";
import { Humanoid, HumanoidLook } from "../entities/Humanoid";
import type { Village, Spot } from "../world/Villages";
import { LINES, GREETINGS, FIRST_NAMES_F, FIRST_NAMES_M, Role } from "../data/dialogue";
import { RNG, hashString, damp, dampAngle, yawTo, wrapAngle } from "../core/MathUtil";
import { HOME_VILLAGE } from "../world/AndorraData";

export type Activity = "sleep" | "work" | "wander" | "social" | "sit" | "pack" | "cower" | "guard" | "evacuate" | "gather" | "cheer" | "idle" | "special";

export interface NPC {
  id: string;
  name: string;
  role: Role;
  female: boolean;
  village: Village;
  current: Village;
  homeSpot: Spot;
  workSpot: Spot | null;
  look: HumanoidLook;
  position: Vector3;
  yaw: number;
  target: Vector3 | null;
  via: Vector3 | null;
  activity: Activity;
  action: string | null;
  rig: Humanoid | null;
  inside: boolean;
  bubbleT: number;
  thinkT: number;
  speed: number;
  evacuated: boolean;
  special?: string;
  talkTo: NPC | null;
  fixed?: { pos: Vector3; yaw: number; action?: string };
  hidden?: boolean;
  seed: number;
  greetedT: number;
}

const SKIN = ["#e8c4a0", "#d9a982", "#c89070", "#f0d0b0", "#b07a58"];
const HAIR = ["#2a1a10", "#4a2f1c", "#6b4a2a", "#9a7a50", "#1a1a1a", "#d8c8a8", "#7a3a1a", "#bbbbbb"];
const CLOTH = ["#7a3a2a", "#3a5a7a", "#5a6a3a", "#7a6a4a", "#4a3a5a", "#8a5a3a", "#3a4a4a", "#6a2a3a", "#2f4f6f", "#5a4a2a"];

/** Villagers with daily routines that react to the time of day and the advancing cloud. */
export class NPCBehaviourSystem {
  npcs: NPC[] = [];
  private visRadius = 120;

  constructor(private game: Game) {}

  init(): void {
    const g = this.game;
    for (const v of g.world.villages) this.populate(v);
    this.addSpecialNPCs();
  }

  private makeLook(rng: RNG, role: Role, female: boolean): HumanoidLook {
    const top = rng.pick(CLOTH);
    const look: HumanoidLook = {
      skin: rng.pick(SKIN), hair: rng.pick(HAIR), top, bottom: rng.pick(["#4a3a2a", "#3a3a3a", "#5a4a3a", "#2a2a3a"]), boots: rng.pick(["#3a2a1a", "#2a2018", "#4a3a2a"]),
      hairStyle: female ? rng.pick(["long", "bun", "ponytail"]) : rng.pick(["short", "short", "bald", "spiky"]),
      belt: "#5a3a20", skirt: female && rng.chance(0.7) ? rng.pick(CLOTH) : undefined,
      beard: !female && rng.chance(0.35) ? rng.pick(HAIR) : undefined,
      scale: role === "child" ? 0.62 : rng.range(0.93, 1.06), bulk: rng.range(0.92, 1.12),
    };
    if (role === "farmer") (look.hat = "straw"), (look.hatColor = "#c9ad5a");
    if (role === "smith") (look.apron = "#3a2a1a"), (look.sleeves = look.skin);
    if (role === "guard") (look.armor = "#7a7f86"), (look.hat = "helmet"), (look.hatColor = "#6a6f76"), (look.top = "#7a1a1a"), (look.cape = "#5a1010");
    if (role === "innkeeper") look.apron = "#e8e0d0";
    if (role === "merchant") (look.hat = "cap"), (look.hatColor = rng.pick(CLOTH));
    if (role === "healer") (look.top = "#3a6a4a"), (look.hat = "kerchief"), (look.hatColor = "#e8e0d0");
    if (role === "elder") (look.hair = "#dddddd"), (look.beard = female ? undefined : "#e0e0e0"), (look.top = "#4a3a5a"), (look.skirt = "#4a3a5a");
    if (role === "mystic") (look.hat = "hood"), (look.hatColor = "#2a1a4a"), (look.top = "#3a2a5a"), (look.skirt = "#2a1a4a");
    if (role === "historian") (look.top = "#3a3a5a"), (look.hat = "cap"), (look.hatColor = "#2a2a3a");
    return look;
  }

  private populate(v: Village): void {
    const rng = new RNG(hashString(v.id + "npc"));
    const roles: Role[] = [];
    const isHome = v.id === HOME_VILLAGE;
    if (isHome) roles.push("elder");
    if (v.inn) roles.push("innkeeper");
    if (v.smithy) roles.push("smith");
    if (v.shop) roles.push("merchant");
    if (v.id === "encamp") roles.push("healer");
    if (v.id === "andorra") roles.push("historian");
    roles.push("guard");
    if (v.fieldSpots.length) roles.push("farmer");
    while (roles.length < v.def.npcs) roles.push(rng.pick(["villager", "villager", "farmer", "child", "traveller", "guard"] as Role[]));
    const homes = v.spots.filter((s) => s.kind === "home");
    roles.forEach((role, i) => {
      const female = role === "child" ? rng.chance(0.5) : rng.chance(role === "guard" ? 0.25 : 0.5);
      let name = rng.pick(female ? FIRST_NAMES_F : FIRST_NAMES_M);
      if (isHome && role === "elder") name = "Elder Joan";
      if (isHome && role === "innkeeper") name = "Montse";
      if (isHome && role === "smith") name = "Jaume";
      if (isHome && role === "merchant") name = "Carme";
      if (v.id === "andorra" && role === "historian") name = "Oriol the Historian";
      if (v.id === "encamp" && role === "healer") name = "Roser the Healer";
      const home = homes[i % Math.max(1, homes.length)] ?? { x: v.x, y: v.y, z: v.z, yaw: 0, kind: "home" as const };
      let work: Spot | null = null;
      if (role === "smith") work = v.spots.find((s) => s.kind === "anvil") ?? null;
      if (role === "merchant") work = v.spots.find((s) => s.kind === "stall") ?? null;
      if (role === "farmer") work = v.fieldSpots.length ? rng.pick(v.fieldSpots) : null;
      if (role === "innkeeper" && v.inn) work = { x: v.inn.door.x, y: v.inn.door.y, z: v.inn.door.z, yaw: v.inn.yaw, kind: "inn" };
      const look = this.makeLook(rng, role, female);
      const pos = new Vector3(v.x + rng.range(-8, 8), v.y, v.z + rng.range(-8, 8));
      const npc: NPC = {
        id: `${v.id}_npc${i}`, name, role, female, village: v, current: v, homeSpot: home, workSpot: work, look, position: pos, yaw: rng.next() * 6.28,
        target: null, via: null, activity: "idle", action: null, rig: null, inside: false, bubbleT: rng.range(5, 20), thinkT: rng.range(0, 2), speed: 1.4,
        evacuated: false, talkTo: null, seed: hashString(v.id + i), greetedT: 0,
      };
      if (isHome && role === "elder") {
        // the elder waits by the waystone, leaning on his staff
        const ep = new Vector3(v.waystone.x + 2.2, v.waystone.y, v.waystone.z - 1.6);
        ep.y = this.game.terrain.getHeight(ep.x, ep.z);
        npc.position.copyFrom(ep);
        npc.fixed = { pos: ep, yaw: Math.atan2(v.x - ep.x, v.z - ep.z) };
      }
      this.npcs.push(npc);
    });
    // name the captain of Canillo and the Sant Julià father
    if (v.id === "canillo") {
      const gd = this.npcs.find((n) => n.village === v && n.role === "guard");
      if (gd) {
        gd.name = "Captain Marc";
        gd.special = "captain";
      }
    }
    if (v.id === "ordino") {
      const vil = this.npcs.find((n) => n.village === v && n.role === "villager" && n.female);
      const any = vil ?? this.npcs.find((n) => n.village === v && n.role === "villager");
      if (any) {
        any.name = "Núria";
        any.special = "nuria";
        any.female = true;
      }
    }
    if (v.id === "santjulia") {
      const f = this.npcs.find((n) => n.village === v && n.role === "villager");
      if (f) {
        f.name = "Pau";
        f.special = "pau";
      }
    }
  }

  /** NPCs that live outside villages (quest characters). */
  private addSpecialNPCs(): void {
    const g = this.game;
    const rng = new RNG(99);
    const mer = g.world.sites.get("meritxell");
    if (mer) {
      const v = g.world.village("canillo");
      const pos = new Vector3(mer.x + Math.sin(mer.yaw) * 10, 0, mer.z + Math.cos(mer.yaw) * 10);
      pos.y = g.terrain.getHeight(pos.x, pos.z);
      this.npcs.push(this.fixedNPC("laia", "Laia the Mystic", "mystic", true, v, pos, mer.yaw + Math.PI, this.makeLook(rng, "mystic", true)));
    }
    const forge = g.world.sites.get("forge");
    if (forge) {
      const v = g.world.village("canillo");
      const a = forge.anchors.smith ?? new Vector3(forge.x, forge.y, forge.z);
      const look: HumanoidLook = { skin: "#d8b090", hair: "#f0f0f0", top: "#5a3a2a", bottom: "#3a2a1a", boots: "#2a1a10", beard: "#f4f4f4", hairStyle: "long", apron: "#2a1a10", sleeves: "#d8b090", scale: 1.05, bulk: 1.15 };
      const n = this.fixedNPC("swordmaker", "Mestre Ferran, the Sword Maker", "smith", false, v, a.clone(), forge.yaw, look);
      n.fixed!.action = "hammer";
      this.npcs.push(n);
    }
  }

  fixedNPC(id: string, name: string, role: Role, female: boolean, v: Village, pos: Vector3, yaw: number, look: HumanoidLook): NPC {
    return {
      id, name, role, female, village: v, current: v, homeSpot: { x: pos.x, y: pos.y, z: pos.z, yaw, kind: "home" }, workSpot: null, look,
      position: pos.clone(), yaw, target: null, via: null, activity: "special", action: null, rig: null, inside: false, bubbleT: 15, thinkT: 0, speed: 1.2,
      evacuated: false, special: id, talkTo: null, fixed: { pos: pos.clone(), yaw }, seed: hashString(id), greetedT: 0,
    };
  }

  byId(id: string): NPC | undefined {
    return this.npcs.find((n) => n.id === id || n.special === id);
  }

  stage(): number {
    const g = this.game;
    if (g.victory > 0) return 3;
    const d = g.time.day;
    return d <= 4 ? 0 : d <= 9 ? 1 : 2;
  }

  // -------------------------------------------------------------------------------- schedule
  private decide(n: NPC): void {
    const g = this.game;
    const h = g.time.hour;
    const v = n.current;
    const st = v.state;
    const rng = new RNG(n.seed + Math.floor(g.time.minutes / 45));
    n.action = null;
    n.talkTo = null;
    n.speed = st === "fearful" || st === "evacuating" ? 2.6 : 1.4;
    if (n.fixed) {
      n.activity = "special";
      n.target = n.fixed.pos.clone();
      n.action = n.fixed.action ?? null;
      return;
    }
    if (g.victory > 0) {
      n.activity = "cheer";
      n.target = this.socialPoint(v, rng);
      n.action = "cheer";
      return;
    }
    // evacuation
    if (!n.evacuated && (st === "evacuating" || st === "abandoned") && v.id !== HOME_VILLAGE) {
      n.activity = "evacuate";
      const refuge = g.world.homeVillage();
      n.target = new Vector3(refuge.x + rng.range(-14, 14), refuge.y, refuge.z + rng.range(-14, 14));
      n.speed = 2.2;
      return;
    }
    if (n.evacuated) {
      // refugees huddle around the camp in the home village
      const r = g.world.homeVillage();
      n.activity = "gather";
      const a = rng.next() * Math.PI * 2;
      n.target = new Vector3(r.x + Math.sin(a) * rng.range(12, 22), r.y, r.z + Math.cos(a) * rng.range(12, 22));
      n.action = h > 22 || h < 6 ? "sleep" : rng.chance(0.4) ? "sit" : rng.chance(0.3) ? "cower" : null;
      return;
    }
    const night = h >= 22 || h < 6;
    if (night) {
      if (n.role === "guard" && rng.chance(0.5)) {
        n.activity = "guard";
        n.target = this.guardPoint(v, rng);
        return;
      }
      n.activity = "sleep";
      n.target = new Vector3(n.homeSpot.x, n.homeSpot.y, n.homeSpot.z);
      return;
    }
    if (st === "fearful" && rng.chance(0.35) && n.role !== "guard") {
      n.activity = "pack";
      const hs = n.homeSpot;
      n.target = new Vector3(hs.x + rng.range(-2, 2), hs.y, hs.z + rng.range(-2, 2));
      n.action = rng.chance(0.5) ? "pickup" : null;
      return;
    }
    if (st === "fearful" && rng.chance(0.12)) {
      n.activity = "cower";
      n.target = this.socialPoint(v, rng);
      n.action = "cower";
      return;
    }
    const lunch = h >= 12 && h < 14;
    const evening = h >= 18;
    const workHours = !lunch && !evening && h >= 8;
    if (workHours && n.workSpot && !(st === "fearful" && n.role === "merchant" && h > 16)) {
      n.activity = "work";
      n.target = new Vector3(n.workSpot.x, n.workSpot.y, n.workSpot.z);
      n.action = n.role === "smith" ? "hammer" : n.role === "farmer" ? "hoe" : null;
      return;
    }
    if (n.role === "guard") {
      n.activity = "guard";
      n.target = this.guardPoint(v, rng);
      return;
    }
    if (lunch || evening) {
      const sits = v.spots.filter((s) => s.kind === "sit");
      if (sits.length && rng.chance(0.5)) {
        const s = rng.pick(sits);
        n.activity = "sit";
        n.target = new Vector3(s.x, s.y, s.z);
        (n as any).sitYaw = s.yaw;
        n.action = "sit";
        return;
      }
    }
    // social / wander
    if (rng.chance(0.5)) {
      n.activity = "social";
      n.target = this.socialPoint(v, rng);
      return;
    }
    n.activity = "wander";
    n.target = new Vector3(v.x + rng.range(-v.radius * 0.6, v.radius * 0.6), v.y, v.z + rng.range(-v.radius * 0.6, v.radius * 0.6));
  }

  private socialPoint(v: Village, rng: RNG): Vector3 {
    const s = v.spots.filter((q) => q.kind === "social");
    if (!s.length) return new Vector3(v.x, v.y, v.z);
    const p = rng.pick(s);
    return new Vector3(p.x, p.y, p.z);
  }
  private guardPoint(v: Village, rng: RNG): Vector3 {
    if (v.entrances.length && rng.chance(0.7)) {
      const e = rng.pick(v.entrances);
      return new Vector3(e.x, 0, e.z);
    }
    return new Vector3(v.waystone.x + rng.range(-3, 3), v.y, v.waystone.z + rng.range(-3, 3));
  }

  // -------------------------------------------------------------------------------- update
  update(dt: number): void {
    const g = this.game;
    const p = g.player.position;
    const inCave = !!g.interiors.current;
    for (const n of this.npcs) {
      if (n.hidden) {
        if (n.rig) this.hide(n);
        continue;
      }
      n.thinkT -= dt;
      if (n.thinkT <= 0) {
        n.thinkT = 6 + (n.seed % 7);
        this.decide(n);
      }
      const dist = Math.hypot(n.position.x - p.x, n.position.z - p.z);
      const visible = !inCave && dist < this.visRadius && !n.inside;
      this.move(n, dt, visible);
      if (visible && !n.rig) this.show(n);
      else if (!visible && n.rig) this.hide(n);
      if (n.rig) this.animate(n, dt, dist);
    }
  }

  private move(n: NPC, dt: number, visible: boolean): void {
    const g = this.game;
    if (!n.target) return;
    if (n.fixed) {
      n.position.copyFrom(n.fixed.pos);
      if (n.action === null) {
        // face the player when nearby
        const p = g.player.position;
        if (Math.hypot(p.x - n.position.x, p.z - n.position.z) < 8) n.yaw = dampAngle(n.yaw, yawTo(n.position.x, n.position.z, p.x, p.z), 4, dt);
      } else n.yaw = n.fixed.yaw;
      return;
    }
    const tgt = n.via ?? n.target;
    const dx = tgt.x - n.position.x, dz = tgt.z - n.position.z;
    const d = Math.hypot(dx, dz);
    const arrive = n.activity === "evacuate" ? 6 : 0.6;
    if (d < arrive) {
      if (n.via) {
        n.via = null;
        return;
      }
      if (n.activity === "sleep") n.inside = true;
      if (n.activity === "evacuate") {
        n.evacuated = true;
        n.current = g.world.homeVillage();
        n.thinkT = 0;
      }
      if (n.activity === "sit" && (n as any).sitYaw !== undefined) n.yaw = (n as any).sitYaw;
      (n as any).moving = false;
      return;
    }
    if (n.activity !== "sleep") n.inside = false;
    (n as any).moving = true;
    let step = n.speed * dt;
    if (!visible && n.activity === "evacuate") step *= 3; // off-screen travel is abstracted
    n.position.x += (dx / d) * Math.min(step, d);
    n.position.z += (dz / d) * Math.min(step, d);
    n.yaw = dampAngle(n.yaw, Math.atan2(dx, dz), 6, dt);
    if (visible) {
      const before = n.position.clone();
      g.physics.resolve(n.position, 0.35, 1.7);
      // stuck behind a building: route through the plaza
      if (Vector3.Distance(before, n.position) > step * 0.6 && !n.via) n.via = new Vector3(n.current.x, n.current.y, n.current.z);
      n.position.y = g.physics.groundHeight(n.position.x, n.position.z, n.position.y + 1);
    } else n.position.y = g.terrain.getHeight(n.position.x, n.position.z);
  }

  private show(n: NPC): void {
    n.rig = new Humanoid(this.game.scene, n.look, n.id);
    n.rig.setPosition(n.position.x, n.position.y, n.position.z, n.yaw);
  }
  private hide(n: NPC): void {
    n.rig?.dispose();
    n.rig = null;
  }

  private animate(n: NPC, dt: number, dist: number): void {
    const g = this.game;
    const rig = n.rig!;
    const moving = !!(n as any).moving;
    let action: string | null = moving ? (n.activity === "evacuate" && n.current.state !== "peaceful" ? null : null) : n.action;
    let lookYaw = 0;
    const p = g.player.position;
    // react to the player
    if (dist < 6 && !moving && n.action !== "sleep" && n.action !== "hammer" && n.action !== "hoe") {
      const want = yawTo(n.position.x, n.position.z, p.x, p.z);
      const rel = wrapAngle(want - n.yaw);
      if (Math.abs(rel) < 1.3) lookYaw = rel;
      else if (!n.action) n.yaw = dampAngle(n.yaw, want, 3, dt);
      n.greetedT -= dt;
      if (n.greetedT <= 0 && g.state === "playing") {
        n.greetedT = 40;
        const st = this.stage();
        const line = st === 0 ? GREETINGS[n.seed % GREETINGS.length] : st === 1 ? ["Stay safe out there.", "Is it true the cloud is coming?", "Hero! Any news?"][n.seed % 3] : st === 2 ? ["Please... save us.", "It's so close now.", "Hurry, hero."][n.seed % 3] : "Hooray for the hero!";
        g.ui.speech(n.id, rig.root, line);
        if (st < 3 && n.role !== "child" && Math.random() < 0.3) action = "wave";
      }
    }
    if (n.activity === "social" && !moving) {
      action = Math.sin(g.elapsed * 0.4 + n.seed) > 0 ? "talk" : null;
      n.bubbleT -= dt;
      if (n.bubbleT <= 0 && dist < 30) {
        n.bubbleT = 14 + (n.seed % 10);
        const st = this.stage();
        const pool = LINES[n.role][Math.min(st, 3)];
        g.ui.speech(n.id, rig.root, pool[(Math.floor(g.elapsed) + n.seed) % pool.length].split(".")[0] + ".");
      }
    }
    if (n.activity === "pack" && moving) (rig as any)._carry = true;
    rig.setPosition(n.position.x, n.position.y, n.position.z, n.yaw);
    const sp = moving ? n.speed : 0;
    rig.animate(dt, { speed: sp, grounded: true, vy: 0, action: moving ? null : action, actionT: 0.5, actionDur: 1, blocking: false, lookYaw, carry: n.activity === "pack" && moving });
  }

  pushOut(pos: Vector3, r: number): void {
    for (const n of this.npcs) {
      if (!n.rig) continue;
      const dx = pos.x - n.position.x, dz = pos.z - n.position.z;
      const d = Math.hypot(dx, dz);
      const rr = r + 0.35;
      if (d < rr && d > 0.001) {
        pos.x = n.position.x + (dx / d) * rr;
        pos.z = n.position.z + (dz / d) * rr;
      }
    }
  }

  /** Lines for this NPC right now. */
  linesFor(n: NPC): string[] {
    const st = this.stage();
    return LINES[n.role][Math.min(3, st)];
  }

  serialize() {
    return { npcs: this.npcs.map((n) => ({ id: n.id, evacuated: n.evacuated, hidden: !!n.hidden, x: n.position.x, z: n.position.z })) };
  }
  deserialize(d: any) {
    if (!d?.npcs) return;
    const home = this.game.world.homeVillage();
    for (const s of d.npcs) {
      const n = this.npcs.find((q) => q.id === s.id);
      if (!n) continue;
      n.evacuated = !!s.evacuated;
      n.hidden = !!s.hidden;
      if (n.evacuated) n.current = home;
      if (typeof s.x === "number" && !n.fixed) {
        n.position.set(s.x, this.game.terrain.getHeight(s.x, s.z), s.z);
      }
      n.thinkT = 0;
    }
  }
}
