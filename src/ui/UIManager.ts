import { Vector3, Matrix, TransformNode } from "@babylonjs/core";
import type { Game } from "../core/Game";
import type { Combatant } from "../systems/CombatSystem";
import { ITEMS, ItemDef, RARITY_COLOR, SHARD_INFO, SHARD_ORDER, item } from "../data/items";
import { QUESTS } from "../systems/QuestManager";
import { MapView } from "./MapView";
import { formatTime, clamp01 } from "../core/MathUtil";
import { DOOM_DAYS } from "../config";

type Panel = "none" | "pause" | "inventory" | "map" | "quests" | "shop" | "save" | "load" | "settings" | "controls" | "title" | "gameover";

const h = (tag: string, cls = "", html = ""): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

interface Floater {
  el: HTMLElement;
  pos: Vector3;
  t: number;
  life: number;
  vy: number;
}

export class UIManager {
  root: HTMLElement;
  map: MapView;
  panel: Panel = "none";
  private els: Record<string, HTMLElement> = {};
  private floaters: Floater[] = [];
  private speeches = new Map<string, { el: HTMLElement; node: TransformNode; t: number }>();
  private enemyBars = new Map<Combatant, HTMLElement>();
  private alerts: { el: HTMLElement; e: any; t: number }[] = [];
  private dlgDone: ((i: number) => void) | null = null;
  private dlgFull = "";
  private dlgShown = 0;
  private dlgChoices: string[] = [];
  private dlgSel = 0;
  private hpGhost = 1;
  private bossVisible = false;
  private invTab = "weapons";
  private invSel: string | null = null;
  private questSel = "main";
  private shopResolve: (() => void) | null = null;
  private menuReturn: Panel = "none";
  private miniCanvas!: HTMLCanvasElement;
  private miniT = 0;
  private titleResolve: ((action: string) => void) | null = null;
  private loadSlotsMode: "save" | "load" = "load";

  constructor(private game: Game) {
    this.root = document.getElementById("ui-root")!;
    this.map = new MapView(game);
    this.buildDOM();
  }

  // ------------------------------------------------------------------ DOM scaffold
  private add(name: string, el: HTMLElement, parent: HTMLElement = this.root): HTMLElement {
    this.els[name] = el;
    parent.appendChild(el);
    return el;
  }

  private buildDOM(): void {
    const R = this.root;
    this.add("poison", h("div", "poison-overlay"));
    this.add("dmg", h("div", "damage-flash"));
    const hud = this.add("hud", h("div", "hud hidden"));
    const vit = this.add("vitals", h("div", "vitals"), hud);
    this.add("hp", h("div", "bar hp", `<div class="ghost"></div><div class="fill"></div><div class="label"></div>`), vit);
    this.add("st", h("div", "bar st", `<div class="fill"></div><div class="label"></div>`), vit);
    this.add("en", h("div", "bar en hidden", `<div class="fill"></div>`), vit);
    const sh = this.add("shards", h("div", "shards"), vit);
    for (const c of SHARD_ORDER) {
      const d = h("div", "shard");
      d.style.color = SHARD_INFO[c].hex;
      d.dataset.c = c;
      d.title = SHARD_INFO[c].name;
      sh.appendChild(d);
    }
    this.add("coins", h("div", "coins"), vit);
    this.add("status", h("div", "status-icons"), vit);
    const clock = this.add("clock", h("div", "clock", `<div class="day"></div><div class="time"></div><div class="left"></div><div class="doom"><div></div></div>`), hud);
    void clock;
    const mm = this.add("minimap", h("div", "minimap", `<canvas width="360" height="360"></canvas><div class="n">N</div>`), hud);
    this.miniCanvas = mm.querySelector("canvas")!;
    this.add("tracker", h("div", "tracker"), hud);
    this.add("weapon", h("div", "weapon-box"), hud);
    this.add("abilities", h("div", "abilities hidden"), hud);
    this.add("prompt", h("div", "prompt hidden"), hud);
    this.add("boss", h("div", "boss-bar hidden", `<div class="bn"></div><div class="bt"></div><div class="bar"><div class="fill"></div></div><div class="phase"></div>`), hud);
    this.add("poisonWarn", h("div", "poison-warn hidden", "☠ POISON CLOUD ☠"), hud);
    this.add("crosshair", h("div", "crosshair hidden"), hud);
    this.add("toasts", h("div", "toasts"), hud);
    this.add("autosave", h("div", "autosave", "✦ Saving…"), hud);
    this.add("fps", h("div", "fps hidden"), hud);
    this.add("world", h("div", ""), R); // floaters & bars
    this.els.world.style.cssText = "position:absolute;inset:0;z-index:9;";
    this.add("lock", h("div", "lock-ret hidden"), this.els.world);
    this.add("loc", h("div", "loc-title", `<div class="t1"></div><div class="t2"></div>`));
    this.add("big", h("div", "big-title", `<div class="t1"></div><div class="rule"></div><div class="t2"></div>`));
    this.add("lbTop", h("div", "letterbox top"));
    this.add("lbBot", h("div", "letterbox bottom"));
    this.add("subtitle", h("div", "subtitle hidden"));
    this.add("deathTint", h("div", "death-tint"));
    this.add("deathTint2", h("div", "death-tint2"));
    this.add("wasted", h("div", "wasted", `WASTED<span class="wsub">The darkness claims another hero… for now</span>`));
    this.add("dialogue", h("div", "dialogue hidden", `<div class="who"></div><div class="txt"></div><div class="choices"></div><div class="more">▼</div>`));
    this.els.dialogue.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("choice")) return;
      this.advanceDialogue();
    });
    this.add("screen", h("div", "screen hidden"));
    this.add("mapview", h("div", "mapview hidden", `<canvas></canvas><div class="map-title">Andorra</div><div class="map-legend"></div><div class="map-help">Drag to pan · Wheel to zoom · Click to place a marker · Right-click to remove · M / Esc to close</div>`));
    this.map.attach(this.els.mapview.querySelector("canvas")!);
    this.add("flash", h("div", "screen-flash"));
    this.add("fade", h("div", "fade"));
    this.add("title", h("div", "title-screen"));
  }

  init(): void {
    this.map.buildBase();
    document.addEventListener("pointerlockchange", () => {
      if (!document.pointerLockElement && this.game.state === "playing" && this.panel === "none" && !this.game.dialogue.active) {
        // ESC in pointer lock: open pause
        setTimeout(() => {
          if (this.game.state === "playing" && this.panel === "none") this.openPanel("pause");
        }, 50);
      }
    });
    this.game.canvas.addEventListener("click", () => {
      if (this.game.state === "playing" && this.panel === "none") this.game.input.requestPointerLock();
    });
  }

  // ------------------------------------------------------------------ title & loading
  showLoading(): void {
    const t = this.els.title;
    t.classList.remove("hidden");
    t.innerHTML = `<div class="logo"><div class="sword"></div><div class="the">THE LEGEND OF</div><div class="name">ANDORRA</div><div class="tag">Five shards. Fourteen days. One kingdom of mountains.</div></div>
      <div class="loading"><div class="lb"><div></div></div><div class="ll">Preparing the mountains…</div></div>
      <div class="title-foot">Terrain: real elevation of Andorra · Built with Babylon.js</div>`;
  }
  setLoading(f: number, label: string): void {
    const bar = this.els.title.querySelector(".lb div") as HTMLElement | null;
    const ll = this.els.title.querySelector(".ll") as HTMLElement | null;
    if (bar) bar.style.width = `${Math.round(f * 100)}%`;
    if (ll) ll.textContent = label;
  }

  /** Title menu; resolves with "new" | "continue" | "load:slot". */
  showTitle(): Promise<string> {
    const g = this.game;
    this.panel = "title";
    const t = this.els.title;
    t.classList.remove("hidden");
    const hasSave = g.save.hasAny();
    const src = g.terrainSource === "maptiler" ? "MapTiler 3D terrain (live)" : g.terrainSource === "offline" ? "Real Andorra elevation (offline data)" : "Procedural approximation";
    t.innerHTML = `<div class="logo"><div class="sword"></div><div class="the">THE LEGEND OF</div><div class="name">ANDORRA</div><div class="tag">Five shards. Fourteen days. One kingdom of mountains.</div></div>
      <div class="panel menu interactive">
        <button class="btn" data-a="new">New Adventure</button>
        <button class="btn" data-a="continue" ${hasSave ? "" : "disabled"}>Continue</button>
        <button class="btn" data-a="load" ${hasSave ? "" : "disabled"}>Load Game</button>
        <button class="btn" data-a="settings">Settings</button>
        <button class="btn" data-a="controls">Controls</button>
        <div class="terrain-badge">Terrain: ${esc(src)}${g.terrainNote ? `<br><span class="note">${esc(g.terrainNote)}</span>` : ""}</div>
      </div>
      <div class="title-foot">WASD move · Mouse look · Click to attack · Click the screen to capture the mouse</div>`;
    return new Promise((res) => {
      this.titleResolve = res;
      t.querySelectorAll("button").forEach((b) =>
        b.addEventListener("click", () => {
          const a = (b as HTMLElement).dataset.a!;
          g.audio.sfx("uiClick");
          if (a === "settings") return this.openPanel("settings", "title");
          if (a === "controls") return this.openPanel("controls", "title");
          if (a === "load") return this.openSlots("load", "title");
          this.resolveTitle(a);
        }),
      );
    });
  }
  private resolveTitle(a: string): void {
    const r = this.titleResolve;
    this.titleResolve = null;
    this.els.title.classList.add("hidden");
    this.panel = "none";
    r?.(a);
  }
  hideTitle(): void {
    this.els.title.classList.add("hidden");
  }

  // ------------------------------------------------------------------ fades & titles
  fade(target: number, dur: number): Promise<void> {
    const el = this.els.fade;
    const from = parseFloat(el.style.opacity || "0");
    return new Promise((res) => {
      const t0 = performance.now();
      const step = () => {
        const k = clamp01((performance.now() - t0) / (dur * 1000));
        el.style.opacity = String(from + (target - from) * k);
        el.style.pointerEvents = target > 0.5 ? "auto" : "none";
        if (k < 1) requestAnimationFrame(step);
        else res();
      };
      step();
    });
  }
  fadeInstant(a: number): void {
    this.els.fade.style.opacity = String(a);
  }

  bigTitle(t1: string, t2: string, color = "#e8c66a", dur = 4): void {
    const el = this.els.big;
    el.classList.remove("show");
    void el.offsetWidth;
    (el.querySelector(".t1") as HTMLElement).textContent = t1;
    (el.querySelector(".t2") as HTMLElement).textContent = t2;
    el.style.color = color;
    el.style.setProperty("--dur", `${dur}s`);
    el.classList.add("show");
  }
  bossTitle(name: string, title: string, color: string): void {
    this.bigTitle(name.toUpperCase(), title, color, 3.6);
  }
  locationTitle(name: string, desc: string): void {
    const el = this.els.loc;
    el.classList.remove("show");
    void el.offsetWidth;
    (el.querySelector(".t1") as HTMLElement).textContent = name;
    (el.querySelector(".t2") as HTMLElement).textContent = desc;
    el.classList.add("show");
    this.game.audio.sfx("lore");
  }
  centerText(text: string, dur: number): void {
    this.bigTitle("", text, "#ffffff", dur);
  }
  subtitle(text: string | null): void {
    const el = this.els.subtitle;
    if (!text) el.classList.add("hidden");
    else {
      el.classList.remove("hidden");
      el.textContent = text;
    }
  }
  letterbox(on: boolean): void {
    this.els.lbTop.classList.toggle("on", on);
    this.els.lbBot.classList.toggle("on", on);
    this.els.hud.classList.toggle("off", on);
  }
  hud(on: boolean): void {
    this.els.hud.classList.toggle("off", !on);
  }
  screenFlash(dur: number, color = "#ffffff"): void {
    const el = this.els.flash;
    el.style.background = color;
    el.style.transition = "none";
    el.style.opacity = "0.85";
    void el.offsetWidth;
    el.style.transition = `opacity ${dur}s ease-out`;
    el.style.opacity = "0";
  }
  damageFlash(k: number): void {
    const el = this.els.dmg;
    el.style.transition = "none";
    el.style.opacity = String(Math.min(1, 0.35 + k));
    void el.offsetWidth;
    el.style.transition = "opacity 0.5s";
    el.style.opacity = "0";
  }
  deathTint(k: number): void {
    this.els.deathTint.style.opacity = String(k);
    this.els.deathTint2.style.opacity = String(k);
  }
  wasted(on: boolean): void {
    this.els.wasted.classList.toggle("show", on);
    if (!on) this.els.wasted.style.opacity = "0";
    else this.els.wasted.style.opacity = "";
  }
  autosaveIcon(): void {
    const el = this.els.autosave;
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
  }

  // ------------------------------------------------------------------ toasts
  toast(text: string, kind: "info" | "warn" | "good" | "location" | "item" = "info"): void {
    const el = h("div", `toast ${kind}`);
    el.textContent = text;
    this.els.toasts.appendChild(el);
    while (this.els.toasts.children.length > 5) this.els.toasts.firstChild!.remove();
    setTimeout(() => {
      el.style.transition = "opacity 0.6s";
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 700);
    }, 4200);
  }
  questToast(title: string, text: string): void {
    this.toast(`📜 ${title}: ${text}`, "good");
  }
  itemToast(def: ItemDef, n: number): void {
    const el = h("div", "toast item", `<span class="ic">${def.icon}</span>${esc(def.name)}${n > 1 ? ` ×${n}` : ""}`);
    el.style.borderColor = RARITY_COLOR[def.rarity];
    this.els.toasts.appendChild(el);
    while (this.els.toasts.children.length > 5) this.els.toasts.firstChild!.remove();
    setTimeout(() => el.remove(), 4200);
  }
  coinToast(n: number): void {
    this.toast(`🪙 +${n} coins`, "info");
  }
  itemShowcase(def: ItemDef): void {
    this.bigTitle(`${def.icon} ${def.name.toUpperCase()}`, def.desc, RARITY_COLOR[def.rarity], 3.5);
  }

  // ------------------------------------------------------------------ world-anchored elements
  private project(pos: Vector3): { x: number; y: number; visible: boolean } {
    const g = this.game;
    const eng = g.engine;
    const cam = g.camera.camera;
    const w = eng.getRenderWidth(), hh = eng.getRenderHeight();
    const p = Vector3.Project(pos, Matrix.IdentityReadOnly, g.scene.getTransformMatrix(), cam.viewport.toGlobal(w, hh));
    const sx = g.canvas.clientWidth / w, sy = g.canvas.clientHeight / hh;
    const fwd = cam.getDirection(Vector3.Forward());
    const ahead = (pos.x - cam.position.x) * fwd.x + (pos.y - cam.position.y) * fwd.y + (pos.z - cam.position.z) * fwd.z;
    return { x: p.x * sx, y: p.y * sy, visible: ahead > 0.2 && p.z > 0 && p.z < 1 };
  }

  floatText(pos: Vector3, text: string, color: string, scale = 1): void {
    const el = h("div", "float-text");
    el.textContent = text;
    el.style.color = color;
    el.style.fontSize = `${18 * scale}px`;
    this.els.world.appendChild(el);
    this.floaters.push({ el, pos: pos.clone(), t: 0, life: 1.1, vy: 1.4 });
  }

  speech(id: string, node: TransformNode, text: string): void {
    const old = this.speeches.get(id);
    if (old) old.el.remove();
    const el = h("div", "speech");
    el.textContent = text;
    this.els.world.appendChild(el);
    this.speeches.set(id, { el, node, t: 3.5 });
  }

  enemyAlert(e: any): void {
    const el = h("div", "enemy-alert", "!");
    this.els.world.appendChild(el);
    this.alerts.push({ el, e, t: 0.9 });
  }

  updateEnemyBars(list: Combatant[]): void {
    const keep = new Set(list);
    for (const [c, el] of this.enemyBars) {
      if (!keep.has(c)) {
        el.remove();
        this.enemyBars.delete(c);
      }
    }
    for (const c of list) {
      let el = this.enemyBars.get(c);
      if (!el) {
        el = h("div", "enemy-bar", "<div></div>");
        this.els.world.appendChild(el);
        this.enemyBars.set(c, el);
      }
      const p = this.project(c.position.add(new Vector3(0, c.height + 0.5, 0)));
      el.style.display = p.visible ? "" : "none";
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      (el.firstChild as HTMLElement).style.width = `${(c.hp / c.maxHp) * 100}%`;
    }
  }

  updateLock(t: Combatant | null): void {
    const el = this.els.lock;
    if (!t || !t.alive) {
      el.classList.add("hidden");
      return;
    }
    const p = this.project(t.lockPoint());
    el.classList.toggle("hidden", !p.visible);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
  }

  setPrompt(label: string | null): void {
    const el = this.els.prompt;
    if (!label || this.game.state !== "playing") {
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    const html = `<span class="key">E</span>${esc(label)}`;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  setPoison(intensity: number, poisoned: boolean, immune: boolean): void {
    const el = this.els.poison;
    el.style.opacity = String(intensity);
    el.classList.toggle("pulse", poisoned);
    const w = this.els.poisonWarn;
    w.classList.toggle("hidden", !(poisoned || immune));
    w.textContent = immune ? "✦ PROTECTED FROM THE CLOUD ✦" : "☠ POISON CLOUD — GET OUT! ☠";
  }

  // ------------------------------------------------------------------ boss bar
  showBossBar(name: string, title: string): void {
    const el = this.els.boss;
    el.classList.remove("hidden");
    (el.querySelector(".bn") as HTMLElement).textContent = name;
    (el.querySelector(".bt") as HTMLElement).textContent = title;
    this.bossVisible = true;
  }
  updateBossBar(frac: number, phase: number): void {
    if (!this.bossVisible) return;
    (this.els.boss.querySelector(".fill") as HTMLElement).style.width = `${Math.max(0, frac) * 100}%`;
    (this.els.boss.querySelector(".phase") as HTMLElement).textContent = phase > 1 ? `Phase ${"I".repeat(Math.min(3, phase))}` : "";
  }
  bossPhase(p: number): void {
    this.toast(`The guardian enters phase ${p}!`, "warn");
  }
  hideBossBar(): void {
    this.els.boss.classList.add("hidden");
    this.bossVisible = false;
  }

  // ------------------------------------------------------------------ dialogue
  showDialogue(speaker: string, text: string, choices: string[], color: string, onPick: (i: number) => void): void {
    const el = this.els.dialogue;
    el.classList.remove("hidden");
    const who = el.querySelector(".who") as HTMLElement;
    who.textContent = speaker || "…";
    who.style.color = color;
    who.style.display = speaker ? "" : "none";
    this.dlgFull = text;
    this.dlgShown = 0;
    this.dlgChoices = choices;
    this.dlgSel = 0;
    this.dlgDone = onPick;
    (el.querySelector(".txt") as HTMLElement).textContent = "";
    const ch = el.querySelector(".choices") as HTMLElement;
    ch.innerHTML = "";
    (el.querySelector(".more") as HTMLElement).style.display = "none";
  }
  hideDialogue(): void {
    this.els.dialogue.classList.add("hidden");
    this.dlgDone = null;
  }
  private renderChoices(): void {
    const ch = this.els.dialogue.querySelector(".choices") as HTMLElement;
    ch.innerHTML = "";
    this.dlgChoices.forEach((c, i) => {
      const b = h("button", "choice" + (i === this.dlgSel ? " sel" : ""), `${i + 1}. ${esc(c)}`);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.pickChoice(i);
      });
      ch.appendChild(b);
    });
  }
  private pickChoice(i: number): void {
    const d = this.dlgDone;
    this.dlgDone = null;
    d?.(i);
  }
  private advanceDialogue(): void {
    if (!this.dlgDone) return;
    if (this.dlgShown < this.dlgFull.length) {
      this.dlgShown = this.dlgFull.length;
      return;
    }
    if (this.dlgChoices.length) return;
    this.pickChoice(0);
  }
  private updateDialogue(dt: number): void {
    if (!this.dlgDone) return;
    const el = this.els.dialogue;
    const txt = el.querySelector(".txt") as HTMLElement;
    if (this.dlgShown < this.dlgFull.length) {
      this.dlgShown = Math.min(this.dlgFull.length, this.dlgShown + dt * 55);
      txt.textContent = this.dlgFull.slice(0, Math.floor(this.dlgShown));
      if (this.dlgShown >= this.dlgFull.length && this.dlgChoices.length) this.renderChoices();
    } else if (txt.textContent !== this.dlgFull) {
      txt.textContent = this.dlgFull;
      if (this.dlgChoices.length) this.renderChoices();
    }
    (el.querySelector(".more") as HTMLElement).style.display = this.dlgShown >= this.dlgFull.length && !this.dlgChoices.length ? "" : "none";
    const inp = this.game.input;
    if (inp.rawPressed("KeyE") || inp.rawPressed("Space") || inp.rawPressed("Enter")) {
      if (this.dlgChoices.length && this.dlgShown >= this.dlgFull.length) this.pickChoice(this.dlgSel);
      else this.advanceDialogue();
    }
    if (this.dlgChoices.length && this.dlgShown >= this.dlgFull.length) {
      for (let k = 0; k < this.dlgChoices.length && k < 9; k++) if (inp.rawPressed("Digit" + (k + 1))) this.pickChoice(k);
      if (inp.rawPressed("ArrowDown") || inp.rawPressed("KeyS")) {
        this.dlgSel = (this.dlgSel + 1) % this.dlgChoices.length;
        this.renderChoices();
      }
      if (inp.rawPressed("ArrowUp") || inp.rawPressed("KeyW")) {
        this.dlgSel = (this.dlgSel - 1 + this.dlgChoices.length) % this.dlgChoices.length;
        this.renderChoices();
      }
    }
  }

  // ------------------------------------------------------------------ panels
  private screen(html: string, cls = ""): HTMLElement {
    const s = this.els.screen;
    s.classList.remove("hidden");
    s.innerHTML = `<div class="panel ${cls}">${html}</div>`;
    return s.firstChild as HTMLElement;
  }

  openPanel(p: Panel, ret: Panel = "none"): void {
    const g = this.game;
    this.menuReturn = ret;
    this.panel = p;
    if (g.state === "playing") {
      g.state = "paused";
      g.time.paused = true;
    }
    g.input.exitPointerLock();
    g.audio.sfx("uiOpen");
    this.els.mapview.classList.add("hidden");
    switch (p) {
      case "pause": return this.renderPause();
      case "inventory": return this.renderInventory();
      case "map": return this.renderMap();
      case "quests": return this.renderQuests();
      case "settings": return this.renderSettings();
      case "controls": return this.renderControls();
      default: break;
    }
  }

  closePanel(): void {
    const g = this.game;
    const ret = this.menuReturn;
    this.els.screen.classList.add("hidden");
    this.els.screen.innerHTML = "";
    this.els.mapview.classList.add("hidden");
    g.audio.sfx("uiClose");
    if (ret === "title") {
      this.panel = "title";
      return;
    }
    if (ret === "pause") {
      this.menuReturn = "none";
      return this.openPanel("pause");
    }
    this.panel = "none";
    if (g.state === "paused") {
      g.state = "playing";
      g.time.paused = false;
      g.input.requestPointerLock();
    }
    if (this.shopResolve) {
      const r = this.shopResolve;
      this.shopResolve = null;
      r();
    }
  }

  handleGlobalInput(): void {
    const g = this.game;
    const inp = g.input;
    if (g.state === "loading" || this.panel === "title" || g.state === "ending") return;
    if (g.dialogue.active || g.state === "cinematic" || g.state === "dead") return;
    if (inp.rawPressed("Escape")) {
      if (this.panel !== "none") this.closePanel();
      else if (g.state === "playing") this.openPanel("pause");
      return;
    }
    if (this.panel === "none" && g.state === "playing") {
      if (inp.rawPressed("KeyI")) this.openPanel("inventory");
      else if (inp.rawPressed("KeyM")) this.openPanel("map");
      else if (inp.rawPressed("KeyJ")) this.openPanel("quests");
    } else if (this.panel === "inventory" && inp.rawPressed("KeyI")) this.closePanel();
    else if (this.panel === "map" && inp.rawPressed("KeyM")) this.closePanel();
    else if (this.panel === "quests" && inp.rawPressed("KeyJ")) this.closePanel();
  }

  private renderPause(): void {
    const g = this.game;
    const el = this.screen(`<h2>Paused</h2>
      <button class="btn" data-a="resume">Resume</button>
      <button class="btn" data-a="inventory">Inventory (I)</button>
      <button class="btn" data-a="map">Map (M)</button>
      <button class="btn" data-a="quests">Quest Log (J)</button>
      <button class="btn" data-a="save">Save Game</button>
      <button class="btn" data-a="load">Load Game</button>
      <button class="btn" data-a="settings">Settings</button>
      <button class="btn" data-a="controls">Controls</button>
      <button class="btn" data-a="quit">Quit to Title</button>
      <div class="note" style="text-align:center;margin-top:8px">Day ${g.time.day} · ${formatTime(g.time.minutes)} · Deaths: ${g.respawn.deaths}</div>`, "menu");
    el.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        const a = (b as HTMLElement).dataset.a!;
        g.audio.sfx("uiClick");
        if (a === "resume") this.closePanel();
        else if (a === "save") this.openSlots("save", "pause");
        else if (a === "load") this.openSlots("load", "pause");
        else if (a === "quit") {
          g.save.autosave("quit");
          location.reload();
        } else this.openPanel(a as Panel, "pause");
      }),
    );
  }

  openSaveMenu(): void {
    this.openSlots("save", "none");
  }

  private openSlots(mode: "save" | "load", ret: Panel): void {
    const g = this.game;
    this.loadSlotsMode = mode;
    this.menuReturn = ret;
    this.panel = mode;
    if (g.state === "playing") {
      g.state = "paused";
      g.time.paused = true;
    }
    g.input.exitPointerLock();
    const render = () => {
      const metas = g.save.slots();
      const rows = ["auto", "1", "2", "3"].map((slot, i) => {
        const m = metas[i];
        const info = m ? `<b>${slot === "auto" ? "Autosave" : "Slot " + slot}</b> — Day ${m.day}, ${m.time} · ${esc(m.place)} · ${m.shards}/5 shards<br><span class="note">${new Date(m.savedAt).toLocaleString()}</span>` : `<b>${slot === "auto" ? "Autosave" : "Slot " + slot}</b> — empty`;
        const btn = mode === "save" ? (slot === "auto" ? "" : `<button class="btn small" data-s="${slot}">Save</button>`) : m ? `<button class="btn small" data-s="${slot}">Load</button>` : "";
        return `<div class="slotrow"><div class="si">${info}</div>${btn}</div>`;
      });
      const el = this.screen(`<h2>${mode === "save" ? "Save Game" : "Load Game"}</h2>${rows.join("")}<button class="btn" data-a="back">Back</button>`, "slots");
      el.querySelectorAll("button[data-s]").forEach((b) =>
        b.addEventListener("click", () => {
          const slot = (b as HTMLElement).dataset.s!;
          if (mode === "save") {
            g.save.save(slot);
            render();
          } else {
            if (this.panel === "load" && this.menuReturn === "title") {
              this.els.screen.classList.add("hidden");
              this.resolveTitle("load:" + slot);
            } else g.save.requestLoad(slot);
          }
        }),
      );
      el.querySelector("button[data-a=back]")!.addEventListener("click", () => this.closePanel());
    };
    render();
  }

  private renderSettings(): void {
    const g = this.game;
    const s = g.settings;
    const el = this.screen(`<h2>Settings</h2>
      <h3>Graphics</h3>
      <div class="row"><label>Quality</label><select data-k="quality"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
      <div class="row"><label>Show FPS</label><input type="checkbox" data-k="showFps"></div>
      <h3>Audio</h3>
      <div class="row"><label>Master</label><input type="range" min="0" max="1" step="0.05" data-k="masterVolume"></div>
      <div class="row"><label>Music</label><input type="range" min="0" max="1" step="0.05" data-k="musicVolume"></div>
      <div class="row"><label>Effects</label><input type="range" min="0" max="1" step="0.05" data-k="sfxVolume"></div>
      <div class="row"><label>Ambience</label><input type="range" min="0" max="1" step="0.05" data-k="ambientVolume"></div>
      <h3>Controls</h3>
      <div class="row"><label>Mouse sensitivity</label><input type="range" min="0.2" max="3" step="0.1" data-k="mouseSensitivity"></div>
      <div class="row"><label>Invert Y</label><input type="checkbox" data-k="invertY"></div>
      <h3>Adventure</h3>
      <div class="row"><label>Length of an in-game day (minutes)</label><input type="range" min="4" max="40" step="1" data-k="dayLengthMinutes"><span data-v="dayLengthMinutes"></span></div>
      <div class="note">14 days × ${s.dayLengthMinutes} min ≈ ${Math.round((14 * s.dayLengthMinutes) / 6) / 10} hours of real time.</div>
      <h3>MapTiler 3D terrain</h3>
      <div class="row"><label>API key</label><input type="text" data-k="maptilerKey" placeholder="your MapTiler key"></div>
      <div class="row"><label>Terrain source</label><select data-k="terrainSource"><option value="auto">Auto (MapTiler if key)</option><option value="maptiler">MapTiler</option><option value="offline">Offline elevation</option></select></div>
      <div class="note">Terrain changes apply on the next launch. Get a free key at cloud.maptiler.com. You can also pass <i>?maptilerKey=…</i> in the URL.</div>
      <button class="btn" data-a="back">Back</button>`, "menu");
    (el as HTMLElement).style.width = "min(560px, 94vw)";
    el.querySelectorAll("[data-k]").forEach((inp) => {
      const k = (inp as HTMLElement).dataset.k as keyof typeof s;
      const i = inp as HTMLInputElement;
      if (i.type === "checkbox") i.checked = !!s[k];
      else i.value = String(s[k]);
      const v = el.querySelector(`[data-v=${k}]`);
      if (v) v.textContent = String(s[k]);
      i.addEventListener("input", () => {
        const val: any = i.type === "checkbox" ? i.checked : i.type === "range" ? parseFloat(i.value) : i.value;
        (s as any)[k] = val;
        if (v) v.textContent = String(val);
        if (k === "quality") g.applySettings();
        else {
          g.audio.applyVolumes();
          import("../config").then((m) => m.saveSettings(s));
        }
      });
    });
    el.querySelector("button[data-a=back]")!.addEventListener("click", () => this.closePanel());
  }

  private renderControls(): void {
    const keys: [string, string][] = [
      ["W A S D", "Move"], ["Mouse", "Look around (click to capture)"], ["Shift", "Sprint"], ["Space", "Jump"], ["Left click", "Attack (click repeatedly for combos)"],
      ["Hold left click", "Charged spin attack"], ["Left click in mid-air", "Plunging strike"], ["Right click", "Block (time it to parry)"], ["Q", "Dodge roll"],
      ["E", "Interact / talk / open"], ["Tab / F / middle click", "Lock onto enemy"], ["H", "Quick heal"], ["1 – 5", "Rainbow Sword abilities"], ["R", "Prismatic Nova (ultimate)"],
      ["I", "Inventory"], ["M", "Map"], ["J", "Quest log"], ["Esc", "Pause menu"], ["Arrow keys", "Rotate camera"], ["Mouse wheel", "Zoom camera"],
    ];
    const el = this.screen(`<h2>Controls</h2><div class="keys">${keys.map(([k, v]) => `<div class="k">${k}</div><div>${v}</div>`).join("")}</div><button class="btn" data-a="back">Back</button>`, "menu");
    (el as HTMLElement).style.width = "min(560px, 94vw)";
    el.querySelector("button[data-a=back]")!.addEventListener("click", () => this.closePanel());
  }

  private renderMap(): void {
    const g = this.game;
    this.els.screen.classList.add("hidden");
    const mv = this.els.mapview;
    mv.classList.remove("hidden");
    this.map.centerOnPlayer();
    this.map.updatePoison(true);
    const days = g.time.minutesLeft / 1440;
    mv.querySelector(".map-legend")!.innerHTML = `<b>Day ${g.time.day} of ${DOOM_DAYS}</b> — ${days.toFixed(1)} days remain<br>
      <span style="color:#6a2a8a">■</span> Poison cloud &nbsp; <span style="color:#7a1f1f">- -</span> Border of Andorra<br>
      <span style="color:#c0301a">☠</span> Guardian lair &nbsp; <b>?</b> Rumoured &nbsp; ⚒ Forge<br>
      <span style="color:#ffcf3a">◆</span> Objective &nbsp; <span style="color:#1f6aa8">●</span> Your markers<br>
      Shards: ${g.inventory.shards().length}/5 · Discovered: ${[...g.discovered].filter((d) => g.world.villages.some((v) => v.id === d)).length}/${g.world.villages.length} villages`;
  }

  private renderQuests(): void {
    const g = this.game;
    const q = g.quests;
    const list = QUESTS.filter((d) => q.st(d.id).status !== "inactive");
    if (!list.find((d) => d.id === this.questSel)) this.questSel = "main";
    const sel = QUESTS.find((d) => d.id === this.questSel)!;
    const st = q.st(sel.id);
    const objs = sel.objectives.map((o, i) => `<div class="obj ${i < st.stage || st.status === "done" ? "done" : ""}">${i < st.stage || st.status === "done" ? "✔" : i === st.stage ? "◆" : "·"} ${esc(i === st.stage && st.status === "active" ? q.objective(sel.id) : o)}</div>`).filter((_, i) => i <= st.stage || st.status === "done");
    const el = this.screen(`<h2>Quest Log</h2><div class="quests">
      <div class="qlist">${list.map((d) => `<div class="qi ${d.main ? "main" : ""} ${q.st(d.id).status} ${d.id === this.questSel ? "sel" : ""}" data-q="${d.id}">${d.main ? "★ " : ""}${esc(d.title)}</div>`).join("")}</div>
      <div class="qdetail"><h3>${esc(sel.title)}</h3><div class="note">Given by ${esc(sel.giver)} · ${st.status.toUpperCase()}</div>${objs.join("")}
      ${st.status === "active" ? `<button class="btn small" data-a="track">${q.tracked === sel.id ? "✓ Tracked" : "Track on HUD & map"}</button>` : ""}</div></div>
      <button class="btn" data-a="back">Close</button>`, "");
    el.querySelectorAll(".qi").forEach((n) => n.addEventListener("click", () => {
      this.questSel = (n as HTMLElement).dataset.q!;
      this.renderQuests();
    }));
    el.querySelector("[data-a=track]")?.addEventListener("click", () => {
      q.tracked = sel.id;
      this.renderQuests();
    });
    el.querySelector("[data-a=back]")!.addEventListener("click", () => this.closePanel());
  }

  private renderInventory(): void {
    const g = this.game;
    const inv = g.inventory;
    const tabs: [string, string, string[]][] = [
      ["weapons", "Weapons", ["weapon"]], ["armor", "Armour", ["armor"]], ["items", "Potions & Food", ["potion", "food"]], ["materials", "Materials", ["material"]],
      ["magic", "Magic Objects", ["magic"]], ["cosmetic", "Cosmetics", ["cosmetic"]], ["key", "Quest Items", ["key", "shard"]],
    ];
    const tab = tabs.find((t) => t[0] === this.invTab) ?? tabs[0];
    const items = inv.listBy(tab[2]);
    if (!this.invSel || !items.some((i) => i.def.id === this.invSel)) this.invSel = items[0]?.def.id ?? null;
    const shards = inv.shards();
    const complete = shards.length === 5;
    const forged = inv.has("rainbow_sword");
    const shardHtml = SHARD_ORDER.map((c) => {
      const on = shards.includes(c);
      return `<div><div class="sd ${on ? "on" : ""}" style="${on ? `background:${SHARD_INFO[c].hex};box-shadow:0 0 16px ${SHARD_INFO[c].hex}` : ""}"></div><div class="sdl">${SHARD_INFO[c].element}</div></div>`;
    }).join("");
    const isEquipped = (id: string) => inv.equipped.weapon === id || inv.equipped.armor === id || inv.equipped.cape === id || inv.equipped.hat === id;
    const sel = this.invSel ? ITEMS[this.invSel] : null;
    let action = "";
    if (sel) {
      if (sel.cat === "weapon") action = isEquipped(sel.id) ? "Equipped" : "Equip";
      else if (sel.cat === "armor" || sel.cat === "cosmetic") action = isEquipped(sel.id) ? "Unequip" : "Equip";
      else if (sel.use) action = sel.cat === "food" ? "Eat" : "Drink";
    }
    const p = g.player;
    const w = item(inv.equipped.weapon).weapon!;
    const up = inv.upgrades[inv.equipped.weapon] ?? 0;
    const el = this.screen(`<h2>Inventory</h2>
      <div class="inv-top"><div class="shard-display ${complete ? "complete" : ""}">${shardHtml}</div>
      <div class="forge-hint">${forged ? "🌈 The five shards live within the Rainbow Sword." : complete ? "✨ All five shards resonate! The legendary sword can now be forged — seek the sword maker." : `${shards.length} of 5 shards collected.`}</div></div>
      <div class="tabs">${tabs.map((t) => `<div class="tab ${t[0] === tab[0] ? "on" : ""}" data-t="${t[0]}">${t[1]}</div>`).join("")}</div>
      <div class="inv-body"><div class="grid">${items.map(({ def, count }) => `<div class="slot ${def.rarity} ${def.id === this.invSel ? "sel" : ""}" data-i="${def.id}" title="${esc(def.name)}">${def.cat === "shard" ? `<span style="color:${SHARD_INFO[def.shard!].hex}">◆</span>` : def.icon}${count > 1 ? `<span class="n">${count}</span>` : ""}${isEquipped(def.id) ? `<span class="eq">E</span>` : ""}</div>`).join("") || `<div class="note">Nothing here yet.</div>`}</div>
      <div class="detail">${sel ? `<div class="dn" style="color:${RARITY_COLOR[sel.rarity]}">${sel.icon} ${esc(sel.name)}</div><div class="dr" style="color:${RARITY_COLOR[sel.rarity]}">${sel.rarity}</div><div class="dd">${esc(sel.desc)}</div>
        ${sel.weapon ? `<div class="ds">Damage ${sel.weapon.damage}${inv.upgrades[sel.id] ? ` (+${inv.upgrades[sel.id] * 15}%)` : ""} · Speed ${sel.weapon.speed} · Reach ${sel.weapon.reach}</div>` : ""}
        ${sel.armor ? `<div class="ds">Defense +${sel.armor.defense}</div>` : ""}
        ${action ? `<button class="btn" data-a="use" ${action === "Equipped" ? "disabled" : ""}>${action}</button>` : ""}` : `<div class="note">Select an item.</div>`}
        <div class="stats">❤ Health ${Math.round(p.hp)}/${p.maxHp}<br>⚡ Stamina ${p.maxStamina}<br>🛡 Defense ${p.defense}<br>⚔ ${esc(item(inv.equipped.weapon).name)}${up ? ` +${up}` : ""} (${Math.round(w.damage * (1 + up * 0.15))} dmg)<br>🪙 ${inv.coins} coins</div></div></div>
      <button class="btn" data-a="back">Close (I)</button>`, "inv");
    el.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
      this.invTab = (t as HTMLElement).dataset.t!;
      this.invSel = null;
      this.renderInventory();
    }));
    el.querySelectorAll(".slot").forEach((s) => s.addEventListener("click", () => {
      this.invSel = (s as HTMLElement).dataset.i!;
      this.renderInventory();
    }));
    el.querySelectorAll(".slot").forEach((s) => s.addEventListener("dblclick", () => {
      g.inventory.use((s as HTMLElement).dataset.i!);
      this.renderInventory();
    }));
    el.querySelector("[data-a=use]")?.addEventListener("click", () => {
      if (this.invSel) g.inventory.use(this.invSel);
      this.renderInventory();
    });
    el.querySelector("[data-a=back]")!.addEventListener("click", () => this.closePanel());
  }

  openShop(title: string, stock: [string, number][], allowSell: boolean): Promise<void> {
    const g = this.game;
    this.panel = "shop";
    this.menuReturn = "none";
    if (g.state === "playing" || g.state === "dialogue") {
      g.state = "paused";
      g.time.paused = true;
    }
    g.input.exitPointerLock();
    let mode: "buy" | "sell" = "buy";
    const render = () => {
      const sellable = g.inventory.listBy(["material", "food", "potion"]).filter((i) => i.def.value > 0);
      const rows = mode === "buy"
        ? stock.map(([id, price]) => {
            const d = item(id);
            const owned = g.inventory.count(id);
            const unique = ["weapon", "armor", "cosmetic", "magic"].includes(d.cat);
            const dis = g.inventory.coins < price || (unique && owned > 0);
            return `<div class="shop-row"><span class="ic">${d.icon}</span><span class="nm" style="color:${RARITY_COLOR[d.rarity]}">${esc(d.name)}<br><span class="note">${esc(d.desc)}</span></span><span class="pr">${price} 🪙</span><button class="btn small" data-b="${id}" data-p="${price}" ${dis ? "disabled" : ""}>${unique && owned ? "Owned" : "Buy"}</button></div>`;
          })
        : sellable.map(({ def, count }) => {
            const price = Math.max(1, Math.floor(def.value * 0.5));
            return `<div class="shop-row"><span class="ic">${def.icon}</span><span class="nm">${esc(def.name)} ×${count}</span><span class="pr">${price} 🪙</span><button class="btn small" data-s="${def.id}" data-p="${price}">Sell</button></div>`;
          });
      const el = this.screen(`<h2>${esc(title)}</h2><div class="tabs"><div class="tab ${mode === "buy" ? "on" : ""}" data-m="buy">Buy</div>${allowSell ? `<div class="tab ${mode === "sell" ? "on" : ""}" data-m="sell">Sell</div>` : ""}</div>
        <div style="text-align:center" class="coins">🪙 ${g.inventory.coins} coins</div>${rows.join("") || `<div class="note">Nothing to ${mode}.</div>`}<button class="btn" data-a="back">Leave</button>`, "shop");
      el.querySelectorAll("[data-m]").forEach((t) => t.addEventListener("click", () => {
        mode = (t as HTMLElement).dataset.m as any;
        render();
      }));
      el.querySelectorAll("[data-b]").forEach((b) => b.addEventListener("click", () => {
        const id = (b as HTMLElement).dataset.b!, price = +(b as HTMLElement).dataset.p!;
        if (g.inventory.spend(price)) {
          g.inventory.add(id, 1);
          g.audio.sfx("coin");
        }
        render();
      }));
      el.querySelectorAll("[data-s]").forEach((b) => b.addEventListener("click", () => {
        const id = (b as HTMLElement).dataset.s!, price = +(b as HTMLElement).dataset.p!;
        if (g.inventory.remove(id, 1)) {
          g.inventory.addCoins(price, true);
          g.audio.sfx("coin");
        }
        render();
      }));
      el.querySelector("[data-a=back]")!.addEventListener("click", () => this.closePanel());
    };
    render();
    return new Promise((res) => (this.shopResolve = res));
  }

  // ------------------------------------------------------------------ ending screens
  credits(): Promise<void> {
    const g = this.game;
    return new Promise((res) => {
      const el = h("div", "credits interactive");
      const roll = h("div", "roll", `<h1>The Legend of Andorra</h1>
        <p>A hero rose from the village of Ordino.<br>Five guardians fell. Five shards were united.<br>Zorg, Lord of the Dark Side, is no more.</p>
        <h4>YOUR JOURNEY</h4><p>Saved Andorra on Day ${g.time.day} at ${formatTime(g.time.minutes)}<br>Fell ${g.respawn.deaths} time${g.respawn.deaths === 1 ? "" : "s"} and rose again<br>Treasures found: ${g.treasure.opened.size}<br>Places discovered: ${g.discovered.size}</p>
        <h4>THE WORLD</h4><p>Real terrain of the Principality of Andorra<br>MapTiler 3D terrain (quantized mesh) · offline elevation from open data</p>
        <h4>BUILT WITH</h4><p>Babylon.js · TypeScript · Web Audio</p>
        <h4>THE GUARDIANS</h4><p>The Flame Beast · The Forest Guardian · The Frost Dragon<br>The Shadow Knight · The Thunder Titan</p>
        <h4>THE PEOPLE OF ANDORRA</h4><p>Elder Joan · Montse · Jaume · Carme · Núria · Pere<br>Captain Marc · Oriol · Roser · Laia · Pau<br>and Mestre Ferran, the Sword Maker</p>
        <h4>&nbsp;</h4><p style="font-family:var(--title-font);font-size:30px;color:var(--gold)">Thank you for playing</p><p class="note">Press any key to continue exploring</p>`);
      el.appendChild(roll);
      this.root.appendChild(el);
      let y = window.innerHeight;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.remove();
        window.removeEventListener("keydown", finish);
        res();
      };
      const step = () => {
        if (done) return;
        y -= 0.7;
        roll.style.top = `${y}px`;
        if (y < -roll.offsetHeight - 50) finish();
        else requestAnimationFrame(step);
      };
      step();
      setTimeout(() => {
        window.addEventListener("keydown", finish);
        el.addEventListener("click", finish);
      }, 3000);
    });
  }

  showGameOver(): void {
    const g = this.game;
    const el = this.screen(`<div class="gameover"><h2>Andorra Has Fallen</h2><p class="note">The fourteenth day has ended. The cloud covers every valley.</p>
      <button class="btn" data-a="load">Load a Save</button><button class="btn" data-a="new">Begin a New Adventure</button></div>`, "menu");
    this.panel = "gameover";
    g.input.exitPointerLock();
    el.querySelector("[data-a=load]")!.addEventListener("click", () => this.openSlots("load", "gameover" as Panel));
    el.querySelector("[data-a=new]")!.addEventListener("click", () => {
      try {
        sessionStorage.setItem("loa.pendingNew", "1");
      } catch {
        /* ignore */
      }
      location.reload();
    });
  }

  // ------------------------------------------------------------------ per-frame
  update(dt: number): void {
    const g = this.game;
    this.updateDialogue(dt);
    // floaters
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      f.pos.y += f.vy * dt;
      const p = this.project(f.pos);
      f.el.style.left = `${p.x}px`;
      f.el.style.top = `${p.y}px`;
      f.el.style.opacity = String(1 - Math.max(0, f.t - f.life * 0.5) / (f.life * 0.5));
      f.el.style.display = p.visible ? "" : "none";
      if (f.t > f.life) {
        f.el.remove();
        this.floaters.splice(i, 1);
      }
    }
    for (const [id, s] of this.speeches) {
      s.t -= dt;
      if (s.t <= 0 || s.node.isDisposed()) {
        s.el.remove();
        this.speeches.delete(id);
        continue;
      }
      const p = this.project(s.node.getAbsolutePosition().add(new Vector3(0, 2.3, 0)));
      s.el.style.display = p.visible ? "" : "none";
      s.el.style.left = `${p.x}px`;
      s.el.style.top = `${p.y}px`;
    }
    for (let i = this.alerts.length - 1; i >= 0; i--) {
      const a = this.alerts[i];
      a.t -= dt;
      const p = this.project(a.e.position.add(new Vector3(0, a.e.height + 0.9, 0)));
      a.el.style.left = `${p.x}px`;
      a.el.style.top = `${p.y}px`;
      if (a.t <= 0) {
        a.el.remove();
        this.alerts.splice(i, 1);
      }
    }
    if (this.panel === "map") this.map.render();
    if (!g.player || g.state === "loading" || this.panel === "title") return;
    this.els.hud.classList.remove("hidden");
    this.updateHUD(dt);
  }

  private updateHUD(dt: number): void {
    const g = this.game;
    const p = g.player;
    const hpF = p.hp / p.maxHp;
    this.hpGhost = Math.max(hpF, this.hpGhost - dt * 0.4);
    const hp = this.els.hp;
    (hp.querySelector(".fill") as HTMLElement).style.width = `${hpF * 100}%`;
    (hp.querySelector(".ghost") as HTMLElement).style.width = `${this.hpGhost * 100}%`;
    (hp.querySelector(".label") as HTMLElement).textContent = `❤ ${Math.ceil(p.hp)} / ${p.maxHp}`;
    hp.style.width = `${Math.min(100, 60 + p.maxHp * 0.4)}%`;
    const st = this.els.st;
    (st.querySelector(".fill") as HTMLElement).style.width = `${(p.stamina / p.maxStamina) * 100}%`;
    (st.querySelector(".label") as HTMLElement).textContent = `⚡ ${Math.ceil(p.stamina)}`;
    st.classList.toggle("exhausted", p.exhausted);
    st.style.width = `${Math.min(100, 60 + p.maxStamina * 0.4)}%`;
    const en = this.els.en;
    en.classList.toggle("hidden", !g.magic.forged);
    (en.querySelector(".fill") as HTMLElement).style.width = `${(g.magic.energy / g.magic.maxEnergy) * 100}%`;
    const shards = g.inventory.shards();
    this.els.shards.querySelectorAll(".shard").forEach((s) => {
      const c = (s as HTMLElement).dataset.c as any;
      const on = shards.includes(c);
      s.classList.toggle("on", on);
      (s as HTMLElement).style.background = on ? SHARD_INFO[c as keyof typeof SHARD_INFO].hex : "";
    });
    this.els.coins.textContent = `🪙 ${g.inventory.coins}`;
    const icons: string[] = [];
    if (g.poison.immuneMinutes > 0) icons.push(`💧 Purity ${Math.ceil(g.poison.immuneMinutes / 60)}h`);
    if (p.burnT > 0) icons.push("🔥 Burning");
    if (p.slowT > 0) icons.push("❄ Chilled");
    if (p.rootT > 0) icons.push("🌿 Rooted");
    if (p.stunT > 0) icons.push("⚡ Shocked");
    this.els.status.textContent = icons.join("   ");
    // clock
    const tm = g.time;
    const clock = this.els.clock;
    (clock.querySelector(".day") as HTMLElement).textContent = g.victory > 0 ? "Andorra is saved" : `Day ${Math.min(tm.day, DOOM_DAYS)} / ${DOOM_DAYS}`;
    (clock.querySelector(".time") as HTMLElement).textContent = `${tm.isNight ? "☾" : "☀"} ${formatTime(tm.minutes)}`;
    const left = tm.minutesLeft;
    (clock.querySelector(".left") as HTMLElement).textContent = g.victory > 0 ? "" : `☠ ${Math.floor(left / 1440)}d ${Math.floor((left % 1440) / 60)}h until all is lost`;
    ((clock.querySelector(".doom") as HTMLElement).firstChild as HTMLElement).style.width = `${g.victory > 0 ? 0 : tm.doomProgress * 100}%`;
    // minimap (throttled)
    this.miniT -= dt;
    if (this.miniT <= 0) {
      this.miniT = 0.1;
      this.map.renderMini(this.miniCanvas);
    }
    // tracker
    const q = g.quests;
    const def = QUESTS.find((d) => d.id === q.tracked)!;
    const qs = q.st(def.id);
    const op = g.interiors.current ? null : q.objectivePos(def.id);
    const dist = op ? Math.round(Math.hypot(op.x - p.position.x, op.z - p.position.z) * 5) : 0;
    const html = qs.status === "active" ? `<div class="qt">${esc(def.title)}</div><div class="qo">◆ ${esc(q.objective(def.id))}</div>${op ? `<div class="qd">${dist > 1000 ? (dist / 1000).toFixed(1) + " km" : dist + " m"} away</div>` : ""}` : "";
    if (this.els.tracker.innerHTML !== html) this.els.tracker.innerHTML = html;
    // weapon
    const w = item(g.inventory.equipped.weapon);
    const wHtml = `${w.icon} ${esc(w.name)} &nbsp; <span class="k">H</span> heal (${g.inventory.count("health_potion") + g.inventory.count("greater_potion")}🧪)`;
    if (this.els.weapon.innerHTML !== wHtml) this.els.weapon.innerHTML = wHtml;
    // abilities
    const ab = this.els.abilities;
    ab.classList.toggle("hidden", !g.magic.active);
    if (g.magic.active) {
      if (!ab.children.length) {
        g.magic.abilities.forEach((a, i) => ab.appendChild(h("div", "ability", `<span class="key">${i + 1}</span><span class="nm">${a.name}</span><div class="cd"></div>`)));
        ab.appendChild(h("div", "ability ult", `<span class="key">R</span><span class="nm">Prismatic Nova</span><div class="cd"></div>`));
      }
      g.magic.abilities.forEach((a, i) => {
        const el = ab.children[i] as HTMLElement;
        el.style.color = a.color;
        (el.querySelector(".cd") as HTMLElement).style.height = `${(a.cd / a.cooldown) * 100}%`;
        const ready = a.cd <= 0 && g.magic.energy >= a.cost;
        el.classList.toggle("ready", ready);
        el.style.opacity = ready ? "1" : "0.6";
      });
      const ult = ab.children[5] as HTMLElement;
      const full = g.magic.energy >= g.magic.maxEnergy && g.magic.ultimateCd <= 0;
      ult.style.color = "#ffffff";
      (ult.querySelector(".cd") as HTMLElement).style.height = `${(1 - g.magic.energy / g.magic.maxEnergy) * 100}%`;
      ult.classList.toggle("ready", full);
    }
    this.els.fps.classList.toggle("hidden", !g.settings.showFps);
    if (g.settings.showFps) this.els.fps.textContent = `${g.fps.toFixed(0)} fps`;
  }
}
