import type { Game } from "../core/Game";
import { prefersTouch, touchOverride } from "../core/Device";

/**
 * On-screen controls for phones and tablets.
 *
 * - Left side of the screen: a floating joystick (put your thumb down anywhere and drag).
 * - Right side of the screen: drag to turn the camera.
 * - Bottom right: attack (tap for combos, hold for the spin attack), jump, dodge, block (hold),
 *   sprint (toggle), lock-on and quick heal.
 * - Top centre: inventory, map, quest log, menu and full screen.
 * - The interaction prompt and the Rainbow Sword ability icons become tappable.
 *
 * Everything is fed into the same Input state the keyboard and mouse use, so gameplay code
 * doesn't know the difference.
 */

const STICK_R = 54; // how far the knob travels, in CSS pixels
const DEADZONE = 0.12;
const LOOK_GAIN = 2.6; // finger pixels -> mouse pixels

type Release = () => void;

const el = (tag: string, cls: string, html = ""): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const FULLSCREEN_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`;

export class TouchControls {
  active = false;
  private surface: HTMLElement;
  private layer: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private skipBtn: HTMLElement;
  private stickId: number | null = null;
  private ox = 0;
  private oy = 0;
  private lookId: number | null = null;
  private lx = 0;
  private ly = 0;
  private held = new Map<number, Release>();
  private sprintOn = false;
  private stickIdle = 0;
  private shown = false;
  private btns: Record<string, HTMLElement> = {};

  constructor(private game: Game, root: HTMLElement) {
    this.surface = el("div", "touch-surface hidden");
    this.layer = el(
      "div",
      "touch-ui hidden",
      `<div class="t-stick"><div class="t-knob"></div></div>
      <div class="t-top">
        <button data-b="inventory" aria-label="Inventory">🎒</button>
        <button data-b="map" aria-label="Map">🗺️</button>
        <button data-b="quests" aria-label="Quest log">📜</button>
        <button data-b="pause" aria-label="Menu">☰</button>
        <button data-b="fullscreen" aria-label="Full screen">${FULLSCREEN_SVG}</button>
      </div>
      <div class="t-cluster">
        <button class="t-btn t-attack" data-b="attack" aria-label="Attack">⚔️<span>Attack</span></button>
        <button class="t-btn t-jump" data-b="jump" aria-label="Jump">⬆️<span>Jump</span></button>
        <button class="t-btn t-dodge" data-b="dodge" aria-label="Dodge">💨<span>Dodge</span></button>
        <button class="t-btn t-block" data-b="block" aria-label="Block">🛡️<span>Block</span></button>
        <button class="t-btn t-sprint" data-b="sprint" aria-label="Sprint">🏃<span>Sprint</span></button>
        <button class="t-btn t-lock" data-b="lock" aria-label="Lock on">🎯<span>Lock</span></button>
        <button class="t-btn t-heal" data-b="heal" aria-label="Quick heal">🧪<span>Heal</span><b class="t-count"></b></button>
      </div>
      <div class="t-rotate"><div class="t-rot-icon">↻</div><p>Turn your device sideways for the best view</p><button class="btn small" data-b="rotateok">Play anyway</button></div>`,
    );
    this.skipBtn = el("button", "btn small touch-skip hidden", "Skip ▸▸");
    root.appendChild(this.surface);
    root.appendChild(this.layer);
    root.appendChild(this.skipBtn);
    this.stick = this.layer.querySelector(".t-stick")!;
    this.knob = this.layer.querySelector(".t-knob")!;
    this.layer.querySelectorAll<HTMLElement>("[data-b]").forEach((b) => (this.btns[b.dataset.b!] = b));
    this.bindSurface();
    this.bindButtons();
    this.skipBtn.addEventListener("click", () => this.game.cinematics.skip());

    const fsOk = !!(document.fullscreenEnabled || (document as any).webkitFullscreenEnabled);
    if (!fsOk) this.btns.fullscreen.classList.add("hidden");
    // stop the page itself from zooming, scrolling or showing callouts while playing
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    this.layer.addEventListener("contextmenu", (e) => e.preventDefault());
    this.surface.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("blur", () => this.releaseAll());
    window.addEventListener("resize", () => this.restStick());

    // pick the mode: setting first, then the device, then whatever the player actually touches
    window.addEventListener(
      "pointerdown",
      (e) => {
        if (this.game.settings.touchControls !== "auto" || touchOverride() !== null) return;
        if (e.pointerType === "touch" || e.pointerType === "pen") this.setActive(true);
        else if (e.pointerType === "mouse") this.setActive(false);
      },
      true,
    );
    this.applySetting();
  }

  /** Re-read the "Touch controls" setting. */
  applySetting(): void {
    const s = this.game.settings.touchControls;
    const o = touchOverride();
    this.setActive(o !== null ? o : s === "on" ? true : s === "off" ? false : prefersTouch());
  }

  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    this.game.input.touchMode = on;
    document.body.classList.toggle("touch", on);
    if (on) this.game.input.exitPointerLock();
    this.releaseAll();
    this.shown = false;
    this.surface.classList.add("hidden");
    this.layer.classList.add("hidden");
    this.game.ui?.onTouchModeChanged();
  }

  // ------------------------------------------------------------------ joystick & camera
  private bindSurface(): void {
    const s = this.surface;
    s.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try {
        s.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (e.clientX < window.innerWidth * 0.45 && this.stickId === null) {
        this.stickId = e.pointerId;
        this.ox = e.clientX;
        this.oy = e.clientY;
        this.stick.classList.add("live");
        this.placeStick(0, 0);
      } else if (this.lookId === null) {
        this.lookId = e.pointerId;
        this.lx = e.clientX;
        this.ly = e.clientY;
      }
    });
    s.addEventListener("pointermove", (e) => {
      if (e.pointerId === this.stickId) {
        let dx = e.clientX - this.ox;
        let dy = e.clientY - this.oy;
        const d = Math.hypot(dx, dy);
        if (d > STICK_R) {
          // the stick follows a thumb that drifts past its edge
          this.ox += (dx / d) * (d - STICK_R);
          this.oy += (dy / d) * (d - STICK_R);
          dx = e.clientX - this.ox;
          dy = e.clientY - this.oy;
        }
        this.placeStick(dx, dy);
        const m = Math.min(1, Math.hypot(dx, dy) / STICK_R);
        const k = m < DEADZONE ? 0 : (m - DEADZONE) / (1 - DEADZONE) / Math.max(m, 1e-6);
        this.game.input.setMoveAxis((dx / STICK_R) * k, (-dy / STICK_R) * k);
      } else if (e.pointerId === this.lookId) {
        this.game.input.addLook((e.clientX - this.lx) * LOOK_GAIN, (e.clientY - this.ly) * LOOK_GAIN);
        this.lx = e.clientX;
        this.ly = e.clientY;
      }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.stickId) this.endStick();
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    s.addEventListener("pointerup", end);
    s.addEventListener("pointercancel", end);
    s.addEventListener("lostpointercapture", end);
  }

  private placeStick(dx: number, dy: number): void {
    this.stick.style.left = `${this.ox}px`;
    this.stick.style.top = `${this.oy}px`;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  private endStick(): void {
    this.stickId = null;
    this.game.input.setMoveAxis(0, 0);
    this.stick.classList.remove("live");
    this.restStick();
  }

  /** Where the joystick waits when no thumb is on it. */
  private restStick(): void {
    if (this.stickId !== null) return;
    this.ox = Math.max(96, window.innerWidth * 0.12);
    this.oy = window.innerHeight - Math.max(96, window.innerHeight * 0.2);
    this.placeStick(0, 0);
  }

  // ------------------------------------------------------------------ buttons
  private bindButtons(): void {
    const inp = this.game.input;
    const key = (code: string) => ({ down: () => inp.simulateKey(code, true), up: () => inp.simulateKey(code, false) });
    const mouse = (b: number) => ({ down: () => inp.simulateMouse(b, true), up: () => inp.simulateMouse(b, false) });
    const actions: Record<string, { down: () => void; up: () => void }> = {
      attack: mouse(0),
      block: mouse(2),
      jump: key("Space"),
      dodge: key("KeyQ"),
      lock: key("Tab"),
      heal: key("KeyH"),
      inventory: key("KeyI"),
      map: key("KeyM"),
      quests: key("KeyJ"),
      pause: key("Escape"),
    };
    for (const [name, b] of Object.entries(this.btns)) {
      if (name === "fullscreen") {
        b.addEventListener("click", () => this.toggleFullscreen());
        continue;
      }
      if (name === "rotateok") {
        b.addEventListener("click", () => this.layer.classList.add("rot-ok"));
        continue;
      }
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          b.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        if (name === "sprint") return this.setSprint(!this.sprintOn);
        const a = actions[name];
        if (!a) return;
        this.held.get(e.pointerId)?.();
        b.classList.add("on");
        a.down();
        this.held.set(e.pointerId, () => {
          a.up();
          b.classList.remove("on");
        });
      });
      const release = (e: PointerEvent) => {
        const r = this.held.get(e.pointerId);
        if (!r) return;
        this.held.delete(e.pointerId);
        r();
      };
      b.addEventListener("pointerup", release);
      b.addEventListener("pointercancel", release);
      b.addEventListener("lostpointercapture", release);
    }
  }

  private setSprint(on: boolean): void {
    if (on === this.sprintOn) return;
    this.sprintOn = on;
    // a couple of seconds' grace to start moving after switching sprint on while standing still
    this.stickIdle = -2;
    this.game.input.simulateKey("ShiftLeft", on);
    this.btns.sprint.classList.toggle("lit", on);
  }

  private toggleFullscreen(): void {
    const d = document as any;
    const de = document.documentElement as any;
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      (d.exitFullscreen ?? d.webkitExitFullscreen)?.call(d);
      return;
    }
    const req = de.requestFullscreen ?? de.webkitRequestFullscreen;
    if (!req) return;
    Promise.resolve(req.call(de, { navigationUI: "hide" }))
      .then(() => (screen.orientation as any)?.lock?.("landscape"))
      .catch(() => {});
  }

  /** Let go of everything: used when menus open, on blur and when switching modes. */
  releaseAll(): void {
    for (const r of this.held.values()) r();
    this.held.clear();
    if (this.stickId !== null) this.endStick();
    this.lookId = null;
    this.game.input.setMoveAxis(0, 0);
    this.setSprint(false);
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number): void {
    const g = this.game;
    this.skipBtn.classList.toggle("hidden", !(this.active && g.state === "cinematic"));
    const show = this.active && g.state === "playing" && g.ui.panel === "none" && !g.dialogue.active;
    if (show !== this.shown) {
      this.shown = show;
      this.surface.classList.toggle("hidden", !show);
      this.layer.classList.toggle("hidden", !show);
      if (!show) this.releaseAll();
      else this.restStick();
    }
    if (!show) return;
    // sprint switches itself off once you stop moving
    if (this.sprintOn) {
      this.stickIdle = this.stickId === null ? this.stickIdle + dt : Math.min(0, this.stickIdle);
      if (this.stickIdle > 0.6) this.setSprint(false);
    }
    const potions = g.inventory.count("health_potion") + g.inventory.count("greater_potion");
    const c = this.btns.heal.querySelector(".t-count") as HTMLElement;
    const txt = String(potions);
    if (c.textContent !== txt) c.textContent = txt;
    this.btns.heal.classList.toggle("empty", potions === 0);
    this.btns.lock.classList.toggle("lit", !!(g.combat.lockTarget && g.combat.lockTarget.alive));
  }
}
