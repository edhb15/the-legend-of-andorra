import { Vector3, Color4, MeshBuilder, StandardMaterial, Color3, PointLight, Mesh } from "@babylonjs/core";
import type { Game } from "../core/Game";
import type { NPC } from "./NPCBehaviourSystem";
import type { Village } from "../world/Villages";
import { RNG, yawTo, hashString } from "../core/MathUtil";
import { StructureBuilder, buildStele } from "../world/Buildings";
import { glowMaterial } from "../entities/CharacterKit";
import { HOME_VILLAGE, geoToWorld } from "../world/AndorraData";
import { item, ITEMS } from "../data/items";

export type QuestStatus = "inactive" | "active" | "done" | "failed";

export interface QuestDef {
  id: string;
  title: string;
  giver: string;
  main?: boolean;
  objectives: string[];
}

export interface QuestState {
  status: QuestStatus;
  stage: number;
  data: Record<string, any>;
}

export const QUESTS: QuestDef[] = [
  {
    id: "main", title: "The Shadow over Andorra", giver: "Elder Joan", main: true,
    objectives: [
      "Speak with Elder Joan in the square of Ordino",
      "Defeat the five guardians and claim their shards",
      "Find the legendary sword maker — where smoke rises from stone",
      "Bring the five shards to Mestre Ferran's forge",
      "Enter Zorg's Cave on Comapedrosa",
      "Defeat Zorg and save Andorra",
    ],
  },
  { id: "shepherd", title: "The Lost Shepherd", giver: "Núria", objectives: ["Find Pere near the Tristaina Lakes in the north", "Return to Núria in Ordino"] },
  { id: "oldkings", title: "Treasure of the Old Kings", giver: "Oriol the Historian", objectives: ["Search the Ruins of the Old Kings near Lake Engolasters", "Find the treasure inside the vault", "Return the crown to Oriol in Andorra la Vella"] },
  { id: "canillo", title: "Hold the Line at Canillo", giver: "Captain Marc", objectives: ["Defend Canillo from the goblin raid"] },
  { id: "lanterns", title: "Lights of the Ancients", giver: "Laia the Mystic", objectives: ["Find the five Spirit Lanterns hidden across Andorra", "Return to Laia at the Sanctuary of Meritxell"] },
  { id: "chronicle", title: "Chronicle of the Shards", giver: "Elder Joan", objectives: ["Read the five ancient steles scattered across Andorra"] },
  { id: "herbs", title: "Herbs for the Sick", giver: "Roser the Healer", objectives: ["Gather 5 Mountain Herbs", "Bring the herbs to Roser in Encamp"] },
  { id: "caravan", title: "The Last Caravan", giver: "Pau", objectives: ["Clear the goblin ambush on the road north of Sant Julià", "Tell Pau the road is safe"] },
];

const STELE_TEXT = [
  "In the first age, when the valleys were young, five guardians walked the mountains of Andorra: Fire, Nature, Ice, Light and Lightning.",
  "Fire slept beneath the Black Peak in the south. Nature took root in the elder grove of Madriu.",
  "Ice coiled within the frozen hollow of l'Estanyó. Light was entrusted to the knights of Enclar.",
  "Lightning crowned the high summit of the Pessons. When the guardians lay down to sleep, their hearts became the five shards.",
  "When darkness returns from Comapedrosa, bring the five shards to the smith who walks above the clouds, on the shoulder of Casamanya, where smoke rises from stone.",
];
const STELE_SITES = ["meritxell", "margineda", "tristaina", "engolasters", "ruins_incles"];
const LANTERN_SPOTS: { id: string; site?: string; lat?: number; lon?: number; interior?: string; room?: number }[] = [
  { id: "l_casamanya", lat: 42.5838, lon: 1.5652 },
  { id: "l_tristaina", site: "tristaina" },
  { id: "l_juclar", site: "juclar" },
  { id: "l_crystal", interior: "hidden2", room: 2 },
  { id: "l_margineda", site: "margineda" },
];

const SHOPS: Record<string, [string, number][]> = {
  merchant: [["health_potion", 30], ["stamina_tonic", 25], ["purity_tonic", 60], ["apple", 3], ["cheese", 10], ["roast_meat", 15], ["leather_tunic", 80], ["cape_forest", 80], ["hat_cap", 60]],
  smith: [["iron_sword", 160], ["steel_longsword", 340], ["chainmail", 300], ["leather_tunic", 75]],
  healer: [["health_potion", 28], ["greater_potion", 80], ["purity_tonic", 55], ["stamina_tonic", 22], ["elixir", 220]],
  innkeeper: [["roast_meat", 12], ["cheese", 8], ["apple", 3], ["health_potion", 34]],
};

/** Quests, conversations, shops, waystones, discovery — the narrative hub. */
export class QuestManager {
  states = new Map<string, QuestState>();
  tracked = "main";
  steleRead = new Set<number>();
  lanternsFound = new Set<string>();
  rumors = new Set<string>();
  markers: { x: number; z: number; label: string }[] = [];
  private herbTaken = new Map<string, number>();
  private discoverT = 0;
  private lanternMeshes = new Map<string, Mesh>();
  raid: { wave: number; enemies: any[]; t: number } | null = null;

  constructor(private game: Game) {}

  st(id: string): QuestState {
    let s = this.states.get(id);
    if (!s) {
      s = { status: "inactive", stage: 0, data: {} };
      this.states.set(id, s);
    }
    return s;
  }

  start(id: string): void {
    const s = this.st(id);
    if (s.status !== "inactive") return;
    s.status = "active";
    s.stage = 0;
    const def = QUESTS.find((q) => q.id === id)!;
    if (this.st("main").status !== "active" || this.tracked !== "main") this.tracked = id;
    this.game.ui.questToast("New Quest", def.title);
    this.game.audio.sfx("questStart");
  }
  advance(id: string, stage?: number): void {
    const s = this.st(id);
    s.stage = stage ?? s.stage + 1;
    const def = QUESTS.find((q) => q.id === id)!;
    if (s.stage < def.objectives.length) this.game.ui.questToast("Quest Updated", def.objectives[s.stage]);
  }
  complete(id: string): void {
    const s = this.st(id);
    s.status = "done";
    const def = QUESTS.find((q) => q.id === id)!;
    this.game.ui.questToast("Quest Complete", def.title);
    this.game.audio.sfx("questDone");
    if (this.tracked === id) this.tracked = "main";
    this.game.save.autosave("quest");
  }
  fail(id: string, why: string): void {
    const s = this.st(id);
    if (s.status !== "active" && s.status !== "inactive") return;
    s.status = "failed";
    const def = QUESTS.find((q) => q.id === id)!;
    this.game.ui.questToast("Quest Failed", `${def.title} — ${why}`);
    if (this.tracked === id) this.tracked = "main";
  }

  objective(id: string): string {
    const def = QUESTS.find((q) => q.id === id)!;
    const s = this.st(id);
    let t = def.objectives[Math.min(s.stage, def.objectives.length - 1)];
    if (id === "main" && s.stage === 1) t += ` (${this.game.inventory.shards().length}/5)`;
    if (id === "lanterns" && s.stage === 0) t += ` (${this.lanternsFound.size}/5)`;
    if (id === "chronicle") t += ` (${this.steleRead.size}/5)`;
    if (id === "herbs" && s.stage === 0) t += ` (${Math.min(5, this.game.inventory.count("mountain_herb"))}/5)`;
    return t;
  }

  /** World position of the current objective (for the map / compass). */
  objectivePos(id: string): Vector3 | null {
    const g = this.game;
    const s = this.st(id);
    const site = (sid: string) => {
      const q = g.world.sites.get(sid);
      return q ? new Vector3(q.x, q.y, q.z) : null;
    };
    const vil = (vid: string) => {
      const v = g.world.village(vid);
      return new Vector3(v.x, v.y, v.z);
    };
    switch (id) {
      case "main":
        if (s.stage === 0) return vil(HOME_VILLAGE);
        if (s.stage === 1) {
          const left = g.bosses.slots.find((b) => b.id !== "zorg" && !b.defeated);
          return left ? site(left.siteId) : null;
        }
        if (s.stage === 2 || s.stage === 3) return this.steleRead.has(4) || this.rumors.has("forge") ? site("forge") : null;
        return site("zorgcave");
      case "shepherd":
        return s.stage === 0 ? site("tristaina") : vil(HOME_VILLAGE);
      case "oldkings":
        return s.stage < 2 ? site("ruins_engolasters") : vil("andorra");
      case "canillo":
        return vil("canillo");
      case "lanterns":
        return s.stage === 1 ? site("meritxell") : null;
      case "herbs":
        return s.stage >= 1 || g.inventory.count("mountain_herb") >= 5 ? vil("encamp") : null;
      case "caravan":
        return s.stage === 0 ? (s.data.ambush ? new Vector3(s.data.ambush[0], 0, s.data.ambush[1]) : vil("santjulia")) : vil("santjulia");
    }
    return null;
  }

  // ------------------------------------------------------------------------------------ setup
  init(): void {
    const g = this.game;
    // NPC conversations
    for (const n of g.npcs.npcs) {
      g.interaction.add({
        id: "npc_" + n.id,
        pos: () => n.position,
        radius: 2.6,
        label: () => `Talk to ${n.name}`,
        enabled: () => !!n.rig && n.activity !== "sleep" && !n.inside,
        onInteract: () => void this.talk(n),
        priority: 1,
      });
    }
    // Waystones
    for (const v of g.world.villages) {
      g.interaction.add({
        id: "waystone_" + v.id, pos: () => v.waystone, radius: 3.2, label: () => "Touch the Waystone", onInteract: () => void this.waystone(v), priority: 0.5,
      });
      g.interaction.add({
        id: "board_" + v.id, pos: () => v.board, radius: 2.8, label: () => "Read the Quest Board", onInteract: () => void this.questBoard(v),
      });
      // glowing runes on waystones
      const rune = MeshBuilder.CreateTorus("rune", { diameter: 1.4, thickness: 0.06, tessellation: 24 }, g.scene);
      rune.material = glowMaterial(g.scene, "#5ad8ff", 1.6);
      rune.position.set(v.waystone.x, v.waystone.y + 2.6, v.waystone.z);
      g.glow.addIncludedOnlyMesh(rune);
      g.fx.addUpdater((dt) => {
        rune.rotation.y += dt * 0.8;
        rune.rotation.x = Math.sin(g.elapsed * 0.7) * 0.3;
        rune.setEnabled(!g.interiors.current);
        return true;
      });
      g.fx.emitter(new Vector3(v.waystone.x, v.waystone.y + 2.2, v.waystone.z), { rate: 6, color1: new Color4(0.4, 0.85, 1, 1), color2: new Color4(0.8, 1, 1, 0.8), size: [0.05, 0.15], life: [1.5, 3], speed: [0.2, 0.6], box: 0.6, capacity: 30, tex: "star" });
    }
    // Home village ward keeps the square breathable until the very end
    const home = g.world.homeVillage();
    g.poison.setSafeZone("ward_home", home.x, home.z, 75, 1);
    // Steles
    STELE_SITES.forEach((sid, i) => {
      const s = g.world.sites.get(sid);
      if (!s) return;
      const ang = hashString(sid) % 628 / 100;
      const r = sid === "tristaina" || sid === "engolasters" ? s.r + 10 : sid === "margineda" ? 9 : 12;
      const x = s.x + Math.sin(ang) * r, z = s.z + Math.cos(ang) * r;
      const spot = g.terrain.findFlatSpot(x, z, 20, 2, 4);
      const y = g.terrain.getHeight(spot.x, spot.z);
      const sb = new StructureBuilder(g.scene, spot.x, y, spot.z, yawTo(spot.x, spot.z, s.x, s.z) + Math.PI);
      buildStele(sb);
      sb.finish("stele" + i, g.physics);
      const glyph = MeshBuilder.CreatePlane("glyph", { width: 0.8, height: 1.6 }, g.scene);
      glyph.material = glowMaterial(g.scene, "#8fe6ff", 1.0);
      const a = sb.worldAnchor("runes");
      glyph.position.copyFrom(a);
      glyph.rotation.y = sb.yaw + Math.PI;
      g.glow.addIncludedOnlyMesh(glyph);
      g.interaction.add({ id: "stele" + i, pos: () => a, radius: 3, label: () => "Read the ancient stele", onInteract: () => void this.readStele(i) });
    });
    // Spirit lanterns
    for (const l of LANTERN_SPOTS) this.placeLantern(l);
    // Herbs
    const rng = new RNG(1234);
    for (let k = 0; k < 26; k++) {
      const v = g.world.villages[k % g.world.villages.length];
      const a = rng.next() * Math.PI * 2, d = rng.range(70, 180);
      const x = v.x + Math.sin(a) * d, z = v.z + Math.cos(a) * d;
      if (!g.terrain.inBounds(x, z) || g.terrain.getSlope(x, z) > 30 || g.world.excluded(x, z, 1)) continue;
      const y = g.terrain.getHeight(x, z);
      const id = "herb" + k;
      const herb = MeshBuilder.CreateIcoSphere("herb", { radius: 0.35, subdivisions: 1 }, g.scene);
      herb.material = glowMaterial(g.scene, "#7dff6a", 0.4);
      herb.position.set(x, y + 0.25, z);
      herb.scaling.y = 0.7;
      g.interaction.add({
        id, pos: () => herb.position, radius: 2.2, label: () => "Gather Mountain Herb",
        enabled: () => (this.herbTaken.get(id) ?? -1) < g.time.day,
        onInteract: () => {
          this.herbTaken.set(id, g.time.day);
          g.inventory.add("mountain_herb", 1);
          g.audio.sfx("pickup");
          g.player.playAction("pickup", 0.6);
        },
      });
      g.fx.addUpdater(() => {
        herb.setEnabled((this.herbTaken.get(id) ?? -1) < g.time.day && !g.interiors.current);
        return true;
      });
    }
    // Hidden forge: talk to the smith happens via the NPC. Cave entrances:
    for (const lvl of g.interiors.levels.values()) {
      const site = g.world.sites.get(lvl.def.siteId);
      if (!site) continue;
      if (lvl.def.id === "vault") continue;
      const mouth = site.anchors.mouth ?? new Vector3(site.x, site.y, site.z);
      g.interaction.add({ id: "enter_" + lvl.def.id, pos: () => mouth, radius: 4.5, label: () => `Enter ${lvl.def.name}`, onInteract: () => void g.interiors.enter(lvl.def.id), priority: 2 });
      g.interaction.add({ id: "exit_" + lvl.def.id, pos: () => lvl.exitPoint, radius: 4, label: () => "Leave the cave", interior: lvl.def.id, onInteract: () => void g.interiors.exit(), priority: 2 });
    }
    // Zorg's gate
    const zl = g.interiors.level("zorg_cave");
    g.interaction.add({
      id: "zorg_gate",
      pos: () => (zl.gateSeg ? new Vector3((zl.gateSeg.ax + zl.gateSeg.bx) / 2, zl.floorAt((zl.gateSeg.ax + zl.gateSeg.bx) / 2, (zl.gateSeg.az + zl.gateSeg.bz) / 2), (zl.gateSeg.az + zl.gateSeg.bz) / 2) : zl.entrance),
      radius: 5, interior: "zorg_cave", enabled: () => !zl.gateOpen,
      label: () => (g.inventory.has("rainbow_sword") ? "Cleave the dark barrier with the Rainbow Sword" : "A wall of darkness blocks the way"),
      onInteract: () => void this.zorgGate(),
      priority: 3,
    });
    // vault entrance (hidden lever handled by TreasureSystem) & vault exit
    const vault = g.interiors.level("vault");
    g.interaction.add({ id: "exit_vault", pos: () => vault.exitPoint, radius: 4, label: () => "Climb back to the ruins", interior: "vault", onInteract: () => void g.interiors.exit(), priority: 2 });

    g.events.on("shardCollected", () => this.onShard());
    g.events.on("campCleared", (c: any) => this.onCampCleared(c));
    g.events.on("enterInterior", (id: string) => {
      if (id === "zorg_cave" && this.st("main").stage === 4) this.advance("main", 5);
      if (id === "vault" && this.st("oldkings").status === "active" && this.st("oldkings").stage === 0) this.advance("oldkings", 1);
    });
    g.events.on("itemAdded", (e: any) => {
      if (e.id === "old_crown" && this.st("oldkings").status === "active") this.advance("oldkings", 2);
      if (e.id === "mountain_herb" && this.st("herbs").status === "active" && g.inventory.count("mountain_herb") >= 5 && this.st("herbs").stage === 0) this.advance("herbs", 1);
    });
    g.events.on("swordForged", () => {
      this.advance("main", 4);
      this.tracked = "main";
    });
  }

  newGame(): void {
    this.states.clear();
    this.st("main").status = "active";
    this.tracked = "main";
    this.steleRead.clear();
    this.lanternsFound.clear();
    this.rumors.clear();
    this.markers = [];
    this.herbTaken.clear();
    for (const [id, m] of this.lanternMeshes) m.setEnabled(true);
    void ITEMS;
  }

  private placeLantern(l: (typeof LANTERN_SPOTS)[number]): void {
    const g = this.game;
    let pos: Vector3;
    if (l.interior) {
      const lvl = g.interiors.level(l.interior);
      const p = lvl.roomPos(l.room ?? 1);
      pos = new Vector3(p.x + 3, lvl.floorAt(p.x + 3, p.z + 3), p.z + 3);
    } else if (l.site) {
      const s = g.world.sites.get(l.site);
      if (!s) return;
      const a = (hashString(l.id) % 628) / 100;
      const r = l.site === "margineda" ? 5 : s.r + 6;
      const x = s.x + Math.sin(a) * r, z = s.z + Math.cos(a) * r;
      pos = new Vector3(x, g.terrain.getHeight(x, z), z);
    } else {
      const p = geoToWorld(l.lat!, l.lon!);
      pos = new Vector3(p.x, g.terrain.getHeight(p.x, p.z), p.z);
    }
    const lantern = MeshBuilder.CreateCylinder("lantern", { height: 0.7, diameterTop: 0.3, diameterBottom: 0.45, tessellation: 6 }, g.scene);
    lantern.material = glowMaterial(g.scene, "#9fd8ff", 1.8);
    lantern.position.set(pos.x, pos.y + 1.2, pos.z);
    g.glow.addIncludedOnlyMesh(lantern);
    this.lanternMeshes.set(l.id, lantern);
    const ps = g.fx.emitter(lantern, { rate: 10, color1: new Color4(0.6, 0.85, 1, 1), color2: new Color4(1, 1, 1, 0.8), size: [0.05, 0.2], life: [1, 2], speed: [0.2, 0.6], box: 0.3, capacity: 30, tex: "star" });
    g.fx.addUpdater(() => {
      const show = !this.lanternsFound.has(l.id) && (g.interiors.current?.def.id ?? null) === (l.interior ?? null);
      lantern.setEnabled(show);
      ps.emitRate = show ? 10 : 0;
      lantern.position.y = pos.y + 1.2 + Math.sin(g.elapsed * 1.5) * 0.15;
      return true;
    });
    g.interaction.add({
      id: "lantern_" + l.id, pos: () => lantern.position, radius: 2.5, interior: l.interior ?? null, label: () => "Take the Spirit Lantern",
      enabled: () => !this.lanternsFound.has(l.id),
      onInteract: () => {
        this.lanternsFound.add(l.id);
        g.inventory.add("spirit_lantern", 1);
        g.audio.sfx("shardCollect");
        g.fx.burst(lantern.position, { count: 50, color1: new Color4(0.6, 0.85, 1, 1), size: [0.1, 0.4], speed: [2, 6], tex: "star" });
        if (this.st("lanterns").status === "inactive") this.start("lanterns");
        if (this.lanternsFound.size >= 5 && this.st("lanterns").stage === 0) this.advance("lanterns", 1);
        else g.ui.toast(`Spirit Lanterns: ${this.lanternsFound.size}/5`, "good");
      },
    });
  }

  // ------------------------------------------------------------------------------------ conversations
  private async talk(n: NPC): Promise<void> {
    const g = this.game;
    const d = g.dialogue;
    const prevAction = n.action;
    n.action = "talk";
    if (!n.fixed) n.yaw = yawTo(n.position.x, n.position.z, g.player.position.x, g.player.position.z);
    g.player.yaw = yawTo(g.player.position.x, g.player.position.z, n.position.x, n.position.z);
    await d.run(async () => {
      if (n.special === "swordmaker") return await this.swordmaker(n);
      if (n.special === "pere") return await this.pere(n);
      if (n.role === "elder" && n.village.id === HOME_VILLAGE) return await this.elder(n);
      if (n.special === "nuria") return await this.nuria(n);
      if (n.special === "captain") return await this.captain(n);
      if (n.special === "laia") return await this.laia(n);
      if (n.special === "pau") return await this.pau(n);
      if (n.role === "historian") return await this.historian(n);
      if (n.role === "healer") return await this.healer(n);
      await this.generic(n);
    });
    n.action = prevAction;
  }

  private cloudInfo(v: Village): string {
    const g = this.game;
    const days = g.poison.daysUntilCovered(v.x, v.z);
    if (v.id === HOME_VILLAGE && g.time.daysElapsed > 8) return "The waystone's ward still keeps the cloud from our square. Everyone who could flee has come here.";
    if (days <= 0) return "The cloud is upon us. We must leave!";
    if (days < 1) return "The cloud will be here before tomorrow. We're leaving.";
    if (days < 3) return `The cloud will reach ${v.name} in about ${Math.round(days * 24)} hours.`;
    if (days < 6) return `At this pace the cloud will reach us in ${Math.round(days)} days.`;
    return "The cloud is still far from here, thank the mountains.";
  }

  private async generic(n: NPC): Promise<void> {
    const g = this.game;
    const d = g.dialogue;
    const lines = g.npcs.linesFor(n);
    const line = lines[(Math.floor(g.time.minutes / 30) + n.seed) % lines.length];
    await d.say(n.name, line);
    const choices: string[] = [];
    const shop = this.shopFor(n);
    if (shop) choices.push("Trade");
    if (n.role === "innkeeper") choices.push("Rent a room");
    if (n.role === "smith" && !n.fixed) choices.push("Sharpen my blade");
    choices.push("Any news?", "Goodbye");
    for (;;) {
      const c = await d.ask(n.name, "What can I do for you?", choices);
      const label = choices[c];
      if (label === "Goodbye") return;
      if (label === "Trade") {
        d.close();
        await g.ui.openShop(n.name, shop!, true);
        return;
      }
      if (label === "Rent a room") {
        await this.inn(n);
        return;
      }
      if (label === "Sharpen my blade") await this.sharpen(n);
      if (label === "Any news?") {
        await d.say(n.name, [this.cloudInfo(n.current), this.rumor(n)]);
      }
    }
  }

  private shopFor(n: NPC): [string, number][] | null {
    const g = this.game;
    if (n.fixed) return null;
    const st = n.current.state;
    if (!["merchant", "smith", "healer", "innkeeper"].includes(n.role)) return null;
    if ((st === "evacuating" || st === "abandoned") && n.role === "merchant") return null;
    const base = SHOPS[n.role];
    const mult = g.time.day >= 5 ? 1.3 : 1; // fear raises prices
    return base.map(([id, p]) => [id, Math.round(p * mult)] as [string, number]);
  }

  private rumor(n: NPC): string {
    const g = this.game;
    const r = new RNG(n.seed + g.time.day);
    const notDefeated = g.bosses.slots.filter((s) => s.id !== "zorg" && !s.defeated);
    const pool: [string, string][] = [];
    const bossHints: Record<string, string> = {
      boss_flame: "Shepherds near Sant Julià see smoke rising from a cave on the Pic Negre, to the south. Something huge breathes fire in there.",
      boss_forest: "The ancient trees of the Madriu valley have begun to move. They say a guardian of wood and moss walks there.",
      boss_frost: "High on the Pic de l'Estanyó, in the north, there's a cave of ice. Hunters hear a dragon roaring inside.",
      boss_shadow: "The old fortress of Enclar, west of the capital, is haunted by a knight with eyes like white stars.",
      boss_thunder: "Lightning strikes the summit of the Pessons every night, even when the sky is clear. A titan of stone lives there.",
    };
    for (const s of notDefeated) pool.push([s.siteId, bossHints[s.siteId]]);
    pool.push(["waterfall", "There's a waterfall near Ransol, above Canillo. Children say something glitters behind the water."]);
    pool.push(["cave_hidden1", "Smugglers used a grotto in the hills west of Sant Julià. They never came back for their loot."]);
    pool.push(["cave_hidden2", "Up on the plateau east of Encamp there's a hollow full of glowing crystals."]);
    if (g.inventory.shards().length >= 5) pool.unshift(["forge", "If you seek the sword maker... look for smoke above the clouds on the shoulder of Casamanya."]);
    const [sid, text] = pool[Math.floor(r.next() * Math.min(pool.length, g.inventory.shards().length >= 5 ? 1 : pool.length))];
    this.rumors.add(sid);
    return text;
  }

  private async inn(n: NPC): Promise<void> {
    const g = this.game;
    const d = g.dialogue;
    const free = n.village.id === HOME_VILLAGE;
    const cost = free ? 0 : 20;
    const c = await d.ask(n.name, free ? "Your room is always ready, friend. How long will you rest?" : `A room is ${cost} coins. How long will you rest?`, ["Until morning", "Until evening", "For 3 hours", "Never mind"]);
    if (c === 3) return;
    if (!free && !g.inventory.spend(cost)) {
      await d.say(n.name, "You don't have enough coins, I'm afraid.");
      return;
    }
    d.close();
    const h = g.time.hour;
    const until = c === 0 ? 6 : c === 1 ? 18 : (h + 3) % 24;
    let mins = ((until - h + 24) % 24) * 60;
    if (mins < 30) mins += 1440;
    await this.sleep(mins);
  }

  async sleep(minutes: number): Promise<void> {
    const g = this.game;
    g.state = "cinematic";
    await g.ui.fade(1, 0.8);
    g.ui.centerText("You rest… the cloud keeps moving.", 1.8);
    g.time.advance(minutes);
    g.player.hp = g.player.maxHp;
    g.player.stamina = g.player.maxStamina;
    await new Promise((r) => setTimeout(r, 1800));
    g.evolution.refreshNow();
    g.state = "playing";
    await g.ui.fade(0, 0.8);
    g.save.autosave("sleep");
  }

  private async sharpen(n: NPC): Promise<void> {
    const g = this.game;
    const d = g.dialogue;
    const w = g.inventory.equipped.weapon;
    const lvl = g.inventory.upgrades[w] ?? 0;
    if (w === "rainbow_sword") return await d.say(n.name, "That blade... no hammer of mine should touch it.");
    if (lvl >= 3) return await d.say(n.name, "Your blade is as sharp as steel can be.");
    const ore = lvl < 2 ? "iron_ore" : "ancient_ore";
    const oreN = 2;
    const coins = 60 + lvl * 60;
    const c = await d.ask(n.name, `I can sharpen your ${item(w).name} (+15% damage) for ${coins} coins and ${oreN} ${item(ore).name}.`, ["Do it", "Not now"]);
    if (c !== 0) return;
    if (g.inventory.count(ore) < oreN || g.inventory.coins < coins) return await d.say(n.name, "Bring me the materials and the coin, and I'll get to work.");
    g.inventory.remove(ore, oreN);
    g.inventory.spend(coins);
    g.inventory.upgrades[w] = lvl + 1;
    g.audio.sfx("anvil");
    await d.say(n.name, `There! Your blade is now +${lvl + 1}.`);
  }

  private async elder(n: NPC): Promise<void> {
    const g = this.game;
    const d = g.dialogue;
    const main = this.st("main");
    if (main.stage === 0) {
      await d.say(n.name, [
        "Ah, you're awake at last. Look to the horizon, child — do you see it? That purple-green wall, creeping over the borders?",
        "It is Zorg's poison. The Lord of the Dark Side has returned to his cave beneath Comapedrosa, and he means to swallow all of Andorra.",
        "The old songs say we have fourteen days. Fourteen days before the cloud covers every valley, every village, every soul.",
        "Long ago, five guardians hid five magical shards across our mountains: Fire, Nature, Ice, Light and Lightning. Each is guarded by a terrible beast.",
        "Defeat the guardians. Claim the shards. Then find the legendary sword maker, who alone knows how to forge them into the Rainbow Sword.",
        "Only that blade can end Zorg forever. Go — and may the mountains protect you.",
      ]);
      this.advance("main", 1);
      for (const s of g.bosses.slots) this.rumors.add(s.siteId);
      g.ui.toast("The five guardian lairs are marked on your map (M)", "info");
      if (this.st("chronicle").status === "inactive") {
        await d.say(n.name, "One more thing: ancient steles stand across Andorra. They tell the history of the shards — and where the sword maker hides.");
        this.start("chronicle");
      }
      return;
    }
    const shards = g.inventory.shards().length;
    if (main.stage === 1) await d.say(n.name, [`You carry ${shards} of the five shards. ${shards >= 3 ? "The light in your eyes grows stronger." : "Hurry — the cloud waits for no one."}`, this.cloudInfo(n.current)]);
    else if (main.stage <= 3) await d.say(n.name, "All five shards! Now find the sword maker. The last stele speaks of smoke rising from stone on the shoulder of Casamanya.");
    else if (main.stage <= 5) await d.say(n.name, "The Rainbow Sword! Go, child. Comapedrosa awaits. End this.");
    else await d.say(n.name, "You did it. Andorra is saved. I can rest now.");
    if (this.st("chronicle").status === "active" && this.steleRead.size >= 5) {
      await d.say(n.name, "You've read all five steles! Take this Heart Crystal — the old ones would want you to have it.");
      g.inventory.add("heart_crystal", 1);
      this.complete("chronicle");
    }
  }

  private async nuria(n: NPC): Promise<void> {
    const g = this.game;
    const d = g.dialogue;
    const q = this.st("shepherd");
    if (q.status === "inactive") {
      if (g.time.day > 9) return this.generic(n);
      await d.say(n.name, ["Please, you have to help me! My brother Pere took the flock up to the Tristaina Lakes three days ago, and he hasn't come back.", "With the cloud coming and the wolves so bold... I'm so afraid for him."]);
      const c = await d.ask(n.name, "Will you find him?", ["I'll find Pere", "Not now"]);
      if (c === 0) {
        this.start("shepherd");
        this.spawnPere();
        this.rumors.add("tristaina");
        await d.say(n.name, "Thank you! The Tristaina Lakes are far to the north, past El Serrat. Please hurry!");
      }
      return;
    }
    if (q.status === "active" && q.stage === 1) {
      await d.say(n.name, ["Pere is home! He told me how you fought off the wolves. I don't know how to thank you...", "Take this. It's not much, but it's yours."]);
      g.inventory.addCoins(120);
      g.inventory.add("hat_hood", 1);
      this.complete("shepherd");
      return;
    }
    if (q.status === "active") return await d.say(n.name, "Please, find Pere! He's at the Tristaina Lakes in the north.");
    await this.generic(n);
  }

  private spawnPere(): void {
    const g = this.game;
    if (g.npcs.byId("pere")) return;
    const s = g.world.site("tristaina");
    const x = s.x + s.r + 8, z = s.z;
    const pos = new Vector3(x, g.terrain.getHeight(x, z), z);
    const look = { skin: "#e0b890", hair: "#4a2f1c", top: "#3a5a8a", bottom: "#4a3a2a", boots: "#3a2a1a", hairStyle: "short" as const, hat: "hood" as const, hatColor: "#2a4a7a" };
    const n = g.npcs.fixedNPC("pere", "Pere the Shepherd", "farmer", false, g.world.village(HOME_VILLAGE), pos, 0, look);
    n.fixed!.action = "cower";
    g.npcs.npcs.push(n);
    g.interaction.add({ id: "npc_pere", pos: () => n.position, radius: 2.6, label: () => `Talk to ${n.name}`, enabled: () => !!n.rig && !n.hidden, onInteract: () => void this.talk(n), priority: 1 });
  }

  private async pere(n: NPC): Promise<void> {
    const g = this.game;
    const d = g.dialogue;
    const wolves = g.enemies.camps.find((c) => c.id === "wolves_tristaina");
    const wolvesAlive = wolves && wolves.enemies.some((e) => e.alive);
    if (wolvesAlive) return await d.say(n.name, "W-wolves! They've had me cornered for days! Please, drive them off!");
    await d.say(n.name, ["You... you saved me! Núria sent you? Bless her.", "I'll head home to Ordino right away. The flock is lost, but I'm alive thanks to you."]);
    n.hidden = true;
    if (this.st("shepherd").status === "active") this.advance("shepherd", 1);
  }

  private async captain(n: NPC): Promise<void> {
    const g = this.game;
    const d = g.dialogue;
    const q = this.st("canillo");
    if (q.status === "inactive") {
      if (g.time.day < 2 || g.time.day > 8) return this.generic(n);
      await d.say(n.name, ["Hero! Our scouts report a goblin warband gathering in the hills, drawn by the darkness.", "My guards can't hold them alone. Will you stand with Canillo?"]);
      const c = await d.ask(n.name, "They attack as soon as we're ready. Will you help?", ["Canillo will not fall", "Not yet"]);
      if (c === 0) {
        this.start("canillo");
        d.close();
        this.startRaid();
      }
      return;
    }
    if (q.status === "active") return await d.say(n.name, "Hold the line! Defeat every last one of them!");
    if (q.status === "done") return await d.say(n.name, "Canillo owes you everything. The watch will remember your name.");
    await this.generic(n);
  }

  private startRaid(): void {
    const g = this.game;
    this.raid = { wave: 0, enemies: [], t: 3 };
    g.ui.bigTitle("THE RAID BEGINS", "Defend Canillo!", "#ff6a4a");
    g.audio.setMusic("battle");
  }

  private updateRaid(dt: number): void {
    const g = this.game;
    const r = this.raid;
    if (!r) return;
    r.t -= dt;
    const alive = r.enemies.filter((e) => e.alive).length;
    if (r.t <= 0 && alive === 0) {
      if (r.wave >= 3) {
        this.raid = null;
        const v = g.world.village("canillo");
        v.saved = true;
        this.complete("canillo");
        g.ui.bigTitle("CANILLO IS SAFE", "The raiders have been routed", "#7dff8a");
        g.inventory.add("chainmail", 1);
        g.inventory.addCoins(150);
        g.audio.setMusic("village");
        return;
      }
      r.wave++;
      r.t = 2;
      const v = g.world.village("canillo");
      const waves: [any, number, number][][] = [[["goblin", 4, 1]], [["goblin", 3, 2], ["shaman", 2, 1]], [["skeleton", 2, 2], ["goblin", 3, 2], ["darkknight", 1, 1]]];
      const rng = new RNG(r.wave * 77);
      for (const [kind, count, lvl] of waves[r.wave - 1]) {
        for (let k = 0; k < count; k++) {
          const e = v.entrances.length ? rng.pick(v.entrances) : { x: v.x + 40, z: v.z };
          const out = new Vector3(e.x + (e.x - v.x) * 0.4 + rng.range(-4, 4), 0, e.z + (e.z - v.z) * 0.4 + rng.range(-4, 4));
          out.y = g.physics.groundHeight(out.x, out.z, 1e5);
          r.enemies.push(g.enemies.spawn(kind, out, null, lvl, true));
        }
      }
      g.ui.toast(`Wave ${r.wave} of 3!`, "warn");
    }
  }

  private async laia(n: NPC): Promise<void> {
    const g = this.game;
    const d = g.dialogue;
    const q = this.st("lanterns");
    if (q.status === "inactive") {
      await d.say(n.name, ["Shh... can you hear them? The spirits of the ancients are restless.", "Five Spirit Lanterns hold their light. They are hidden across Andorra: on a high peak, by northern lakes, in a crystal hollow, beneath an old bridge...", "Bring them to me before the darkness snuffs them out, and I will give you the light of the ancients."]);
      this.start("lanterns");
      return;
    }
    if (q.status === "active" && this.lanternsFound.size >= 5) {
      await d.say(n.name, ["All five! The spirits sing... Take this Lantern of Purity. Its light will soften the cloud's bite.", "And this vessel of the ancients, to give you breath for the climb ahead."]);
      g.inventory.remove("spirit_lantern", 5);
      g.inventory.add("lantern_purity", 1);
      g.inventory.add("stamina_vessel", 1);
      this.complete("lanterns");
      return;
    }
    if (q.status === "active") return await d.say(n.name, `You have found ${this.lanternsFound.size} of the five lanterns. Seek the rest — peaks, lakes, crystals, bridges...`);
    await d.say(n.name, "The spirits thank you, child of the valleys.");
  }

  private async pau(n: NPC): Promise<void> {
    const g = this.game;
    const d = g.dialogue;
    const q = this.st("caravan");
    if (q.status === "inactive") {
      if (g.time.day < 4 || g.time.day > 10) return this.generic(n);
      await d.say(n.name, ["My family has to leave Sant Julià before the cloud arrives. But goblins are waiting in ambush on the road north.", "Please, clear the road so we can reach the capital safely."]);
      const c = await d.ask(n.name, "Will you help us?", ["I'll clear the road", "Not now"]);
      if (c === 0) {
        this.start("caravan");
        // place the ambush on the road north of Sant Julià
        const road = g.world.roads.find((r) => r.kind === "road" && r.pts.length > 40 && Math.hypot(r.pts[0].x - g.world.village("andorra").x, r.pts[0].z - g.world.village("andorra").z) < 30 && Math.hypot(r.pts[r.pts.length - 1].x - g.world.village("santjulia").x, r.pts[r.pts.length - 1].z - g.world.village("santjulia").z) < 30);
        const pts = road?.pts ?? [];
        const mid = pts.length ? pts[Math.floor(pts.length * 0.55)] : { x: n.position.x + 80, z: n.position.z + 80 };
        q.data.ambush = [mid.x, mid.z];
        g.enemies.camps.push({ id: "ambush", name: "Goblin ambush", x: mid.x, z: mid.z, interior: null, spawns: [{ kind: "goblin", count: 4, level: 2 }, { kind: "shaman", count: 1, level: 2 }], radius: 8, enemies: [], active: false, respawnAt: 0, minDay: 0, maxDay: 99, cleared: false });
      }
      return;
    }
    if (q.status === "active" && q.stage === 1) {
      await d.say(n.name, ["The road is clear? Then we leave at once! Thank you, hero.", "Here — my grandfather's cape. May it bring you luck."]);
      g.inventory.addCoins(150);
      g.inventory.add("cape_crimson", 1);
      this.complete("caravan");
      n.evacuated = true;
      n.current = g.world.homeVillage();
      return;
    }
    if (q.status === "active") return await d.say(n.name, "The ambush is on the road north, toward the capital. Please hurry!");
    await this.generic(n);
  }

  private async historian(n: NPC): Promise<void> {
    const g = this.game;
    const d = g.dialogue;
    const q = this.st("oldkings");
    if (q.status === "inactive") {
      await d.say(n.name, ["The Old Kings of Andorra hid their crown in a vault beneath the ruins near Lake Engolasters.", "Legend says the entrance is hidden behind a stone marked with the sign of the sun. Find it, and bring me the crown before the cloud buries history itself!"]);
      this.start("oldkings");
      this.rumors.add("ruins_engolasters");
      return;
    }
    if (q.status === "active" && q.stage === 2 && g.inventory.has("old_crown")) {
      await d.say(n.name, ["The Crown of the Old Kings! You found it! History is saved!", "Take this blade — it belonged to the last captain of the Valley Watch. It deserves a hero's hand."]);
      g.inventory.remove("old_crown", 1);
      g.inventory.add("knight_blade", 1);
      g.inventory.addCoins(200);
      this.complete("oldkings");
      return;
    }
    if (q.status === "active") return await d.say(n.name, "Look for the stone with the sign of the sun among the ruins by Lake Engolasters.");
    await this.generic(n);
  }

  private async healer(n: NPC): Promise<void> {
    const g = this.game;
    const d = g.dialogue;
    const q = this.st("herbs");
    if (q.status === "inactive" && g.time.day < 12) {
      await d.say(n.name, ["So many sick from the cloud... and I've run out of mountain herbs.", "Could you gather five Mountain Herbs for me? They glow faintly in the meadows around the villages."]);
      this.start("herbs");
      return;
    }
    if (q.status === "active" && g.inventory.count("mountain_herb") >= 5) {
      await d.say(n.name, ["Five herbs! Bless you. Take these — you'll need them more than anyone."]);
      g.inventory.remove("mountain_herb", 5);
      g.inventory.add("purity_tonic", 2);
      g.inventory.add("greater_potion", 1);
      this.complete("herbs");
      return;
    }
    await this.generic(n);
  }

  private async swordmaker(n: NPC): Promise<void> {
    const g = this.game;
    const d = g.dialogue;
    const shards = g.inventory.shards().length;
    const main = this.st("main");
    if (g.inventory.has("rainbow_sword")) return await d.say(n.name, "Go. Comapedrosa. Strike true, and let the colours of Andorra shine again.");
    if (shards < 5) {
      await d.say(n.name, ["So... someone found my forge. Few have climbed this high in three hundred years.", `You carry ${shards} shard${shards === 1 ? "" : "s"}. The ancient blade needs all five. Come back when you hold them all — if there's still an Andorra to come back to.`]);
      this.rumors.add("forge");
      return;
    }
    if (main.stage < 3) this.advance("main", 3);
    await d.say(n.name, ["The five shards... Fire, Nature, Ice, Light and Lightning. I have waited three centuries for this moment.", "Give them to me, and watch."]);
    d.close();
    await g.magic.forgeSword();
  }

  private async zorgGate(): Promise<void> {
    const g = this.game;
    const lvl = g.interiors.level("zorg_cave");
    if (!g.inventory.has("rainbow_sword")) {
      await g.dialogue.run(async () => {
        await g.dialogue.say("", "A wall of living darkness blocks the way. Your blade passes through it like smoke. Only a weapon of pure light could cleave it.", "#c0a0ff");
      });
      return;
    }
    g.player.playAction("attack3", 0.8);
    g.audio.sfx("rainbowSlash");
    g.fx.burst(g.player.position.add(new Vector3(0, 1.5, 2)), { count: 120, color1: new Color4(1, 0.3, 0.3, 1), color2: new Color4(0.3, 0.6, 1, 1), size: [0.2, 0.8], speed: [5, 14], tex: "star" });
    g.ui.screenFlash(0.6, "#ffffff");
    lvl.openGate();
    g.ui.toast("The darkness parts before the Rainbow Sword!", "good");
  }

  private async waystone(v: Village): Promise<void> {
    const g = this.game;
    const d = g.dialogue;
    this.game.discovered.add("waystone_" + v.id);
    await d.run(async () => {
      const opts = ["Save the game", "Travel to another waystone", "Leave"];
      const c = await d.ask("Waystone of " + v.name, "The ancient stone hums. Your wounds feel lighter.", opts, "#5ad8ff");
      g.player.heal(Math.max(0, Math.min(25, g.player.maxHp - g.player.hp)));
      if (c === 0) {
        d.close();
        g.ui.openSaveMenu();
      } else if (c === 1) {
        const dests = g.world.villages.filter((w) => w !== v && g.discovered.has("waystone_" + w.id));
        if (!dests.length) return await d.say("Waystone", "You have not touched any other waystone yet.", "#5ad8ff");
        const labels = dests.map((w) => {
          const dist = Math.hypot(w.x - v.x, w.z - v.z);
          const hours = Math.max(1, Math.round(dist / 450));
          return `${w.name} (${hours}h)`;
        });
        labels.push("Cancel");
        const k = await d.ask("Waystone", "Where will the old roads take you? Travel takes time — and the cloud keeps moving.", labels, "#5ad8ff");
        if (k < dests.length) {
          const w = dests[k];
          const hours = Math.max(1, Math.round(Math.hypot(w.x - v.x, w.z - v.z) / 450));
          d.close();
          g.state = "cinematic";
          await g.ui.fade(1, 0.6);
          g.time.advance(hours * 60);
          g.player.teleport(w.waystone.x + 2, w.waystone.y, w.waystone.z + 2, 0);
          g.evolution.refreshNow();
          g.state = "playing";
          await g.ui.fade(0, 0.6);
          g.ui.toast(`Arrived at ${w.name} — ${hours} hour${hours > 1 ? "s" : ""} passed`, "info");
        }
      }
    });
  }

  private async questBoard(v: Village): Promise<void> {
    const g = this.game;
    const notes: string[] = [];
    const add = (id: string, text: string) => {
      if (this.st(id).status === "inactive") notes.push(text);
    };
    add("shepherd", "MISSING: Pere the shepherd, last seen at the Tristaina Lakes. Ask Núria in Ordino.");
    add("oldkings", "The historian Oriol in Andorra la Vella seeks a brave explorer for the ruins of Engolasters.");
    if (g.time.day >= 2 && g.time.day <= 8) add("canillo", "CALL TO ARMS: Captain Marc of Canillo needs fighters against the goblin warband.");
    add("lanterns", "Strange lights seen near the Sanctuary of Meritxell. A mystic asks for help.");
    add("herbs", "Healer Roser of Encamp pays well for Mountain Herbs.");
    if (g.time.day >= 4 && g.time.day <= 10) add("caravan", "Pau of Sant Julià needs the road north cleared for his family's escape.");
    notes.push(`NOTICE: The poison cloud advances. ${this.cloudInfo(v)}`);
    if (g.time.day >= 5) notes.push("EVACUATION ORDER: Refugees are to gather in Ordino, where the old waystone ward still holds.");
    await g.dialogue.run(async () => {
      await g.dialogue.say("Quest Board — " + v.name, notes.slice(0, 4), "#d8c08a");
    });
  }

  private async readStele(i: number): Promise<void> {
    const g = this.game;
    const first = !this.steleRead.has(i);
    this.steleRead.add(i);
    await g.dialogue.run(async () => {
      await g.dialogue.say("Ancient Stele", STELE_TEXT[i], "#8fe6ff");
    });
    if (first) {
      g.audio.sfx("lore");
      if (i === 4) this.rumors.add("forge");
      if (i >= 1 && i <= 3) {
        const ids = [["boss_flame", "boss_forest"], ["boss_frost", "boss_shadow"], ["boss_thunder"]][i - 1];
        for (const id of ids) this.rumors.add(id);
      }
      if (this.st("chronicle").status === "inactive") this.start("chronicle");
      if (this.steleRead.size >= 5) g.ui.toast("All steles read — return to Elder Joan in Ordino", "good");
      else g.ui.toast(`Steles read: ${this.steleRead.size}/5`, "info");
    }
  }

  private onShard(): void {
    const g = this.game;
    const n = g.inventory.shards().length;
    const main = this.st("main");
    if (main.stage < 1) this.advance("main", 1);
    if (n >= 5 && main.stage === 1) this.advance("main", 2);
    else g.ui.questToast("The Shadow over Andorra", `Shards: ${n}/5`);
  }

  private onCampCleared(c: any): void {
    const q = this.st("caravan");
    if (c.id === "ambush" && q.status === "active" && q.stage === 0) this.advance("caravan", 1);
  }

  // ------------------------------------------------------------------------------------ update
  update(dt: number): void {
    const g = this.game;
    this.updateRaid(dt);
    this.discoverT -= dt;
    if (this.discoverT <= 0 && !g.interiors.current && g.state === "playing") {
      this.discoverT = 1;
      const p = g.player.position;
      for (const v of g.world.villages) {
        if (!g.discovered.has(v.id) && Math.hypot(v.x - p.x, v.z - p.z) < 70) {
          g.discovered.add(v.id);
          g.ui.locationTitle(v.name, v.def.description);
        }
      }
      for (const s of g.world.sites.values()) {
        if (g.discovered.has(s.id)) continue;
        const r = s.kind === "peak" ? 40 : Math.max(45, s.r + 25);
        if (Math.hypot(s.x - p.x, s.z - p.z) < r) {
          g.discovered.add(s.id);
          if (s.kind !== "peak" || Math.abs(p.y - s.y) < 30) g.ui.locationTitle(s.name, s.kind === "peak" ? "Summit reached" : "");
          else g.discovered.delete(s.id);
        }
      }
    }
    // time-limited quests
    if (g.time.day > 9) {
      if (this.st("shepherd").status === "active" && this.st("shepherd").stage === 0) this.fail("shepherd", "Pere found his own way to the refuge, badly wounded.");
      if (this.st("canillo").status === "inactive" || (this.st("canillo").status === "active" && !this.raid)) {
        if (this.st("canillo").status === "active") this.fail("canillo", "Canillo fell to the raiders.");
        else this.st("canillo").status = "failed";
      }
    }
    if (g.time.day > 10 && this.st("caravan").status === "active") this.fail("caravan", "The family fled without you.");
  }

  serialize() {
    return {
      states: [...this.states.entries()], tracked: this.tracked, steles: [...this.steleRead], lanterns: [...this.lanternsFound],
      rumors: [...this.rumors], markers: this.markers, herbs: [...this.herbTaken.entries()], raidDone: !this.raid,
    };
  }
  deserialize(d: any) {
    if (!d) return;
    this.states = new Map(d.states ?? []);
    this.tracked = d.tracked ?? "main";
    this.steleRead = new Set(d.steles ?? []);
    this.lanternsFound = new Set(d.lanterns ?? []);
    this.rumors = new Set(d.rumors ?? []);
    this.markers = d.markers ?? [];
    this.herbTaken = new Map(d.herbs ?? []);
    this.raid = null;
    if (this.st("canillo").status === "active") this.st("canillo").status = "inactive";
    if (this.st("shepherd").status === "active" && this.st("shepherd").stage === 0) this.spawnPere();
    const pere = this.game.npcs.byId("pere");
    if (pere && this.st("shepherd").stage >= 1) pere.hidden = true;
    if (this.st("caravan").status === "active" && this.st("caravan").stage === 0 && !this.game.enemies.camps.find((c) => c.id === "ambush")) {
      const a = this.st("caravan").data.ambush;
      if (a) this.game.enemies.camps.push({ id: "ambush", name: "Goblin ambush", x: a[0], z: a[1], interior: null, spawns: [{ kind: "goblin", count: 4, level: 2 }, { kind: "shaman", count: 1, level: 2 }], radius: 8, enemies: [], active: false, respawnAt: 0, minDay: 0, maxDay: 99, cleared: false });
    }
    void PointLight;
    void StandardMaterial;
    void Color3;
  }
}
