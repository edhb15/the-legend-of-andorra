import { Vector3 } from "@babylonjs/core";
import type { Game } from "../core/Game";
import { clamp01, easeInOut, lerp } from "../core/MathUtil";

/**
 * Dramatic death sequence: slow motion, the hero falls, the camera circles the body, the world
 * darkens under a red tint, "WASTED" — then fade to black and wake in the home village.
 * Items, shards, quests, defeated bosses, the day and the cloud all persist.
 */
export class RespawnSystem {
  private t = -1;
  private orbitA = 0;
  private center = new Vector3();
  deaths = 0;

  constructor(private game: Game) {}

  get active(): boolean {
    return this.t >= 0;
  }

  startDeath(): void {
    const g = this.game;
    if (this.t >= 0) return;
    this.t = 0;
    this.deaths++;
    g.state = "dead";
    g.input.exitPointerLock();
    g.timeScale = 0.4;
    g.audio.setMusic("death");
    g.audio.sfx("deathSting");
    g.ui.hud(false);
    g.ui.setPoison(0, false, false);
    this.center.copyFrom(g.player.position);
    this.orbitA = g.camera.yaw + Math.PI;
    g.combat.lockTarget = null;
  }

  update(dt: number): void {
    if (this.t < 0) return;
    const g = this.game;
    const raw = g.realDt;
    this.t += raw;
    const t = this.t;
    if (t > 1.2) g.timeScale = 1;
    // camera slowly circles the fallen hero
    this.orbitA += raw * 0.22;
    const r = lerp(4.5, 7.5, clamp01(t / 7));
    const h = lerp(2.2, 4.5, clamp01(t / 7));
    const c = this.center;
    g.camera.setCinematic(new Vector3(c.x + Math.sin(this.orbitA) * r, c.y + h, c.z + Math.cos(this.orbitA) * r), c.add(new Vector3(0, 0.6, 0)));
    // world darkens + red tint
    const dark = easeInOut(clamp01((t - 0.6) / 2));
    g.ui.deathTint(dark);
    const ip = g.pipeline?.imageProcessing;
    if (ip) {
      ip.exposure = lerp(1.3, 0.55, dark);
      if (ip.colorCurves) ip.colorCurves.globalSaturation = lerp(0, -75, dark);
    }
    if (t > 2.0 && !(this as any).shown) {
      (this as any).shown = true;
      g.ui.wasted(true);
      g.audio.sfx("wasted");
    }
    if (t > 6.6 && !(this as any).faded) {
      (this as any).faded = true;
      void g.ui.fade(1, 1.0);
    }
    if (t > 7.8) this.respawn();
    void dt;
  }

  private respawn(): void {
    const g = this.game;
    this.t = -1;
    (this as any).shown = false;
    (this as any).faded = false;
    g.bosses.resetActive();
    g.combat.clearHostile();
    if (g.interiors.current) g.interiors.resetToOverworld();
    const v = g.world.homeVillage();
    const x = v.waystone.x + 2.5, z = v.waystone.z + 2.5;
    g.player.revive();
    g.player.rig.tilt.rotation.x = 0;
    g.player.teleport(x, g.physics.groundHeight(x, z, 1e5), z, 0);
    g.poison.exposure = 0;
    g.ui.wasted(false);
    g.ui.deathTint(0);
    const ip = g.pipeline?.imageProcessing;
    if (ip) {
      ip.exposure = 1.3;
      if (ip.colorCurves) ip.colorCurves.globalSaturation = 0;
    }
    g.camera.release();
    g.ui.hud(true);
    g.state = "playing";
    g.audio.setLocation("village", true);
    void g.ui.fade(0, 1.2);
    g.ui.toast(`You awaken in ${v.name}. The cloud has not waited for you.`, "info");
    g.input.requestPointerLock();
  }
}
