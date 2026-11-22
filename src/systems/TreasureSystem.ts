import { Vector3, TransformNode, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, DynamicTexture, PointLight } from "@babylonjs/core";
import type { Game } from "../core/Game";
import { PartBuilder, glowMaterial } from "../entities/CharacterKit";
import { Rarity, RARITY_COLOR, item } from "../data/items";
import { geoToWorld } from "../world/AndorraData";
import { RNG, hashString, easeOutBack, easeInOut } from "../core/MathUtil";
import { StructureBuilder, buildStandingStones } from "../world/Buildings";

type Puzzle = "none" | "runes" | "braziers" | "night" | "camp" | "dig" | "abandoned";

interface ChestDef {
  id: string;
  rarity: Rarity;
  contents: [string, number][];
  coins?: number;
  site?: string;
  anchor?: string;
  offset?: [number, number];
  lat?: number;
  lon?: number;
  interior?: string;
  room?: number;
  village?: string;
  puzzle?: Puzzle;
  camp?: string;
  clue?: boolean;
}

interface Chest {
  def: ChestDef;
  pos: Vector3;
  yaw: number;
  root: TransformNode;
  lid: TransformNode;
  opened: boolean;
  locked: boolean;
  visible: boolean;
  seal: Mesh | null;
  interior: string | null;
  buried: boolean;
}

const CHESTS: ChestDef[] = [
  { id: "c_waterfall", rarity: "epic", site: "waterfall", anchor: "alcove", contents: [["ancient_ore", 2], ["star_fragment", 1], ["cape_royal", 1]], coins: 120 },
  { id: "c_peak_casamanya", rarity: "rare", site: "peak_casamanya", offset: [3, 2], contents: [["stamina_vessel", 1]], coins: 40, clue: true },
  { id: "c_peak_comapedrosa", rarity: "epic", site: "peak_comapedrosa", offset: [2, 3], contents: [["heart_crystal", 1]], coins: 100, clue: true },
  { id: "c_peak_estanyo", rarity: "rare", site: "peak_estanyo", offset: [-3, 2], contents: [["purity_tonic", 2], ["stamina_vessel", 1]], clue: true },
  { id: "c_peak_serrera", rarity: "rare", site: "peak_serrera", offset: [2, -3], contents: [["star_fragment", 1]], coins: 80, clue: true },
  { id: "c_peak_medecourbe", rarity: "epic", site: "peak_medecourbe", offset: [2, 2], contents: [["cape_night", 1], ["elixir", 1]], clue: true },
  { id: "c_peak_picnegre", rarity: "rare", site: "peak_picnegre", offset: [2, 2], contents: [["heart_crystal", 1]], clue: true },
  { id: "c_ruins_runes", rarity: "epic", site: "ruins_engolasters", offset: [14, 4], contents: [["ancient_ore", 2], ["ring_vigor", 1]], puzzle: "runes" },
  { id: "c_ruins_braziers", rarity: "rare", site: "ruins_incles", offset: [0, -2], contents: [["amulet_swiftness", 1]], coins: 60, puzzle: "braziers" },
  { id: "c_tower", rarity: "rare", site: "ruins_coll", offset: [0, 4.5], contents: [["steel_longsword", 1]] },
  { id: "c_night", rarity: "epic", lat: 42.5640, lon: 1.5580, contents: [["ember_saber", 1]], coins: 80, puzzle: "night" },
  { id: "c_fortress", rarity: "rare", site: "boss_shadow", offset: [0, 40], contents: [["greater_potion", 2]], coins: 150, puzzle: "camp", camp: "skel_fortress" },
  { id: "c_camp_coll", rarity: "common", contents: [["health_potion", 2], ["iron_ore", 2]], coins: 40, puzzle: "camp", camp: "camp_coll" },
  { id: "c_camp_massana", rarity: "common", contents: [["health_potion", 1], ["purity_tonic", 1]], coins: 50, puzzle: "camp", camp: "camp_massana" },
  { id: "c_camp_encamp", rarity: "common", contents: [["iron_ore", 2], ["stamina_tonic", 2]], coins: 45, puzzle: "camp", camp: "camp_encamp" },
  { id: "c_camp_santjulia", rarity: "rare", contents: [["leather_tunic", 1], ["health_potion", 2]], coins: 60, puzzle: "camp", camp: "camp_santjulia" },
  { id: "c_camp_soldeu", rarity: "rare", contents: [["ancient_ore", 1], ["greater_potion", 1]], coins: 80, puzzle: "camp", camp: "camp_soldeu" },
  { id: "c_camp_pas", rarity: "rare", contents: [["purity_tonic", 2], ["iron_ore", 3]], coins: 100, puzzle: "camp", camp: "camp_pas" },
  { id: "c_dig1", rarity: "rare", lat: 42.5310, lon: 1.5480, contents: [["charm_fortune", 1]], coins: 150, puzzle: "dig", clue: true },
  { id: "c_dig2", rarity: "rare", lat: 42.5900, lon: 1.6220, contents: [["ancient_ore", 2]], coins: 90, puzzle: "dig", clue: true },
  { id: "c_dig3", rarity: "epic", lat: 42.4820, lon: 1.5600, contents: [["star_fragment", 1], ["greater_potion", 2]], coins: 120, puzzle: "dig", clue: true },
  { id: "c_tristaina", rarity: "common", site: "tristaina", offset: [-8, 0], contents: [["health_potion", 2], ["cape_forest", 1]] },
  { id: "c_juclar", rarity: "rare", site: "juclar", offset: [-8, 3], contents: [["greater_potion", 1], ["stamina_vessel", 1]] },
  { id: "c_engolasters", rarity: "common", site: "engolasters", offset: [8, 0], contents: [["cheese", 2], ["purity_tonic", 1]], coins: 30 },
  { id: "c_grove", rarity: "epic", site: "boss_forest", offset: [0, 18], contents: [["elixir", 1], ["heart_crystal", 1]] },
  // caves
  { id: "c_flame", rarity: "rare", interior: "flame_cave", room: 2, contents: [["ember_saber", 1], ["crystal_shard", 2]] },
  { id: "c_frost", rarity: "rare", interior: "frost_cave", room: 1, contents: [["frostbrand", 1], ["dragon_scale", 1]] },
  { id: "c_zorg1", rarity: "epic", interior: "zorg_cave", room: 1, contents: [["guardian_plate", 1]] },
  { id: "c_zorg2", rarity: "rare", interior: "zorg_cave", room: 2, contents: [["elixir", 2], ["purity_tonic", 2]] },
  { id: "c_zorg3", rarity: "rare", interior: "zorg_cave", room: 3, contents: [["greater_potion", 3]] },
  { id: "c_grotto", rarity: "legendary", interior: "hidden1", room: 1, contents: [["ancient_claymore", 1]], coins: 300 },
  { id: "c_crystal", rarity: "epic", interior: "hidden2", room: 2, contents: [["heart_crystal", 1], ["crystal_shard", 3]], puzzle: "runes" },
  { id: "c_vault", rarity: "legendary", interior: "vault", room: 1, contents: [["old_crown", 1], ["hat_circlet", 1]], coins: 250 },
  // abandoned villages: new treasure as the world ends
  { id: "c_ab_andorra", rarity: "legendary", village: "andorra", contents: [["cape_golden", 1], ["elixir", 1]], coins: 200, puzzle: "abandoned" },
  { id: "c_ab_santjulia", rarity: "rare", village: "santjulia", contents: [["greater_potion", 2]], coins: 120, puzzle: "abandoned" },
  { id: "c_ab_encamp", rarity: "rare", village: "encamp", contents: [["purity_tonic", 3]], coins: 90, puzzle: "abandoned" },
  { id: "c_ab_pas", rarity: "rare", village: "pasdelacasa", contents: [["ancient_ore", 2], ["stamina_tonic", 3]], coins: 150, puzzle: "abandoned" },
  { id: "c_ab_soldeu", rarity: "rare", village: "soldeu", contents: [["roast_meat", 3], ["cheese", 3]], coins: 80, puzzle: "abandoned" },
  { id: "c_ab_arinsal", rarity: "epic", village: "arinsal", contents: [["heart_crystal", 1]], coins: 100, puzzle: "abandoned" },
  { id: "c_ab_massana", rarity: "rare", village: "lamassana", contents: [["greater_potion", 1], ["iron_ore", 3]], coins: 110, puzzle: "abandoned" },
  { id: "c_ab_canillo", rarity: "epic", village: "canillo", contents: [["guardian_plate", 1]], coins: 100, puzzle: "abandoned" },
];

const RUNE_SYMBOLS = ["☀", "✦", "☾", "◉"];

export class TreasureSystem {
  chests: Chest[] = [];
  opened = new Set<string>();
  private runeState = new Map<string, { order: number[]; progress: number; stones: { mesh: Mesh; mat: StandardMaterial; sym: number; pos: Vector3 }[] }>();
  private braziers = new Map<string, { lit: number[]; pos: Vector3[]; fx: any[] }>();
  dug = new Set<string>();
  leverPulled = false;
  private leverPos = new Vector3();
  private trapdoor: Mesh | null = null;

  constructor(private game: Game) {}

  init(): void {
    for (const d of CHESTS) this.place(d);
    this.setupVaultLever();
  }

  private resolvePos(d: ChestDef): { pos: Vector3; yaw: number; interior: string | null } | null {
    const g = this.game;
    if (d.interior) {
      const lvl = g.interiors.level(d.interior);
      const room = lvl.def.rooms[d.room ?? 1];
      const cx = lvl.ox + room.x, cz = lvl.oz + room.z + room.r * 0.55;
      let x = cx, z = cz;
      for (let k = 0; k < 12 && lvl.isSolid(x, z); k++) z -= 1;
      return { pos: new Vector3(x, lvl.floorAt(x, z), z), yaw: Math.PI, interior: d.interior };
    }
    if (d.village) {
      const v = g.world.villages.find((q) => q.id === d.village);
      if (!v) return null;
      const b = v.buildings[Math.floor(v.buildings.length / 2)] ?? v.buildings[0];
      const x = b.door.x, z = b.door.z;
      return { pos: new Vector3(x, g.terrain.getHeight(x, z), z), yaw: b.yaw, interior: null };
    }
    if (d.camp) {
      const c = g.enemies.camps.find((q) => q.id === d.camp);
      if (!c) return null;
      const x = c.x + 2.5, z = c.z - 2;
      return { pos: new Vector3(x, g.terrain.getHeight(x, z), z), yaw: 0, interior: null };
    }
    if (d.site) {
      const s = g.world.sites.get(d.site);
      if (!s) return null;
      if (d.anchor && s.anchors[d.anchor]) return { pos: s.anchors[d.anchor].clone(), yaw: s.yaw, interior: null };
      const ox = d.offset?.[0] ?? 0, oz = d.offset?.[1] ?? 0;
      const x = s.x + ox * Math.cos(s.yaw) + oz * Math.sin(s.yaw), z = s.z - ox * Math.sin(s.yaw) + oz * Math.cos(s.yaw);
      return { pos: new Vector3(x, g.physics.groundHeight(x, z, 1e5), z), yaw: s.yaw, interior: null };
    }
    if (d.lat !== undefined) {
      const p = geoToWorld(d.lat, d.lon!);
      const spot = g.terrain.findFlatSpot(p.x, p.z, 40, 3, 5);
      return { pos: new Vector3(spot.x, g.terrain.getHeight(spot.x, spot.z), spot.z), yaw: 0, interior: null };
    }
    return null;
  }

  private buildChestModel(rarity: Rarity): { root: TransformNode; lid: TransformNode } {
    const s = this.game.scene;
    const root = new TransformNode("chest", s);
    const pb = new PartBuilder(s);
    const [wood, band, trim] =
      rarity === "common" ? ["#7a5230", "#3a3a3a", "#5a5a5a"] : rarity === "rare" ? ["#2e3f5a", "#b8c4d0", "#8fb4ff"] : rarity === "epic" ? ["#4a2a5a", "#d8b040", "#c77dff"] : ["#d8a830", "#fff0b0", "#ff80d0"];
    pb.box(wood, 1.2, 0.6, 0.75, { pos: [0, 0.3, 0] });
    for (const x of [-0.45, 0.45]) pb.box(band, 0.08, 0.62, 0.78, { pos: [x, 0.31, 0] });
    pb.box(trim, 1.24, 0.06, 0.79, { pos: [0, 0.03, 0] });
    pb.merge("chestBase", root);
    const lid = new TransformNode("lid", s);
    lid.parent = root;
    lid.position.set(0, 0.6, -0.375);
    pb.cyl(wood, 1.2, 0.75, 0.75, { pos: [0, 0, 0.375], rot: [0, 0, Math.PI / 2], scale: [1, 1, 1] }, 10);
    for (const x of [-0.45, 0.45]) pb.cyl(band, 0.08, 0.78, 0.78, { pos: [x, 0, 0.375], rot: [0, 0, Math.PI / 2] }, 10);
    pb.box(band, 0.2, 0.25, 0.06, { pos: [0, -0.05, 0.76] });
    pb.merge("chestLid", lid);
    if (rarity !== "common") {
      const gem = MeshBuilder.CreatePolyhedron("gem", { type: 1, size: 0.08 }, s);
      gem.material = glowMaterial(s, RARITY_COLOR[rarity], 2);
      gem.parent = lid;
      gem.position.set(0, -0.05, 0.8);
      this.game.glow.addIncludedOnlyMesh(gem);
    }
    return { root, lid };
  }

  private place(d: ChestDef): void {
    const g = this.game;
    const r = this.resolvePos(d);
    if (!r) return;
    const { root, lid } = this.buildChestModel(d.rarity);
    root.position.copyFrom(r.pos);
    root.rotation.y = r.yaw;
    const c: Chest = { def: d, pos: r.pos, yaw: r.yaw, root, lid, opened: false, locked: false, visible: true, seal: null, interior: r.interior, buried: d.puzzle === "dig" };
    this.chests.push(c);
    if (!r.interior) g.physics.addBox(r.pos.x, r.pos.z, 0.6, 0.38, r.yaw, r.pos.y - 1, r.pos.y + 0.8, "small");
    // rarity sparkle
    if (d.rarity === "legendary" || d.rarity === "epic") {
      const col = Color3.FromHexString(RARITY_COLOR[d.rarity]);
      g.fx.emitter(root as any, { rate: 6, color1: new Color4(col.r, col.g, col.b, 1), color2: new Color4(1, 1, 1, 0.8), size: [0.05, 0.15], life: [0.8, 1.6], speed: [0.2, 0.6], tex: "star", box: 0.6, capacity: 20 });
    }
    // puzzles
    switch (d.puzzle) {
      case "runes":
        c.locked = true;
        this.setupRunes(c);
        break;
      case "braziers":
        c.locked = true;
        this.setupBraziers(c);
        break;
      case "camp":
        c.locked = true;
        this.addSeal(c, "#aaaaaa");
        g.events.on("campCleared", (camp: any) => {
          if (camp.id === d.camp && c.locked) {
            c.locked = false;
            this.removeSeal(c);
            g.ui.toast("A treasure chest has been unlocked!", "good");
          }
        });
        break;
      case "night":
        this.setupNight(c);
        break;
      case "dig":
        this.setupDig(c);
        break;
      case "abandoned":
        c.visible = false;
        break;
    }
    if (d.clue) this.clueTrail(c);
    g.interaction.add({
      id: "chest_" + d.id,
      pos: () => c.pos,
      radius: 2.4,
      interior: c.interior,
      label: () => (c.locked ? (d.puzzle === "camp" ? "Locked — defeat the monsters nearby" : "Sealed by ancient magic") : `Open ${d.rarity === "common" ? "chest" : d.rarity + " chest"}`),
      enabled: () => !c.opened && c.visible && !c.buried,
      onInteract: () => {
        if (c.locked) {
          g.audio.sfx("locked");
          return;
        }
        void this.open(c);
      },
    });
  }

  private addSeal(c: Chest, color: string): void {
    const s = MeshBuilder.CreateSphere("seal", { diameter: 2.0, segments: 12 }, this.game.scene);
    const m = new StandardMaterial("sealMat", this.game.scene);
    m.emissiveColor = Color3.FromHexString(color).scale(0.6);
    m.diffuseColor = new Color3(0, 0, 0);
    m.alpha = 0.25;
    m.disableLighting = true;
    s.material = m;
    s.position.copyFrom(c.pos).addInPlaceFromFloats(0, 0.5, 0);
    c.seal = s;
  }
  private removeSeal(c: Chest): void {
    if (!c.seal) return;
    const s = c.seal;
    c.seal = null;
    this.game.fx.burst(s.position, { count: 50, color1: new Color4(0.7, 0.9, 1, 1), tex: "star", size: [0.1, 0.4], speed: [2, 6] });
    this.game.audio.sfx("unlock");
    s.dispose();
  }

  // ------------------------------------------------------------------ puzzles
  private symbolTexture(sym: string): StandardMaterial {
    const g = this.game;
    const dt = new DynamicTexture("rune_" + sym, { width: 128, height: 128 }, g.scene, true);
    const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
    ctx.fillStyle = "#555a62";
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = "#e8f4ff";
    ctx.font = "bold 90px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(sym, 64, 70);
    dt.update();
    const m = new StandardMaterial("runeMat_" + sym, g.scene);
    m.diffuseTexture = dt;
    m.emissiveColor = new Color3(0.1, 0.1, 0.15);
    m.specularColor = new Color3(0, 0, 0);
    return m;
  }

  private setupRunes(c: Chest): void {
    const g = this.game;
    this.addSeal(c, "#8fb4ff");
    const rng = new RNG(hashString(c.def.id));
    const order = [0, 1, 2, 3].sort(() => rng.next() - 0.5);
    const stones: { mesh: Mesh; mat: StandardMaterial; sym: number; pos: Vector3 }[] = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      let x = c.pos.x + Math.sin(a) * 5, z = c.pos.z + Math.cos(a) * 5;
      if (c.interior) {
        const lvl = g.interiors.level(c.interior);
        for (let q = 0; q < 6 && lvl.isSolid(x, z); q++) {
          x = (x + c.pos.x) / 2;
          z = (z + c.pos.z) / 2;
        }
      }
      const y = c.interior ? g.interiors.level(c.interior).floorAt(x, z) : g.terrain.getHeight(x, z);
      const stone = MeshBuilder.CreateBox("runeStone", { width: 0.9, height: 1.6, depth: 0.5 }, g.scene);
      const mat = this.symbolTexture(RUNE_SYMBOLS[k]);
      stone.material = mat;
      stone.position.set(x, y + 0.8, z);
      stone.rotation.y = Math.atan2(c.pos.x - x, c.pos.z - z);
      if (c.interior) stone.parent = g.interiors.level(c.interior).root;
      stones.push({ mesh: stone, mat, sym: k, pos: new Vector3(x, y, z) });
      if (!c.interior) g.physics.addCircle(x, z, 0.5, y - 1, y + 1.6, "small");
      g.interaction.add({
        id: `rune_${c.def.id}_${k}`, pos: () => new Vector3(x, y, z), radius: 2.2, interior: c.interior, label: () => `Touch the ${RUNE_SYMBOLS[k]} rune stone`,
        enabled: () => c.locked,
        onInteract: () => this.touchRune(c, k),
      });
    }
    this.runeState.set(c.def.id, { order, progress: 0, stones });
    // the hint stele
    const hint = order.map((i) => ["the Sun", "the Star", "the Moon", "the Eye"][i]).join(", then ");
    const hx = c.pos.x + Math.sin(c.yaw) * 3, hz = c.pos.z + Math.cos(c.yaw) * 3;
    const hy = c.interior ? g.interiors.level(c.interior).floorAt(hx, hz) : g.terrain.getHeight(hx, hz);
    const plaque = MeshBuilder.CreateBox("plaque", { width: 1.2, height: 0.9, depth: 0.2 }, g.scene);
    plaque.material = glowMaterial(g.scene, "#8fe6ff", 0.25);
    plaque.position.set(hx, hy + 0.6, hz);
    plaque.rotation.x = -0.4;
    if (c.interior) plaque.parent = g.interiors.level(c.interior).root;
    g.interaction.add({
      id: `runehint_${c.def.id}`, pos: () => new Vector3(hx, hy, hz), radius: 2.2, interior: c.interior, label: () => "Read the carved inscription", enabled: () => c.locked,
      onInteract: () => void g.dialogue.run(async () => g.dialogue.say("Inscription", `"Wake the guardians in the order of the old sky: ${hint}."`, "#8fe6ff")),
    });
  }

  private touchRune(c: Chest, k: number): void {
    const g = this.game;
    const st = this.runeState.get(c.def.id)!;
    const stone = st.stones[k];
    if (st.order[st.progress] === k) {
      st.progress++;
      stone.mat.emissiveColor = new Color3(0.3, 0.6, 1);
      g.audio.sfx("runeOk");
      g.fx.burst(stone.mesh.position, { count: 20, color1: new Color4(0.5, 0.8, 1, 1), tex: "star", size: [0.05, 0.2], speed: [1, 3] });
      if (st.progress >= 4) {
        c.locked = false;
        this.removeSeal(c);
        g.ui.toast("The ancient seal is broken!", "good");
      }
    } else {
      st.progress = 0;
      for (const s of st.stones) s.mat.emissiveColor = new Color3(0.1, 0.1, 0.15);
      g.audio.sfx("runeFail");
      g.ui.toast("The runes go dark. Try a different order.", "warn");
    }
  }

  private setupBraziers(c: Chest): void {
    const g = this.game;
    this.addSeal(c, "#ffa040");
    const pos: Vector3[] = [];
    const fx: any[] = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      const x = c.pos.x + Math.sin(a) * 6.5, z = c.pos.z + Math.cos(a) * 6.5;
      const y = g.terrain.getHeight(x, z);
      const pb = new PartBuilder(g.scene);
      pb.cyl("#4a4a4a", 1.1, 0.25, 0.4, { pos: [x, y + 0.55, z] }, 8);
      pb.cyl("#3a3a3a", 0.3, 0.9, 0.5, { pos: [x, y + 1.2, z] }, 10);
      pb.merge("brazier", null);
      g.physics.addCircle(x, z, 0.4, y - 1, y + 1.3, "small");
      pos.push(new Vector3(x, y + 1.35, z));
      fx.push(null);
      g.interaction.add({
        id: `brazier_${c.def.id}_${k}`, pos: () => new Vector3(x, y, z), radius: 2.2, label: () => "Light the brazier",
        enabled: () => c.locked && (this.braziers.get(c.def.id)!.lit[k] ?? 0) <= 0,
        onInteract: () => this.lightBrazier(c, k),
      });
    }
    this.braziers.set(c.def.id, { lit: [0, 0, 0, 0], pos, fx });
    g.fx.addUpdater((dt) => {
      const b = this.braziers.get(c.def.id)!;
      for (let k = 0; k < 4; k++) {
        if (b.lit[k] > 0) {
          b.lit[k] -= dt;
          if (b.lit[k] <= 0 && b.fx[k] && c.locked) {
            b.fx[k].stop();
            b.fx[k].disposeOnStop = true;
            b.fx[k] = null;
            g.audio.sfx("fizzle");
          }
        }
      }
      return c.locked;
    });
  }

  private lightBrazier(c: Chest, k: number): void {
    const g = this.game;
    const b = this.braziers.get(c.def.id)!;
    b.lit[k] = 22;
    b.fx[k] = g.fx.emitter(b.pos[k], { rate: 40, color1: new Color4(1, 0.6, 0.2, 1), color2: new Color4(1, 0.3, 0.05, 0.8), size: [0.2, 0.6], life: [0.3, 0.8], speed: [1, 2.5], tex: "spark", box: 0.25 });
    g.audio.sfx("ignite");
    const litCount = b.lit.filter((t) => t > 0).length;
    if (litCount >= 4) {
      c.locked = false;
      this.removeSeal(c);
      g.ui.toast("All four flames burn together — the seal breaks!", "good");
    } else g.ui.toast(`Braziers lit: ${litCount}/4 — they won't burn for long!`, "info");
  }

  private setupNight(c: Chest): void {
    const g = this.game;
    const sb = new StructureBuilder(g.scene, c.pos.x, c.pos.y, c.pos.z, 0);
    buildStandingStones(sb, new RNG(5), 7, 7);
    sb.finish("nightStones", g.physics);
    // glowing tops reveal themselves at night
    const glows: Mesh[] = [];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const m = MeshBuilder.CreateSphere("ng", { diameter: 0.35, segments: 6 }, g.scene);
      m.material = glowMaterial(g.scene, "#9fd8ff", 2);
      m.position.set(c.pos.x + Math.sin(a) * 7, g.terrain.getHeight(c.pos.x + Math.sin(a) * 7, c.pos.z + Math.cos(a) * 7) + 3.6, c.pos.z + Math.cos(a) * 7);
      g.glow.addIncludedOnlyMesh(m);
      glows.push(m);
    }
    g.fx.addUpdater(() => {
      const night = g.time.isNight;
      c.visible = night || c.opened;
      if (!c.opened) c.root.setEnabled(night && !g.interiors.current);
      for (const m of glows) m.setEnabled(night && !g.interiors.current);
      return true;
    });
  }

  private setupDig(c: Chest): void {
    const g = this.game;
    c.root.setEnabled(false);
    const pb = new PartBuilder(g.scene);
    for (let k = 0; k < 6; k++) pb.ico("#7d7a76", 0.45 - k * 0.05, { pos: [c.pos.x + Math.sin(k) * 0.2, c.pos.y + 0.3 + k * 0.42, c.pos.z + Math.cos(k) * 0.2] }, 1, 0.15);
    const cairn = pb.merge("cairn", null)!;
    g.interaction.add({
      id: "dig_" + c.def.id, pos: () => c.pos, radius: 2.6, label: () => "Dig beneath the suspicious cairn", enabled: () => c.buried,
      onInteract: () => {
        c.buried = false;
        this.dug.add(c.def.id);
        cairn.dispose();
        g.player.playAction("pickup", 0.9);
        g.audio.sfx("dig");
        g.fx.burst(c.pos.add(new Vector3(0, 0.4, 0)), { count: 40, color1: new Color4(0.45, 0.35, 0.25, 1), tex: "smoke", additive: false, size: [0.3, 0.8], speed: [2, 5] });
        c.root.setEnabled(true);
        const y0 = c.pos.y;
        c.root.position.y = y0 - 1;
        let t = 0;
        g.fx.addUpdater((dt) => {
          t += dt;
          c.root.position.y = y0 - 1 + Math.min(1, easeOutBack(t / 0.8));
          return t < 0.8;
        });
      },
    });
    (c as any).cairn = cairn;
  }

  /** Faintly glowing pebbles leading toward a hidden chest — an environmental clue. */
  private clueTrail(c: Chest): void {
    const g = this.game;
    if (c.interior) return;
    const rng = new RNG(hashString(c.def.id) + 3);
    const a = rng.next() * Math.PI * 2;
    for (let k = 1; k <= 7; k++) {
      const d = k * 3.2;
      const x = c.pos.x + Math.sin(a + Math.sin(k) * 0.3) * d, z = c.pos.z + Math.cos(a + Math.sin(k) * 0.3) * d;
      const y = g.terrain.getHeight(x, z);
      const m = MeshBuilder.CreateIcoSphere("clue", { radius: 0.12, subdivisions: 1 }, g.scene);
      m.material = glowMaterial(g.scene, "#7fd8ff", 1.5);
      m.position.set(x, y + 0.05, z);
      g.glow.addIncludedOnlyMesh(m);
    }
  }

  private setupVaultLever(): void {
    const g = this.game;
    const s = g.world.sites.get("ruins_engolasters");
    if (!s) return;
    // the suspicious rock with the sun symbol, hiding a lever
    const ox = -13, oz = 6;
    const x = s.x + ox * Math.cos(s.yaw) + oz * Math.sin(s.yaw), z = s.z - ox * Math.sin(s.yaw) + oz * Math.cos(s.yaw);
    const y = g.terrain.getHeight(x, z);
    const pb = new PartBuilder(g.scene);
    pb.ico("#6d6a66", 1.4, { pos: [x, y + 0.9, z], scale: [1.2, 1, 1] }, 1, 0.1);
    pb.ico("#5d5a56", 0.9, { pos: [x + 1.3, y + 0.5, z + 0.4] }, 1, 0.1);
    pb.merge("sunRock", null);
    g.physics.addCircle(x, z, 1.5, y - 1, y + 2, "small");
    const sun = MeshBuilder.CreateDisc("sun", { radius: 0.35, tessellation: 12 }, g.scene);
    sun.material = glowMaterial(g.scene, "#ffd84a", 1.4);
    sun.position.set(x, y + 1.3, z + 1.45);
    g.glow.addIncludedOnlyMesh(sun);
    this.leverPos.set(x, y, z);
    // trapdoor slab near the altar
    const tx = s.x + 4 * Math.sin(s.yaw), tz = s.z + 4 * Math.cos(s.yaw);
    const ty = g.terrain.getHeight(tx, tz);
    const slab = MeshBuilder.CreateBox("slab", { width: 2.4, height: 0.25, depth: 2.4 }, g.scene);
    const sm = new StandardMaterial("slabMat", g.scene);
    sm.diffuseColor = new Color3(0.42, 0.4, 0.37);
    slab.material = sm;
    slab.position.set(tx, ty + 0.12, tz);
    this.trapdoor = slab;
    const hole = MeshBuilder.CreateBox("hole", { width: 2.2, height: 0.05, depth: 2.2 }, g.scene);
    const hm = new StandardMaterial("holeMat", g.scene);
    hm.diffuseColor = new Color3(0, 0, 0);
    hm.specularColor = new Color3(0, 0, 0);
    hole.material = hm;
    hole.position.set(tx, ty + 0.04, tz);
    g.interaction.add({
      id: "lever", pos: () => this.leverPos, radius: 3, label: () => "Pull the hidden lever behind the sun-marked rock", enabled: () => !this.leverPulled,
      onInteract: () => this.pullLever(),
    });
    g.interaction.add({
      id: "vault_enter", pos: () => new Vector3(tx, ty, tz), radius: 2.8, label: () => "Descend into the Vault of the Old Kings", enabled: () => this.leverPulled,
      onInteract: () => void g.interiors.enter("vault"), priority: 2,
    });
  }

  private pullLever(): void {
    const g = this.game;
    this.leverPulled = true;
    g.audio.sfx("lever");
    g.camera.shake(0.4);
    g.ui.toast("Stone grinds against stone somewhere nearby...", "info");
    const slab = this.trapdoor!;
    const x0 = slab.position.x;
    let t = 0;
    g.fx.addUpdater((dt) => {
      t += dt;
      slab.position.x = x0 + Math.min(1, t / 2) * 2.6;
      return t < 2;
    });
  }

  private async open(c: Chest): Promise<void> {
    const g = this.game;
    if (c.opened) return;
    c.opened = true;
    this.opened.add(c.def.id);
    const rare = c.def.rarity !== "common";
    g.player.frozen = true;
    g.player.playAction("pickup", 0.8);
    g.audio.sfx(rare ? "chestRare" : "chestOpen");
    const col = Color3.FromHexString(RARITY_COLOR[c.def.rarity]);
    let light: PointLight | null = null;
    if (rare) {
      // shake + glow before opening
      light = new PointLight("chestLight", c.pos.add(new Vector3(0, 1.2, 0)), g.scene);
      light.diffuse = col;
      light.intensity = 0;
      light.range = 10;
      await this.animate(0.6, (k) => {
        c.root.rotation.z = Math.sin(k * 40) * 0.05 * (1 - k);
        light!.intensity = k * 2.5;
      });
    }
    await this.animate(0.7, (k) => {
      c.lid.rotation.x = -easeInOut(k) * 1.9;
    });
    // beam of light & burst
    const beam = MeshBuilder.CreateCylinder("beam", { height: rare ? 14 : 5, diameterTop: rare ? 2.5 : 1.2, diameterBottom: 0.8, tessellation: 12 }, g.scene);
    const bm = new StandardMaterial("beamMat", g.scene);
    bm.emissiveColor = col;
    bm.diffuseColor = new Color3(0, 0, 0);
    bm.alpha = 0.35;
    bm.disableLighting = true;
    beam.material = bm;
    beam.position.copyFrom(c.pos.add(new Vector3(0, rare ? 7 : 2.5, 0)));
    g.fx.burst(c.pos.add(new Vector3(0, 0.9, 0)), { count: rare ? 120 : 40, color1: new Color4(col.r, col.g, col.b, 1), color2: new Color4(1, 1, 1, 1), tex: "star", size: [0.08, 0.35], speed: [2, rare ? 9 : 5], gravity: -3, life: [0.6, 1.4] });
    if (c.def.rarity === "legendary") {
      for (const hex of ["#ff3b30", "#ffd60a", "#34e05a", "#3ab0ff", "#c77dff"]) {
        const cc = Color3.FromHexString(hex);
        g.fx.burst(c.pos.add(new Vector3(0, 1.4, 0)), { count: 40, color1: new Color4(cc.r, cc.g, cc.b, 1), tex: "star", size: [0.1, 0.3], speed: [4, 10], gravity: -2, life: [0.8, 1.6] });
      }
      g.ui.screenFlash(0.35, RARITY_COLOR.legendary);
    }
    g.fx.animateMesh(beam, 2.2, (k, m) => {
      bm.alpha = 0.35 * (1 - k);
      m.scaling.x = m.scaling.z = 1 + k * 0.5;
    });
    // contents
    for (const [id, n] of c.def.contents) g.inventory.add(id, n);
    if (c.def.coins) g.inventory.addCoins(c.def.coins);
    const main = c.def.contents[0];
    if (main && rare) {
      const def = item(main[0]);
      g.ui.itemShowcase(def);
    }
    if (light) {
      const l = light;
      setTimeout(() => l.dispose(), 2500);
    }
    setTimeout(() => (g.player.frozen = false), 700);
    g.events.emit("chestOpened", c.def.id);
    g.save.autosave("chest");
  }

  private animate(dur: number, fn: (k: number) => void): Promise<void> {
    return new Promise((res) => {
      let t = 0;
      this.game.fx.addUpdater((dt) => {
        t += dt;
        fn(Math.min(1, t / dur));
        if (t >= dur) {
          res();
          return false;
        }
        return true;
      });
    });
  }

  update(dt: number): void {
    const g = this.game;
    const interior = g.interiors.current?.def.id ?? null;
    for (const c of this.chests) {
      const show = c.visible && c.interior === interior && !c.buried;
      if (c.def.puzzle !== "night") c.root.setEnabled(show);
      if (c.seal) {
        c.seal.setEnabled(c.interior === interior);
        c.seal.rotation.y += dt;
      }
    }
    void dt;
  }

  /** WorldEvolution reveals chests in abandoned villages. */
  revealAbandoned(villageId: string): void {
    for (const c of this.chests) if (c.def.village === villageId && !c.visible) c.visible = true;
  }

  serialize() {
    return { opened: [...this.opened], dug: [...this.dug], lever: this.leverPulled };
  }
  deserialize(d: any) {
    if (!d) return;
    this.opened = new Set(d.opened ?? []);
    this.dug = new Set(d.dug ?? []);
    for (const c of this.chests) {
      c.opened = this.opened.has(c.def.id);
      if (c.opened) {
        c.lid.rotation.x = -1.9;
        c.locked = false;
        if (c.seal) {
          c.seal.dispose();
          c.seal = null;
        }
      }
      if (this.dug.has(c.def.id) || c.opened) {
        c.buried = false;
        (c as any).cairn?.dispose();
      }
    }
    if (d.lever && !this.leverPulled) {
      this.leverPulled = true;
      if (this.trapdoor) this.trapdoor.position.x += 2.6;
    }
  }
}
