import { Vector3 } from "@babylonjs/core";
import type { Game } from "../core/Game";
import { wrapAngle, yawTo } from "../core/MathUtil";

export interface Interactable {
  id: string;
  pos: () => Vector3;
  radius: number;
  label: () => string;
  enabled?: () => boolean;
  onInteract: () => void;
  interior?: string | null;
  priority?: number;
}

/** Finds the best nearby interactable, shows the prompt and handles [E]. */
export class InteractionSystem {
  private list = new Map<string, Interactable>();
  current: Interactable | null = null;

  constructor(private game: Game) {}

  add(i: Interactable): void {
    this.list.set(i.id, i);
  }
  remove(id: string): void {
    this.list.delete(id);
  }
  get(id: string): Interactable | undefined {
    return this.list.get(id);
  }

  update(dt: number): void {
    const g = this.game;
    const p = g.player;
    const interior = g.interiors.current?.def.id ?? null;
    let best: Interactable | null = null;
    let bestScore = Infinity;
    if (!p.dead && !p.frozen) {
      for (const it of this.list.values()) {
        if ((it.interior ?? null) !== interior) continue;
        const pos = it.pos();
        const d = Math.hypot(pos.x - p.position.x, pos.z - p.position.z);
        if (d > it.radius || Math.abs(pos.y - p.position.y) > 4) continue;
        if (it.enabled && !it.enabled()) continue;
        const ang = Math.abs(wrapAngle(yawTo(p.position.x, p.position.z, pos.x, pos.z) - p.yaw));
        const score = d + ang * 1.2 - (it.priority ?? 0);
        if (score < bestScore) {
          bestScore = score;
          best = it;
        }
      }
    }
    this.current = best;
    g.ui.setPrompt(best ? best.label() : null);
    if (best && g.input.wasPressed("KeyE")) {
      try {
        best.onInteract();
      } catch (e) {
        console.error("interaction failed", e);
      }
    }
    // quick heal & inventory pickups ride along here
    if (g.input.wasPressed("KeyH")) g.inventory.quickHeal();
    g.inventory.update(dt);
  }
}
