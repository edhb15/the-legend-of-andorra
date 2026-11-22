import type { Game } from "../core/Game";
import { formatTime } from "../core/MathUtil";

export interface SaveMeta {
  slot: string;
  day: number;
  time: string;
  shards: number;
  place: string;
  savedAt: number;
}

const PREFIX = "loa.save.";
const VERSION = 1;

/** Persists the whole adventure to localStorage (autosave + three manual slots). */
export class SaveSystem {
  private lastAuto = 0;
  private periodic = 0;
  started = false;

  constructor(private game: Game) {}

  private storage(): Storage | null {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  slots(): (SaveMeta | null)[] {
    return ["auto", "1", "2", "3"].map((s) => this.meta(s));
  }

  meta(slot: string): SaveMeta | null {
    try {
      const raw = this.storage()?.getItem(PREFIX + slot);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return d.meta ?? null;
    } catch {
      return null;
    }
  }

  hasAny(): boolean {
    return this.slots().some((s) => s !== null);
  }

  latestSlot(): string | null {
    let best: SaveMeta | null = null;
    for (const s of this.slots()) if (s && (!best || s.savedAt > best.savedAt)) best = s;
    return best?.slot ?? null;
  }

  private placeName(): string {
    const g = this.game;
    if (g.interiors.current) return g.interiors.current.def.name;
    const p = g.player.position;
    let best = "the wilds of Andorra";
    let bd = 250;
    for (const v of g.world.villages) {
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d < bd) {
        bd = d;
        best = v.name;
      }
    }
    return best;
  }

  serialize(slot: string): any {
    const g = this.game;
    const player = g.player.serialize();
    if (g.interiors.current) {
      const site = g.world.site(g.interiors.current.def.siteId);
      const m = site.anchors.mouth ?? { x: site.x, y: site.y, z: site.z };
      player.pos = [m.x + Math.sin(site.yaw) * 3, m.y, m.z + Math.cos(site.yaw) * 3];
    }
    return {
      version: VERSION,
      meta: { slot, day: g.time.day, time: formatTime(g.time.minutes), shards: g.inventory.shards().length, place: this.placeName(), savedAt: Date.now() } as SaveMeta,
      time: g.time.serialize(),
      inventory: g.inventory.serialize(),
      player,
      magic: g.magic.serialize(),
      quests: g.quests.serialize(),
      bosses: g.bosses.serialize(),
      treasure: g.treasure.serialize(),
      npcs: g.npcs.serialize(),
      poison: g.poison.serialize(),
      evolution: g.evolution.serialize(),
      enemies: g.enemies.serialize(),
      flags: g.flags,
      discovered: [...g.discovered],
      victory: g.victory,
      deaths: g.respawn.deaths,
    };
  }

  save(slot: string): boolean {
    const g = this.game;
    if (g.player.dead || g.state === "loading" || g.state === "title") return false;
    try {
      this.storage()?.setItem(PREFIX + slot, JSON.stringify(this.serialize(slot)));
      if (slot !== "auto") g.ui.toast("Game saved", "good");
      return true;
    } catch (e) {
      console.warn("save failed", e);
      g.ui.toast("Could not save the game (storage unavailable)", "warn");
      return false;
    }
  }

  autosave(reason: string): void {
    const g = this.game;
    if (g.state === "title" || g.state === "loading" || g.player?.dead || g.bosses.active) return;
    const now = performance.now();
    if (now - this.lastAuto < 8000 && reason !== "victory") return;
    this.lastAuto = now;
    if (this.save("auto")) g.ui.autosaveIcon();
  }

  /** Load a slot. If a game already ran in this page, reload first for a pristine world. */
  requestLoad(slot: string): void {
    if (this.started) {
      try {
        sessionStorage.setItem("loa.pendingLoad", slot);
      } catch {
        /* ignore */
      }
      location.reload();
      return;
    }
    this.load(slot);
  }

  requestNewGame(): boolean {
    if (this.started) {
      try {
        sessionStorage.setItem("loa.pendingNew", "1");
      } catch {
        /* ignore */
      }
      location.reload();
      return false;
    }
    return true;
  }

  load(slot: string): boolean {
    const g = this.game;
    let d: any;
    try {
      const raw = this.storage()?.getItem(PREFIX + slot);
      if (!raw) return false;
      d = JSON.parse(raw);
    } catch (e) {
      console.warn("load failed", e);
      return false;
    }
    g.interiors.resetToOverworld();
    g.time.deserialize(d.time);
    g.inventory.deserialize(d.inventory);
    g.player.deserialize(d.player);
    g.magic.deserialize(d.magic);
    g.npcs.deserialize(d.npcs);
    g.quests.deserialize(d.quests);
    g.bosses.deserialize(d.bosses);
    g.treasure.deserialize(d.treasure);
    g.poison.deserialize(d.poison);
    g.enemies.deserialize(d.enemies);
    g.flags = d.flags ?? {};
    g.discovered = new Set(d.discovered ?? []);
    g.victory = d.victory ?? 0;
    g.respawn.deaths = d.deaths ?? 0;
    g.evolution.deserialize(d.evolution);
    this.started = true;
    return true;
  }

  update(dt: number): void {
    const g = this.game;
    if (g.state !== "playing") return;
    this.periodic += dt;
    if (this.periodic > 180) {
      this.periodic = 0;
      this.autosave("periodic");
    }
  }
}
