import { Vector3, Color4, Color3 } from "@babylonjs/core";
import type { Game } from "../core/Game";
import type { Boss } from "../entities/bosses/Boss";
import { easeInOut, lerp } from "../core/MathUtil";
import { geoToWorld } from "../world/AndorraData";

/** Scripted camera sequences: boss intros, the opening flyover, the ending. */
export class CinematicManager {
  playing = false;
  private skipFlag = false;
  private tasks: ((dt: number) => boolean)[] = [];

  constructor(private game: Game) {}

  skip(): void {
    if (this.playing) this.skipFlag = true;
  }

  update(dt: number): void {
    if (this.playing && (this.game.input.rawPressed("Escape") || this.game.input.rawPressed("Enter"))) this.skip();
    for (let i = this.tasks.length - 1; i >= 0; i--) if (!this.tasks[i](dt)) this.tasks.splice(i, 1);
  }

  begin(): void {
    const g = this.game;
    this.playing = true;
    this.skipFlag = false;
    g.state = "cinematic";
    g.ui.letterbox(true);
    g.input.exitPointerLock();
  }
  end(): void {
    const g = this.game;
    this.playing = false;
    g.ui.letterbox(false);
    g.ui.subtitle(null);
    g.camera.release();
    if (g.state === "cinematic") g.state = "playing";
    g.input.requestPointerLock();
  }

  wait(s: number): Promise<void> {
    return new Promise((res) => {
      let t = 0;
      this.tasks.push((dt) => {
        t += dt;
        if (t >= s || this.skipFlag) {
          res();
          return false;
        }
        return true;
      });
    });
  }

  /** Move the camera from A to B while looking from LA to LB. */
  shot(fromPos: Vector3, toPos: Vector3, fromLook: Vector3, toLook: Vector3, dur: number): Promise<void> {
    const cam = this.game.camera;
    return new Promise((res) => {
      let t = 0;
      this.tasks.push((dt) => {
        t += dt;
        const k = this.skipFlag ? 1 : easeInOut(Math.min(1, t / dur));
        cam.setCinematic(Vector3.Lerp(fromPos, toPos, k), Vector3.Lerp(fromLook, toLook, k));
        if (k >= 1) {
          res();
          return false;
        }
        return true;
      });
    });
  }

  orbit(center: Vector3, radius: number, height: number, a0: number, a1: number, dur: number, lookOffset = new Vector3()): Promise<void> {
    const cam = this.game.camera;
    return new Promise((res) => {
      let t = 0;
      this.tasks.push((dt) => {
        t += dt;
        const k = this.skipFlag ? 1 : easeInOut(Math.min(1, t / dur));
        const a = lerp(a0, a1, k);
        cam.setCinematic(new Vector3(center.x + Math.sin(a) * radius, center.y + height, center.z + Math.cos(a) * radius), center.add(lookOffset));
        if (k >= 1) {
          res();
          return false;
        }
        return true;
      });
    });
  }

  // ------------------------------------------------------------------------------------------
  async bossIntro(b: Boss, color: string): Promise<void> {
    const g = this.game;
    this.begin();
    const p = g.player.position.clone();
    const bp = b.position.clone();
    const look = bp.add(new Vector3(0, b.height * 0.6, 0));
    const dir = bp.subtract(p).normalize();
    const camA = p.add(new Vector3(-dir.x * 6, 3, -dir.z * 6));
    const close = b.height * 1.1 + 4;
    const camB = bp.add(new Vector3(-dir.x * close + dir.z * 2, b.height * 0.45, -dir.z * close - dir.x * 2));
    g.player.velocity.setAll(0);
    await this.shot(camA, camB, p.add(new Vector3(0, 2, 0)), look, 1.8);
    g.audio.sfx("bossRoar", bp);
    g.camera.shake(1);
    b.state = "intro";
    const c = Color3.FromHexString(color);
    g.fx.burst(look, { count: 80, color1: new Color4(c.r, c.g, c.b, 1), color2: new Color4(1, 1, 1, 0.8), size: [0.2, 0.8], speed: [3, 10] });
    g.ui.bossTitle(b.name, b.title, color);
    const startAng = Math.atan2(camB.x - bp.x, camB.z - bp.z);
    await this.orbit(bp, close + 2, b.height * 0.55, startAng, startAng + 0.8, 3.0, new Vector3(0, b.height * 0.6, 0));
    this.end();
  }

  async intro(): Promise<void> {
    const g = this.game;
    this.begin();
    g.ui.fadeInstant(1);
    const coma = geoToWorld(42.5913, 1.4434);
    const home = g.world.homeVillage();
    const center = new Vector3(0, 0, 0);
    await g.ui.fade(0, 1.5);
    g.ui.subtitle("Long ago, five guardians hid five magical shards across the mountains of Andorra…");
    await this.orbit(center.add(new Vector3(0, 300, 0)), 2600, 700, -0.6, 0.0, 7);
    g.ui.subtitle("Now Zorg, Lord of the Dark Side, has returned to his cave beneath Comapedrosa.");
    const cy = g.terrain.getHeight(coma.x, coma.z);
    await this.shot(new Vector3(coma.x + 700, cy + 200, coma.z - 500), new Vector3(coma.x + 350, cy + 80, coma.z - 250), new Vector3(coma.x, cy, coma.z), new Vector3(coma.x, cy - 20, coma.z), 6);
    g.ui.subtitle("His poisonous cloud surrounds the country. In fourteen days, it will swallow everything.");
    await this.orbit(new Vector3(0, 150, 0), 3400, 450, 0.4, 1.4, 7);
    g.ui.subtitle("In the village of Ordino, a young adventurer awakens…");
    const pp = g.player.position;
    await this.shot(new Vector3(home.x + 120, home.y + 80, home.z - 140), new Vector3(pp.x - Math.sin(g.player.yaw) * 7, pp.y + 3.5, pp.z - Math.cos(g.player.yaw) * 7), new Vector3(home.x, home.y, home.z), pp.add(new Vector3(0, 1.5, 0)), 5);
    g.ui.subtitle(null);
    this.end();
    g.ui.bigTitle("DAY 1", "14 days remain", "#e8c66a");
  }

  /** The great ending after Zorg falls. */
  async zorgDefeated(b: Boss): Promise<void> {
    const g = this.game;
    this.begin();
    const bp = b.position.clone();
    await this.orbit(bp, 22, 9, g.camera.yaw + Math.PI, g.camera.yaw + Math.PI + 1.2, 3.2, new Vector3(0, 5, 0));
    // dark energy explodes into particles
    for (let k = 0; k < 6; k++) {
      setTimeout(() => {
        g.fx.deathPuff(bp.add(new Vector3((Math.random() - 0.5) * 6, 3 + Math.random() * 5, (Math.random() - 0.5) * 6)), 3, new Color4(0.1, 0.02, 0.15, 0.95));
        g.audio.sfx("explosion", bp);
        g.camera.shake(0.8);
      }, k * 250);
    }
    await this.wait(1.6);
    const cols = ["#ff3b30", "#ffd60a", "#34e05a", "#3ab0ff", "#f4f4ff", "#c77dff"];
    for (const hex of cols) {
      const c = Color3.FromHexString(hex);
      g.fx.burst(bp.add(new Vector3(0, 5, 0)), { count: 140, color1: new Color4(c.r, c.g, c.b, 1), color2: new Color4(1, 1, 1, 1), size: [0.2, 1.2], speed: [8, 25], life: [1, 2.5], tex: "star", gravity: -1 });
    }
    g.fx.flashLight(bp.add(new Vector3(0, 6, 0)), new Color3(1, 1, 1), 15, 120, 2.5);
    g.ui.screenFlash(1.2, "#ffffff");
    g.audio.sfx("victoryBlast");
    b.dispose();
    await this.wait(2);
    // back to the surface: the cloud dissipates
    await g.ui.fade(1, 1.2);
    g.interiors.resetToOverworld();
    const site = g.world.site("zorgcave");
    const m = site.anchors.mouth ?? new Vector3(site.x, site.y, site.z);
    g.player.teleport(m.x + Math.sin(site.yaw) * 4, g.physics.groundHeight(m.x + Math.sin(site.yaw) * 4, m.z + Math.cos(site.yaw) * 4, 1e5), m.z + Math.cos(site.yaw) * 4, site.yaw);
    g.audio.setMusic("ending");
    if (g.time.hour < 7 || g.time.hour > 17) g.time.minutes = Math.floor(g.time.minutes / 1440) * 1440 + 9 * 60;
    let t = 0;
    this.tasks.push((dt) => {
      t += dt;
      g.poison.cleansing = Math.min(1, t / 9);
      g.victory = Math.min(1, t / 9);
      return t < 9;
    });
    await g.ui.fade(0, 1.5);
    await this.orbit(new Vector3(0, 150, 0), 2700, 600, 2.0, 2.9, 9);
    g.ui.bigTitle("ANDORRA HAS BEEN SAVED!", "The poison cloud is gone. The sky shines again.", "#ffe680", 6);
    const home = g.world.homeVillage();
    g.flags.victory = true;
    await this.shot(new Vector3(home.x + 60, home.y + 40, home.z - 60), new Vector3(home.x + 20, home.y + 10, home.z - 25), new Vector3(home.x, home.y + 2, home.z), new Vector3(home.x, home.y + 1.5, home.z), 7);
    await this.wait(2);
    this.end();
    g.state = "ending";
    g.save.autosave("victory");
    await g.ui.credits();
    g.state = "playing";
    g.ui.toast("Andorra is free! Explore as long as you like.", "good");
  }

  /** Time ran out. */
  async doom(): Promise<void> {
    const g = this.game;
    if (g.flags.doomed || g.victory > 0) return;
    g.flags.doomed = true;
    this.begin();
    g.audio.setMusic("death");
    await this.orbit(new Vector3(0, 100, 0), 2500, 500, 0, 1, 7);
    g.ui.bigTitle("ANDORRA HAS FALLEN", "The cloud has consumed every valley. Zorg reigns.", "#9a5aff", 6);
    await this.wait(6);
    this.end();
    g.state = "ending";
    g.ui.showGameOver();
  }
}
