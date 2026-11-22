export type ItemCategory = "weapon" | "armor" | "potion" | "food" | "material" | "key" | "shard" | "cosmetic" | "magic" | "upgrade";
export type Rarity = "common" | "rare" | "epic" | "legendary";
export type ShardColor = "red" | "green" | "blue" | "white" | "yellow";

export interface WeaponStats {
  damage: number;
  speed: number; // attack speed multiplier
  reach: number;
  model: "wood" | "traveler" | "iron" | "steel" | "knight" | "claymore" | "ember" | "frost" | "rainbow";
  element?: "fire" | "ice";
}

export interface ItemDef {
  id: string;
  name: string;
  cat: ItemCategory;
  desc: string;
  icon: string;
  value: number;
  rarity: Rarity;
  weapon?: WeaponStats;
  armor?: { defense: number };
  use?: { heal?: number; stamina?: number; poisonImmune?: number; full?: boolean };
  cosmetic?: { slot: "cape" | "hat"; color?: string; hat?: string };
  magic?: { effect: "speed" | "poisonResist" | "staminaRegen" | "fortune" };
  upgrade?: { maxHealth?: number; maxStamina?: number };
  shard?: ShardColor;
}

export const SHARD_INFO: Record<ShardColor, { name: string; hex: string; element: string; boss: string }> = {
  red: { name: "Red Shard", hex: "#ff3b30", element: "Fire", boss: "The Flame Beast" },
  green: { name: "Green Shard", hex: "#34e05a", element: "Nature", boss: "The Forest Guardian" },
  blue: { name: "Blue Shard", hex: "#3ab0ff", element: "Ice", boss: "The Frost Dragon" },
  white: { name: "White Shard", hex: "#f4f4ff", element: "Light", boss: "The Shadow Knight" },
  yellow: { name: "Yellow Shard", hex: "#ffd60a", element: "Lightning", boss: "The Thunder Titan" },
};
export const SHARD_ORDER: ShardColor[] = ["red", "green", "blue", "white", "yellow"];

const I = (d: ItemDef) => d;

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(
  [
    // ---------------- weapons
    I({ id: "wooden_sword", name: "Wooden Sword", cat: "weapon", desc: "A training sword carved from Andorran pine.", icon: "🗡️", value: 5, rarity: "common", weapon: { damage: 7, speed: 1.1, reach: 2.2, model: "wood" } }),
    I({ id: "traveler_sword", name: "Traveler's Sword", cat: "weapon", desc: "A reliable blade for the mountain roads.", icon: "🗡️", value: 40, rarity: "common", weapon: { damage: 11, speed: 1.0, reach: 2.4, model: "traveler" } }),
    I({ id: "iron_sword", name: "Iron Sword", cat: "weapon", desc: "Forged in the smithies of the valleys.", icon: "⚔️", value: 160, rarity: "common", weapon: { damage: 16, speed: 1.0, reach: 2.5, model: "iron" } }),
    I({ id: "steel_longsword", name: "Steel Longsword", cat: "weapon", desc: "Long reach and a keen edge.", icon: "⚔️", value: 320, rarity: "rare", weapon: { damage: 22, speed: 0.95, reach: 2.8, model: "steel" } }),
    I({ id: "ember_saber", name: "Ember Saber", cat: "weapon", desc: "Its blade never cools. Burns foes on hit.", icon: "🔥", value: 420, rarity: "rare", weapon: { damage: 24, speed: 1.05, reach: 2.5, model: "ember", element: "fire" } }),
    I({ id: "frostbrand", name: "Frostbrand", cat: "weapon", desc: "Rime-covered steel that slows its victims.", icon: "❄️", value: 420, rarity: "rare", weapon: { damage: 24, speed: 1.0, reach: 2.6, model: "frost", element: "ice" } }),
    I({ id: "knight_blade", name: "Knight's Blade", cat: "weapon", desc: "Carried by the old Valley Watch. Balanced and deadly.", icon: "⚔️", value: 600, rarity: "epic", weapon: { damage: 30, speed: 1.05, reach: 2.7, model: "knight" } }),
    I({ id: "ancient_claymore", name: "Ancient Claymore", cat: "weapon", desc: "A colossal two-handed blade from a forgotten age. Slow but devastating.", icon: "🗡️", value: 900, rarity: "legendary", weapon: { damage: 42, speed: 0.75, reach: 3.2, model: "claymore" } }),
    I({ id: "rainbow_sword", name: "The Rainbow Sword", cat: "weapon", desc: "Forged from the five shards. Its prismatic blade burns away darkness. The only weapon that can defeat Zorg.", icon: "🌈", value: 0, rarity: "legendary", weapon: { damage: 55, speed: 1.15, reach: 3.0, model: "rainbow" } }),
    // ---------------- armour
    I({ id: "leather_tunic", name: "Leather Tunic", cat: "armor", desc: "Light protection. Defense +4", icon: "🦺", value: 80, rarity: "common", armor: { defense: 4 } }),
    I({ id: "chainmail", name: "Chainmail Hauberk", cat: "armor", desc: "Interlocking steel rings. Defense +9", icon: "🛡️", value: 300, rarity: "rare", armor: { defense: 9 } }),
    I({ id: "guardian_plate", name: "Guardian Plate", cat: "armor", desc: "Armour of the ancient shard guardians. Defense +15", icon: "🛡️", value: 800, rarity: "epic", armor: { defense: 15 } }),
    // ---------------- potions & food
    I({ id: "health_potion", name: "Health Potion", cat: "potion", desc: "Restores 40 health.", icon: "🧪", value: 30, rarity: "common", use: { heal: 40 } }),
    I({ id: "greater_potion", name: "Greater Health Potion", cat: "potion", desc: "Restores 100 health.", icon: "⚗️", value: 80, rarity: "rare", use: { heal: 100 } }),
    I({ id: "stamina_tonic", name: "Stamina Tonic", cat: "potion", desc: "Fully restores stamina.", icon: "🍵", value: 25, rarity: "common", use: { stamina: 999 } }),
    I({ id: "purity_tonic", name: "Purity Tonic", cat: "potion", desc: "Grants immunity to the poison cloud for 3 in-game hours.", icon: "💧", value: 60, rarity: "rare", use: { poisonImmune: 180 } }),
    I({ id: "elixir", name: "Elixir of the Valleys", cat: "potion", desc: "Fully restores health and stamina.", icon: "✨", value: 200, rarity: "epic", use: { full: true } }),
    I({ id: "apple", name: "Mountain Apple", cat: "food", desc: "Crisp and sweet. Restores 8 health.", icon: "🍎", value: 3, rarity: "common", use: { heal: 8 } }),
    I({ id: "mushroom", name: "Forest Mushroom", cat: "food", desc: "Restores 6 health.", icon: "🍄", value: 3, rarity: "common", use: { heal: 6 } }),
    I({ id: "roast_meat", name: "Roast Meat", cat: "food", desc: "Hearty. Restores 25 health.", icon: "🍖", value: 12, rarity: "common", use: { heal: 25 } }),
    I({ id: "cheese", name: "Pyrenean Cheese", cat: "food", desc: "Restores 15 health and some stamina.", icon: "🧀", value: 10, rarity: "common", use: { heal: 15, stamina: 30 } }),
    // ---------------- materials
    I({ id: "wood", name: "Pine Wood", cat: "material", desc: "Sturdy timber.", icon: "🪵", value: 2, rarity: "common" }),
    I({ id: "iron_ore", name: "Iron Ore", cat: "material", desc: "Used by blacksmiths to upgrade weapons.", icon: "🪨", value: 15, rarity: "common" }),
    I({ id: "ancient_ore", name: "Ancient Ore", cat: "material", desc: "Rare metal from the age of the guardians.", icon: "💠", value: 60, rarity: "rare" }),
    I({ id: "crystal_shard", name: "Cave Crystal", cat: "material", desc: "A glowing crystal from deep caves.", icon: "🔮", value: 40, rarity: "rare" }),
    I({ id: "star_fragment", name: "Star Fragment", cat: "material", desc: "Fell from the night sky. Extremely rare.", icon: "🌟", value: 150, rarity: "epic" }),
    I({ id: "dragon_scale", name: "Frost Dragon Scale", cat: "material", desc: "Cold to the touch, harder than steel.", icon: "🐉", value: 120, rarity: "epic" }),
    I({ id: "mountain_herb", name: "Mountain Herb", cat: "material", desc: "Healers brew potions from it.", icon: "🌿", value: 5, rarity: "common" }),
    I({ id: "wolf_pelt", name: "Wolf Pelt", cat: "material", desc: "Thick grey fur.", icon: "🐺", value: 12, rarity: "common" }),
    I({ id: "goblin_horn", name: "Goblin Horn", cat: "material", desc: "A crude trophy.", icon: "📯", value: 8, rarity: "common" }),
    I({ id: "slime_gel", name: "Poison Gel", cat: "material", desc: "Residue of a poison slime. Alchemists pay for it.", icon: "🟣", value: 10, rarity: "common" }),
    I({ id: "shadow_essence", name: "Shadow Essence", cat: "material", desc: "Darkness made solid.", icon: "🌑", value: 30, rarity: "rare" }),
    // ---------------- upgrades
    I({ id: "heart_crystal", name: "Heart Crystal", cat: "upgrade", desc: "Permanently increases maximum health by 20.", icon: "❤️", value: 0, rarity: "epic", upgrade: { maxHealth: 20 } }),
    I({ id: "stamina_vessel", name: "Stamina Vessel", cat: "upgrade", desc: "Permanently increases maximum stamina by 20.", icon: "💚", value: 0, rarity: "rare", upgrade: { maxStamina: 20 } }),
    // ---------------- magic objects
    I({ id: "amulet_swiftness", name: "Amulet of Swiftness", cat: "magic", desc: "Movement speed +12%.", icon: "📿", value: 300, rarity: "rare", magic: { effect: "speed" } }),
    I({ id: "ring_vigor", name: "Ring of Vigor", cat: "magic", desc: "Stamina recovers 40% faster.", icon: "💍", value: 300, rarity: "rare", magic: { effect: "staminaRegen" } }),
    I({ id: "lantern_purity", name: "Lantern of Purity", cat: "magic", desc: "The ancients' light. Poison damage -40%.", icon: "🏮", value: 500, rarity: "epic", magic: { effect: "poisonResist" } }),
    I({ id: "charm_fortune", name: "Charm of Fortune", cat: "magic", desc: "Monsters drop more coins.", icon: "🍀", value: 250, rarity: "rare", magic: { effect: "fortune" } }),
    // ---------------- cosmetics
    I({ id: "cape_crimson", name: "Crimson Cape", cat: "cosmetic", desc: "A dashing red cape.", icon: "🧣", value: 100, rarity: "rare", cosmetic: { slot: "cape", color: "#a51d2d" } }),
    I({ id: "cape_royal", name: "Royal Blue Cape", cat: "cosmetic", desc: "Worn by the Co-Princes' envoys.", icon: "🧣", value: 150, rarity: "rare", cosmetic: { slot: "cape", color: "#1f3f9a" } }),
    I({ id: "cape_forest", name: "Forest Cape", cat: "cosmetic", desc: "Woven by the shepherds of Incles.", icon: "🧣", value: 80, rarity: "common", cosmetic: { slot: "cape", color: "#2f6b2f" } }),
    I({ id: "cape_night", name: "Midnight Cape", cat: "cosmetic", desc: "Shimmers like the night sky.", icon: "🧣", value: 250, rarity: "epic", cosmetic: { slot: "cape", color: "#20163a" } }),
    I({ id: "cape_golden", name: "Golden Cape of Heroes", cat: "cosmetic", desc: "Only true heroes may wear it.", icon: "🧣", value: 400, rarity: "legendary", cosmetic: { slot: "cape", color: "#c9a227" } }),
    I({ id: "hat_hood", name: "Shepherd's Hood", cat: "cosmetic", desc: "Warm wool hood.", icon: "🧢", value: 40, rarity: "common", cosmetic: { slot: "hat", hat: "hood", color: "#6b5b45" } }),
    I({ id: "hat_cap", name: "Explorer's Cap", cat: "cosmetic", desc: "For those who climb every peak.", icon: "🧢", value: 60, rarity: "common", cosmetic: { slot: "hat", hat: "cap", color: "#7a2e2e" } }),
    I({ id: "hat_circlet", name: "Golden Circlet", cat: "cosmetic", desc: "A circlet from the Old Kings.", icon: "👑", value: 300, rarity: "epic", cosmetic: { slot: "hat", hat: "circlet", color: "#d8c070" } }),
    // ---------------- key / quest items
    I({ id: "old_crown", name: "Crown of the Old Kings", cat: "key", desc: "An ancient crown recovered from the vault beneath the ruins.", icon: "👑", value: 0, rarity: "epic" }),
    I({ id: "spirit_lantern", name: "Spirit Lantern", cat: "key", desc: "A lantern containing an ancient spirit flame.", icon: "🏮", value: 0, rarity: "rare" }),
    I({ id: "pere_scarf", name: "Pere's Scarf", cat: "key", desc: "A blue wool scarf. It belongs to the shepherd Pere.", icon: "🧣", value: 0, rarity: "common" }),
    I({ id: "vault_key", name: "Rune Key", cat: "key", desc: "Opens the vault of the Old Kings.", icon: "🗝️", value: 0, rarity: "rare" }),
    // ---------------- shards
    I({ id: "shard_red", name: "Red Shard", cat: "shard", desc: "The shard of Fire, won from the Flame Beast.", icon: "♦", value: 0, rarity: "legendary", shard: "red" }),
    I({ id: "shard_green", name: "Green Shard", cat: "shard", desc: "The shard of Nature, won from the Forest Guardian.", icon: "♦", value: 0, rarity: "legendary", shard: "green" }),
    I({ id: "shard_blue", name: "Blue Shard", cat: "shard", desc: "The shard of Ice, won from the Frost Dragon.", icon: "♦", value: 0, rarity: "legendary", shard: "blue" }),
    I({ id: "shard_white", name: "White Shard", cat: "shard", desc: "The shard of Light, won from the Shadow Knight.", icon: "♦", value: 0, rarity: "legendary", shard: "white" }),
    I({ id: "shard_yellow", name: "Yellow Shard", cat: "shard", desc: "The shard of Lightning, won from the Thunder Titan.", icon: "♦", value: 0, rarity: "legendary", shard: "yellow" }),
  ].map((d) => [d.id, d]),
);

export function item(id: string): ItemDef {
  const d = ITEMS[id];
  if (!d) throw new Error("Unknown item " + id);
  return d;
}

export const RARITY_COLOR: Record<Rarity, string> = {
  common: "#d8d2c0",
  rare: "#5fb4ff",
  epic: "#c77dff",
  legendary: "#ffcf4d",
};
