import type { Game } from "../core/Game";
import { WORLD } from "../config";
import { clamp, smoothstep } from "../core/MathUtil";
import { NOISE } from "../core/Noise";

const MW = 1100;
const MH = 1000;

/** Fantasy parchment map of the real Andorra (base image + live overlays). */
export class MapView {
  base: HTMLCanvasElement;
  poisonCanvas: HTMLCanvasElement;
  private poisonT = 0;
  zoom = 1;
  panX = 0;
  panY = 0;
  private canvas: HTMLCanvasElement | null = null;
  private dragging = false;
  private dragMoved = 0;
  private lastX = 0;
  private lastY = 0;

  constructor(private game: Game) {
    this.base = document.createElement("canvas");
    this.base.width = MW;
    this.base.height = MH;
    this.poisonCanvas = document.createElement("canvas");
  }

  static toMap(x: number, z: number): [number, number] {
    return [((x + WORLD.halfW) / WORLD.width) * MW, ((WORLD.halfD - z) / WORLD.depth) * MH];
  }
  static toWorld(mx: number, my: number): [number, number] {
    return [(mx / MW) * WORLD.width - WORLD.halfW, WORLD.halfD - (my / MH) * WORLD.depth];
  }

  buildBase(): void {
    const g = this.game;
    const ctx = this.base.getContext("2d")!;
    const img = ctx.createImageData(MW, MH);
    const t = g.terrain;
    const veg = g.world.vegetation;
    for (let py = 0; py < MH; py++) {
      for (let px = 0; px < MW; px++) {
        const [x, z] = MapView.toWorld(px + 0.5, py + 0.5);
        const h = t.getHeight(x, z);
        const e = 6.4;
        const dx = t.getHeight(x + e, z) - t.getHeight(x - e, z);
        const dz = t.getHeight(x, z + e) - t.getHeight(x, z - e);
        // light from the north-west
        let shade = 0.5 + (-dx * 0.7 + dz * 0.7) / (2 * e) * 0.9;
        shade = clamp(shade, 0.15, 1.25);
        const hk = clamp(h / 560, 0, 1);
        let r = 232 - hk * 55, gg = 218 - hk * 62, b = 178 - hk * 70;
        // valleys a touch greener
        r -= (1 - hk) * 22;
        gg -= (1 - hk) * 6;
        const f = veg.forestAt(x, z);
        if (f > 0.15) {
          r = r * (1 - f * 0.28);
          gg = gg * (1 - f * 0.12);
          b = b * (1 - f * 0.3);
        }
        if (h > 520) {
          const s = smoothstep(520, 580, h);
          r += (245 - r) * s;
          gg += (240 - gg) * s;
          b += (228 - b) * s;
        }
        const paper = 0.94 + NOISE.noise2(px * 0.05, py * 0.05) * 0.05 + NOISE.noise2(px * 0.4, py * 0.4) * 0.025;
        const k = (0.55 + shade * 0.5) * paper;
        // outside Andorra: faded
        const inside = g.world.isInsideAndorra(x, z);
        const fade = inside ? 1 : 0.82;
        const o = (py * MW + px) * 4;
        if (g.hydro.isLake(x, z)) {
          img.data[o] = 110;
          img.data[o + 1] = 150;
          img.data[o + 2] = 170;
        } else {
          img.data[o] = clamp(r * k * fade + (inside ? 0 : 12), 0, 255);
          img.data[o + 1] = clamp(gg * k * fade + (inside ? 0 : 8), 0, 255);
          img.data[o + 2] = clamp(b * k * fade, 0, 255);
        }
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // contour hints: subtle lines every ~ 80 m
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "#5a4020";
    // rivers
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "#4f7f9e";
    ctx.lineCap = "round";
    for (const r of g.hydro.rivers) {
      ctx.lineWidth = Math.max(0.8, r.flow * 0.32);
      ctx.beginPath();
      r.pts.forEach((p, i) => {
        const [mx, my] = MapView.toMap(p.x, p.z);
        if (i) ctx.lineTo(mx, my);
        else ctx.moveTo(mx, my);
      });
      ctx.stroke();
    }
    // roads & trails
    for (const road of g.world.roads) {
      ctx.strokeStyle = road.kind === "road" ? "#6b4a2a" : "#8a6a42";
      ctx.lineWidth = road.kind === "road" ? 1.8 : 1.1;
      ctx.setLineDash(road.kind === "road" ? [6, 3] : [2, 3]);
      ctx.globalAlpha = road.kind === "road" ? 0.8 : 0.55;
      ctx.beginPath();
      road.pts.forEach((p, i) => {
        const [mx, my] = MapView.toMap(p.x, p.z);
        if (i) ctx.lineTo(mx, my);
        else ctx.moveTo(mx, my);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // border
    const b = g.world.border;
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "#7a1f1f";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([9, 4, 2, 4]);
    ctx.beginPath();
    for (let i = 0; i <= b.length / 2; i++) {
      const k = i % (b.length / 2);
      const [mx, my] = MapView.toMap(b[k * 2], b[k * 2 + 1]);
      if (i) ctx.lineTo(mx, my);
      else ctx.moveTo(mx, my);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // vignette / aged edges
    const grd = ctx.createRadialGradient(MW / 2, MH / 2, MW * 0.35, MW / 2, MH / 2, MW * 0.75);
    grd.addColorStop(0, "rgba(80,50,20,0)");
    grd.addColorStop(1, "rgba(80,50,20,0.45)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, MW, MH);
    // compass rose
    ctx.save();
    ctx.translate(MW - 80, MH - 90);
    ctx.fillStyle = "#5a3a1a";
    ctx.globalAlpha = 0.7;
    for (let k = 0; k < 4; k++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -42);
      ctx.lineTo(7, 0);
      ctx.lineTo(-7, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.font = "bold 16px Cinzel, serif";
    ctx.textAlign = "center";
    ctx.fillText("N", 0, -48);
    ctx.restore();
  }

  updatePoison(force = false): void {
    const g = this.game;
    const now = performance.now();
    if (!force && now - this.poisonT < 1500) return;
    this.poisonT = now;
    const P = g.poison;
    const W = 352, H = 320;
    const c = this.poisonCanvas;
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const wx = ((x + 0.5) / W) * WORLD.width - WORLD.halfW;
        const wz = WORLD.halfD - ((y + 0.5) / H) * WORLD.depth;
        const cov = P.coverageAt(wx, wz);
        const o = (y * W + x) * 4;
        if (cov <= 0.02) continue;
        const n = NOISE.noise2(x * 0.15 + g.elapsed * 0.05, y * 0.15);
        img.data[o] = 110 + n * 30;
        img.data[o + 1] = 50 + Math.max(0, n) * 120;
        img.data[o + 2] = 140;
        img.data[o + 3] = Math.round(cov * 150);
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const before = this.screenToMap(mx, my);
      this.zoom = clamp(this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.6, 8);
      const after = this.screenToMap(mx, my);
      this.panX += (after[0] - before[0]);
      this.panY += (after[1] - before[1]);
    }, { passive: false });
    canvas.addEventListener("mousedown", (e) => {
      this.dragging = true;
      this.dragMoved = 0;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener("mousemove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      const s = this.scale();
      this.panX += dx / s;
      this.panY += dy / s;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener("mouseup", (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.dragMoved < 5 && e.target === canvas) {
        const r = canvas.getBoundingClientRect();
        const [mx, my] = this.screenToMap(e.clientX - r.left, e.clientY - r.top);
        const [wx, wz] = MapView.toWorld(mx, my);
        if (e.button === 0) this.addMarker(wx, wz);
      }
    });
    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      this.removeMarkerNear(e.clientX - r.left, e.clientY - r.top);
    });
  }

  private addMarker(x: number, z: number): void {
    const q = this.game.quests;
    if (q.markers.length >= 20) q.markers.shift();
    q.markers.push({ x, z, label: `Marker ${q.markers.length + 1}` });
    this.game.audio.sfx("uiClick");
  }
  private removeMarkerNear(sx: number, sy: number): void {
    const q = this.game.quests;
    let best = -1, bd = 18;
    q.markers.forEach((m, i) => {
      const [px, py] = this.mapToScreen(...MapView.toMap(m.x, m.z));
      const d = Math.hypot(px - sx, py - sy);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best >= 0) q.markers.splice(best, 1);
  }

  private scale(): number {
    const c = this.canvas!;
    return Math.min(c.clientWidth / MW, c.clientHeight / MH) * this.zoom;
  }
  private mapToScreen(mx: number, my: number): [number, number] {
    const c = this.canvas!;
    const s = this.scale();
    return [c.clientWidth / 2 + (mx - MW / 2 + this.panX) * s, c.clientHeight / 2 + (my - MH / 2 + this.panY) * s];
  }
  private screenToMap(sx: number, sy: number): [number, number] {
    const c = this.canvas!;
    const s = this.scale();
    return [(sx - c.clientWidth / 2) / s + MW / 2 - this.panX, (sy - c.clientHeight / 2) / s + MH / 2 - this.panY];
  }

  centerOnPlayer(): void {
    const p = this.game.player.position;
    const [mx, my] = MapView.toMap(p.x, p.z);
    this.panX = MW / 2 - mx;
    this.panY = MH / 2 - my;
    this.zoom = 1.6;
  }

  render(): void {
    const c = this.canvas;
    if (!c) return;
    const g = this.game;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(c.clientWidth * dpr)) {
      c.width = Math.round(c.clientWidth * dpr);
      c.height = Math.round(c.clientHeight * dpr);
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#1a140c";
    ctx.fillRect(0, 0, c.clientWidth, c.clientHeight);
    const [x0, y0] = this.mapToScreen(0, 0);
    const s = this.scale();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, x0, y0, MW * s, MH * s);
    this.updatePoison();
    ctx.globalAlpha = 0.85;
    ctx.drawImage(this.poisonCanvas, x0, y0, MW * s, MH * s);
    ctx.globalAlpha = 1;
    this.drawIcons(ctx, (x, z) => this.mapToScreen(...MapView.toMap(x, z)), Math.min(1.6, 0.7 + this.zoom * 0.3), true);
  }

  /** Shared icon renderer for the big map and the minimap. */
  drawIcons(ctx: CanvasRenderingContext2D, proj: (x: number, z: number) => [number, number], k: number, labels: boolean): void {
    const g = this.game;
    const disc = g.discovered;
    const rum = g.quests.rumors;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // peaks
    for (const s of g.world.sites.values()) {
      if (s.kind !== "peak") continue;
      const known = s.id === "peak_comapedrosa" || disc.has(s.id);
      if (!known) continue;
      const [x, y] = proj(s.x, s.z);
      ctx.fillStyle = "#3a2a1a";
      ctx.beginPath();
      ctx.moveTo(x, y - 7 * k);
      ctx.lineTo(x + 6 * k, y + 4 * k);
      ctx.lineTo(x - 6 * k, y + 4 * k);
      ctx.closePath();
      ctx.fill();
      if (labels) {
        ctx.font = `italic ${11 * k}px "EB Garamond", serif`;
        ctx.fillText(s.name, x, y + 13 * k);
      }
    }
    // villages
    for (const v of g.world.villages) {
      if (!disc.has(v.id) && v.id !== "ordino") continue;
      const [x, y] = proj(v.x, v.z);
      ctx.fillStyle = v.state === "abandoned" ? "#5a4a4a" : "#7a2a1a";
      ctx.strokeStyle = "#2a1a0a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(x - 4 * k, y - 4 * k, 8 * k, 8 * k);
      ctx.fill();
      ctx.stroke();
      if (labels) {
        ctx.font = `bold ${13 * k}px Cinzel, serif`;
        ctx.fillStyle = "#2b1d10";
        ctx.fillText(v.name + (v.state === "abandoned" ? " (abandoned)" : v.state === "refuge" ? " (refuge)" : ""), x, y - 12 * k);
      }
    }
    // sites
    const glyph: Record<string, [string, string]> = {
      boss_flame: ["☠", "#c0301a"], boss_forest: ["☠", "#2a8a2a"], boss_frost: ["☠", "#2a6ac0"], boss_shadow: ["☠", "#4a4a6a"], boss_thunder: ["☠", "#b89a10"],
      zorgcave: ["☠", "#6a0a8a"], forge: ["⚒", "#3a2a1a"],
    };
    for (const s of g.world.sites.values()) {
      if (s.kind === "peak") continue;
      const isBoss = !!glyph[s.id];
      const known = disc.has(s.id) || s.id === "zorgcave";
      const rumored = rum.has(s.id);
      if (!known && !rumored) continue;
      const [x, y] = proj(s.x, s.z);
      if (!known && rumored) {
        ctx.font = `bold ${18 * k}px Cinzel, serif`;
        ctx.fillStyle = "#5a2a8a";
        ctx.fillText("?", x, y);
        continue;
      }
      if (isBoss) {
        const slot = g.bosses.slots.find((b) => b.siteId === s.id);
        const [gl, col] = glyph[s.id];
        ctx.font = `${18 * k}px serif`;
        ctx.fillStyle = slot?.defeated ? "#7a7a7a" : col;
        ctx.fillText(slot?.defeated ? "✓" : gl, x, y);
      } else {
        ctx.fillStyle = "#3a2a1a";
        ctx.beginPath();
        ctx.arc(x, y, 3 * k, 0, Math.PI * 2);
        ctx.fill();
      }
      if (labels) {
        ctx.font = `italic ${11 * k}px "EB Garamond", serif`;
        ctx.fillStyle = "#2b1d10";
        ctx.fillText(s.name, x, y + 14 * k);
      }
    }
    // objective
    const op = g.quests.objectivePos(g.quests.tracked);
    if (op) {
      const [x, y] = proj(op.x, op.z);
      ctx.fillStyle = "#ffcf3a";
      ctx.strokeStyle = "#5a3a00";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 9 * k);
      ctx.lineTo(x + 7 * k, y);
      ctx.lineTo(x, y + 9 * k);
      ctx.lineTo(x - 7 * k, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // custom markers
    for (const m of g.quests.markers) {
      const [x, y] = proj(m.x, m.z);
      ctx.fillStyle = "#1f6aa8";
      ctx.beginPath();
      ctx.arc(x, y - 6 * k, 5 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - 4 * k, y - 5 * k);
      ctx.lineTo(x + 4 * k, y - 5 * k);
      ctx.lineTo(x, y + 3 * k);
      ctx.fill();
    }
    // player
    const p = g.player.position;
    const [px, py] = proj(p.x, p.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(g.player.yaw);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#a01010";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -10 * k);
    ctx.lineTo(7 * k, 8 * k);
    ctx.lineTo(0, 4 * k);
    ctx.lineTo(-7 * k, 8 * k);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Minimap: north-up crop around the player. */
  renderMini(c: HTMLCanvasElement): void {
    const g = this.game;
    const size = c.width;
    const ctx = c.getContext("2d")!;
    const p = g.player.position;
    const [mx, my] = MapView.toMap(p.x, p.z);
    const span = 95; // map pixels across
    const s = size / span;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#2a2418";
    ctx.fillRect(0, 0, size, size);
    if (g.interiors.current) {
      ctx.fillStyle = "#e8c66a";
      ctx.font = `${size * 0.09}px Cinzel, serif`;
      ctx.textAlign = "center";
      ctx.fillText("Underground", size / 2, size / 2);
      return;
    }
    ctx.drawImage(this.base, mx - span / 2, my - span / 2, span, span, 0, 0, size, size);
    this.updatePoison();
    const ps = 352 / MW;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(this.poisonCanvas, (mx - span / 2) * ps, (my - span / 2) * ps, span * ps, span * ps, 0, 0, size, size);
    ctx.globalAlpha = 1;
    this.drawIcons(ctx, (x, z) => {
      const [ax, ay] = MapView.toMap(x, z);
      let sx = size / 2 + (ax - mx) * s, sy = size / 2 + (ay - my) * s;
      // clamp the objective to the rim
      const dx = sx - size / 2, dy = sy - size / 2;
      const d = Math.hypot(dx, dy);
      if (d > size * 0.45) {
        sx = size / 2 + (dx / d) * size * 0.45;
        sy = size / 2 + (dy / d) * size * 0.45;
      }
      return [sx, sy];
    }, size / 180, false);
  }
}
