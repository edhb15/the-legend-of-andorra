import { Vector3, Mesh, MeshBuilder, Color3, Color4, StandardMaterial } from "@babylonjs/core";
import type { Game } from "../core/Game";
import { ITEMS, item, ItemDef, SHARD_ORDER, ShardColor, RARITY_COLOR } from "../data/items";
import { glowMaterial } from "../entities/CharacterKit";

interface Pickup {
  id: string;
  count: number;
  mesh: Mesh;
  pos: Vector3;
  t: number;
  coins: boolean;
  interior: string | null;
}

export interface Equipped {
  weapon: string;
  armor: string | null;
  cape: string | null;
  hat: string | null;
}

/** Items, coins, equipment and world pickups. */
export class InventorySystem {
  items = new Map<string, number>();
  coins = 25;
  equipped: Equipped = { weapon: "traveler_sword", armor: null, cape: null, hat: null };
  private pickups: Pickup[] = [];
  private pickupMats = new Map<string, StandardMaterial>();
  /** blacksmith sharpening levels per weapon */
  upgrades: Record<string, number> = {};
  /** item ids seen at least once (for "NEW" badges) */
  seen = new Set<string>();

  constructor(private game: Game) {}

  reset(): void {
    this.items.clear();
    this.coins = 25;
    this.equipped = { weapon: "traveler_sword", armor: null, cape: null, hat: null };
    this.upgrades = {};
    this.items.set("traveler_sword", 1);
    this.items.set("health_potion", 3);
    this.items.set("apple", 2);
  }

  has(id: string): boolean {
    return (this.items.get(id) ?? 0) > 0;
  }
  count(id: string): number {
    return this.items.get(id) ?? 0;
  }

  shards(): ShardColor[] {
    return SHARD_ORDER.filter((c) => this.has("shard_" + c));
  }

  add(id: string, n = 1, silent = false): void {
    const def = ITEMS[id];
    if (!def) return;
    const g = this.game;
    if (def.cat === "upgrade") {
      if (def.upgrade?.maxHealth) {
        g.player.maxHp += def.upgrade.maxHealth;
        g.player.hp = g.player.maxHp;
      }
      if (def.upgrade?.maxStamina) {
        g.player.maxStamina += def.upgrade.maxStamina;
        g.player.stamina = g.player.maxStamina;
      }
      g.ui.bigTitle(def.name.toUpperCase(), def.desc, RARITY_COLOR[def.rarity]);
      g.audio.sfx("fanfare");
      return;
    }
    const unique = ["weapon", "armor", "cosmetic", "magic", "shard"].includes(def.cat) || id === "old_crown";
    const cur = this.items.get(id) ?? 0;
    this.items.set(id, unique ? 1 : cur + n);
    if (!silent) g.ui.itemToast(def, n);
    g.events.emit("itemAdded", { id, n });
    if (def.cat === "shard" && this.shards().length === 5) {
      setTimeout(() => g.ui.bigTitle("THE FIVE SHARDS RESONATE", "Seek the legendary sword maker in the mountains", "#ffffff"), 4500);
    }
  }

  remove(id: string, n = 1): boolean {
    const cur = this.items.get(id) ?? 0;
    if (cur < n) return false;
    if (cur - n <= 0) this.items.delete(id);
    else this.items.set(id, cur - n);
    return true;
  }

  addCoins(n: number, silent = false): void {
    this.coins += n;
    if (!silent) this.game.ui.coinToast(n);
  }
  spend(n: number): boolean {
    if (this.coins < n) return false;
    this.coins -= n;
    return true;
  }

  /** Use a consumable. */
  use(id: string): boolean {
    const def = ITEMS[id];
    const g = this.game;
    if (!def || !this.has(id)) return false;
    if (def.cat === "weapon") return this.equip(id);
    if (def.cat === "armor" || def.cat === "cosmetic") return this.equip(id);
    if (!def.use) return false;
    const p = g.player;
    if (def.use.full) {
      p.hp = p.maxHp;
      p.stamina = p.maxStamina;
      p.exhausted = false;
    }
    if (def.use.heal) p.heal(def.use.heal);
    if (def.use.stamina) p.restoreStamina(def.use.stamina);
    if (def.use.poisonImmune) {
      g.poison.immuneMinutes = Math.max(g.poison.immuneMinutes, def.use.poisonImmune);
      g.ui.toast("You are protected from the poison cloud for 3 hours", "good");
    }
    this.remove(id, 1);
    g.audio.sfx(def.cat === "potion" ? "drink" : "eat");
    if (g.state === "playing") p.playAction("drink", 0.7);
    g.fx.burst(p.position.add(new Vector3(0, 1.2, 0)), { count: 20, color1: new Color4(0.5, 1, 0.5, 1), color2: new Color4(1, 1, 1, 1), size: [0.05, 0.2], speed: [1, 3], life: [0.5, 1] });
    return true;
  }

  /** Quick-heal with the best available healing item. */
  quickHeal(): void {
    const order = ["greater_potion", "health_potion", "roast_meat", "cheese", "apple", "mushroom", "elixir"];
    for (const id of order) {
      if (this.has(id)) {
        if (this.game.player.hp >= this.game.player.maxHp) {
          this.game.ui.toast("Health is already full", "info");
          return;
        }
        this.use(id);
        return;
      }
    }
    this.game.ui.toast("No healing items!", "warn");
  }

  equip(id: string): boolean {
    const def = ITEMS[id];
    const g = this.game;
    if (!def || !this.has(id)) return false;
    if (def.cat === "weapon") {
      this.equipped.weapon = id;
      g.player.equipWeapon(id);
      g.audio.sfx("equip");
      return true;
    }
    if (def.cat === "armor") {
      this.equipped.armor = this.equipped.armor === id ? null : id;
      g.player.buildRig();
      g.audio.sfx("equip");
      return true;
    }
    if (def.cat === "cosmetic" && def.cosmetic) {
      if (def.cosmetic.slot === "cape") this.equipped.cape = this.equipped.cape === id ? null : id;
      else this.equipped.hat = this.equipped.hat === id ? null : id;
      g.player.buildRig();
      g.audio.sfx("equip");
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ world pickups
  private pickupMat(color: string): StandardMaterial {
    let m = this.pickupMats.get(color);
    if (!m) {
      m = glowMaterial(this.game.scene, color, 0.6);
      this.pickupMats.set(color, m);
    }
    return m;
  }

  spawnPickup(id: string, pos: Vector3, count = 1): void {
    const def = ITEMS[id];
    if (!def) return;
    const g = this.game;
    const color = def.cat === "food" ? "#e05a3a" : def.cat === "material" ? "#c8a060" : RARITY_COLOR[def.rarity];
    const mesh = def.cat === "food" ? MeshBuilder.CreateSphere("pk", { diameter: 0.35, segments: 6 }, g.scene) : MeshBuilder.CreateBox("pk", { size: 0.3 }, g.scene);
    mesh.material = this.pickupMat(color);
    const y = g.physics.groundHeight(pos.x, pos.z, pos.y + 1);
    const p = new Vector3(pos.x, y + 0.35, pos.z);
    mesh.position.copyFrom(p);
    g.glow.addIncludedOnlyMesh(mesh);
    this.pickups.push({ id, count, mesh, pos: p, t: 0, coins: false, interior: g.interiors.current?.def.id ?? null });
  }

  spawnCoins(n: number, pos: Vector3): void {
    const g = this.game;
    const mesh = MeshBuilder.CreateCylinder("coin", { height: 0.06, diameter: 0.35, tessellation: 12 }, g.scene);
    mesh.material = this.pickupMat("#ffd84a");
    mesh.rotation.x = Math.PI / 2;
    const y = g.physics.groundHeight(pos.x, pos.z, pos.y + 1);
    const p = new Vector3(pos.x, y + 0.4, pos.z);
    mesh.position.copyFrom(p);
    g.glow.addIncludedOnlyMesh(mesh);
    this.pickups.push({ id: "coins", count: n, mesh, pos: p, t: 0, coins: true, interior: g.interiors.current?.def.id ?? null });
  }

  update(dt: number): void {
    const g = this.game;
    const p = g.player.position;
    const interior = g.interiors.current?.def.id ?? null;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      k.t += dt;
      k.mesh.position.y = k.pos.y + Math.sin(k.t * 3) * 0.08;
      k.mesh.rotation.y += dt * 2;
      k.mesh.setEnabled(k.interior === interior);
      if (k.interior !== interior) continue;
      const d = Math.hypot(p.x - k.pos.x, p.z - k.pos.z);
      // magnet
      if (d < 3.5 && k.t > 0.6 && !g.player.dead) {
        k.pos.x += (p.x - k.pos.x) * Math.min(1, dt * 8);
        k.pos.z += (p.z - k.pos.z) * Math.min(1, dt * 8);
        k.mesh.position.x = k.pos.x;
        k.mesh.position.z = k.pos.z;
      }
      if (d < 0.9 && k.t > 0.6) {
        if (k.coins) {
          this.addCoins(k.count);
          g.audio.sfx("coin");
        } else {
          this.add(k.id, k.count);
          g.audio.sfx("pickup");
        }
        k.mesh.dispose();
        this.pickups.splice(i, 1);
      } else if (k.t > 300) {
        k.mesh.dispose();
        this.pickups.splice(i, 1);
      }
    }
  }

  /** Items grouped by category for the UI. */
  listBy(cats: string[]): { def: ItemDef; count: number }[] {
    const out: { def: ItemDef; count: number }[] = [];
    for (const [id, n] of this.items) {
      const def = ITEMS[id];
      if (def && cats.includes(def.cat)) out.push({ def, count: n });
    }
    return out.sort((a, b) => a.def.name.localeCompare(b.def.name));
  }

  serialize() {
    return { items: [...this.items.entries()], coins: this.coins, equipped: this.equipped, upgrades: this.upgrades };
  }
  deserialize(d: any) {
    if (!d) return;
    this.items = new Map(d.items ?? []);
    this.coins = d.coins ?? 0;
    this.upgrades = d.upgrades ?? {};
    this.equipped = { weapon: "traveler_sword", armor: null, cape: null, hat: null, ...(d.equipped ?? {}) };
    for (const k of this.pickups) k.mesh.dispose();
    this.pickups = [];
    void item;
    void Color3;
  }
}
