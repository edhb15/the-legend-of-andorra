import type { Vector3 } from "@babylonjs/core";
import type { Game } from "../core/Game";
import { RNG, clamp01, lerp } from "../core/MathUtil";

type Mood = "silence" | "title" | "village" | "explore" | "night" | "cave" | "battle" | "boss" | "finalboss" | "finalboss2" | "finalboss3" | "death" | "forge" | "victory" | "ending";

interface MoodDef {
  tempo: number;
  root: number; // midi
  scale: number[];
  prog: number[]; // chord roots as scale degrees
  pad: number;
  pluck: number;
  melody: number;
  bass: number;
  drums: number;
  choir: number;
  bells: number;
  strings: number;
  dark: boolean;
}

const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const HARMONIC = [0, 2, 3, 5, 7, 8, 11];

const MOODS: Record<Exclude<Mood, "silence">, MoodDef> = {
  title: { tempo: 72, root: 50, scale: DORIAN, prog: [0, 6, 3, 4], pad: 0.5, pluck: 0.6, melody: 0.5, bass: 0.3, drums: 0, choir: 0.35, bells: 0.2, strings: 0, dark: false },
  village: { tempo: 98, root: 55, scale: IONIAN, prog: [0, 4, 5, 3], pad: 0.25, pluck: 0.7, melody: 0.55, bass: 0.4, drums: 0.25, choir: 0, bells: 0.15, strings: 0, dark: false },
  explore: { tempo: 80, root: 50, scale: DORIAN, prog: [0, 3, 6, 4], pad: 0.55, pluck: 0.4, melody: 0.35, bass: 0.3, drums: 0, choir: 0.15, bells: 0.2, strings: 0, dark: false },
  night: { tempo: 62, root: 45, scale: AEOLIAN, prog: [0, 5, 3, 4], pad: 0.5, pluck: 0.15, melody: 0.2, bass: 0.2, drums: 0, choir: 0.1, bells: 0.35, strings: 0, dark: true },
  cave: { tempo: 56, root: 38, scale: PHRYGIAN, prog: [0, 1, 0, 6], pad: 0.55, pluck: 0, melody: 0.1, bass: 0.35, drums: 0, choir: 0.2, bells: 0.4, strings: 0, dark: true },
  battle: { tempo: 134, root: 52, scale: AEOLIAN, prog: [0, 5, 6, 4], pad: 0.2, pluck: 0, melody: 0.3, bass: 0.6, drums: 0.7, choir: 0, bells: 0, strings: 0.7, dark: true },
  boss: { tempo: 144, root: 48, scale: HARMONIC, prog: [0, 5, 4, 0], pad: 0.3, pluck: 0, melody: 0.45, bass: 0.7, drums: 0.9, choir: 0.5, bells: 0.1, strings: 0.8, dark: true },
  finalboss: { tempo: 150, root: 50, scale: HARMONIC, prog: [0, 5, 1, 4], pad: 0.4, pluck: 0, melody: 0.5, bass: 0.8, drums: 1, choir: 0.7, bells: 0.2, strings: 0.9, dark: true },
  finalboss2: { tempo: 156, root: 49, scale: PHRYGIAN, prog: [0, 1, 6, 4], pad: 0.5, pluck: 0, melody: 0.5, bass: 0.85, drums: 1, choir: 0.8, bells: 0.3, strings: 0.9, dark: true },
  finalboss3: { tempo: 164, root: 50, scale: HARMONIC, prog: [0, 1, 5, 4], pad: 0.6, pluck: 0, melody: 0.6, bass: 0.9, drums: 1, choir: 1, bells: 0.4, strings: 1, dark: true },
  death: { tempo: 48, root: 38, scale: PHRYGIAN, prog: [0, 1, 0, 1], pad: 0.7, pluck: 0, melody: 0, bass: 0.4, drums: 0, choir: 0.8, bells: 0.2, strings: 0, dark: true },
  forge: { tempo: 92, root: 53, scale: IONIAN, prog: [0, 3, 4, 5], pad: 0.5, pluck: 0.7, melody: 0.4, bass: 0.4, drums: 0.4, choir: 0.8, bells: 0.6, strings: 0.3, dark: false },
  victory: { tempo: 110, root: 55, scale: IONIAN, prog: [0, 3, 4, 0], pad: 0.5, pluck: 0.6, melody: 0.6, bass: 0.5, drums: 0.4, choir: 0.6, bells: 0.5, strings: 0.3, dark: false },
  ending: { tempo: 84, root: 48, scale: IONIAN, prog: [0, 5, 3, 4], pad: 0.6, pluck: 0.5, melody: 0.6, bass: 0.4, drums: 0.15, choir: 0.6, bells: 0.4, strings: 0.2, dark: false },
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Fully procedural soundtrack & sound effects (Web Audio API). */
export class AudioManager {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private mood: Mood = "silence";
  private moodBus: GainNode | null = null;
  private nextStep = 0;
  private step = 0;
  private rng = new RNG(99);
  private darkness = 0;
  private override: { mood: Mood; until: number } | null = null;
  private location: "village" | "explore" | "cave" | "night" = "explore";
  private wind: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private river: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private poisonHiss: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private poisonLevel = 0;
  private heartT = 0;
  private ambT = 0;
  private melodyDeg = 0;
  private started = false;

  constructor(private game: Game) {}

  init(): void {
    const resume = () => {
      this.ensure();
      if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
    };
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
    // phones only allow sound to start from a finished tap
    window.addEventListener("touchend", resume);
    window.addEventListener("click", resume);
  }

  private ensure(): void {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    } catch {
      return;
    }
    const c = this.ctx!;
    this.master = c.createGain();
    this.master.connect(c.destination);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(this.master);
    this.musicBus = c.createGain();
    this.sfxBus = c.createGain();
    this.ambBus = c.createGain();
    this.musicBus.connect(comp);
    this.sfxBus.connect(comp);
    this.ambBus.connect(comp);
    // noise buffer
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // reverb impulse
    const len = c.sampleRate * 2.8;
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb = c.createConvolver();
    this.reverb.buffer = ir;
    this.reverbSend = c.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(comp);
    this.applyVolumes();
    this.startAmbience();
    this.started = true;
    this.nextStep = c.currentTime + 0.1;
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const s = this.game.settings;
    this.master.gain.value = s.masterVolume;
    this.musicBus.gain.value = s.musicVolume * 0.55;
    this.sfxBus.gain.value = s.sfxVolume * 0.8;
    this.ambBus.gain.value = s.ambientVolume * 0.6;
  }

  // ------------------------------------------------------------------ music control
  setMusic(m: Mood | string, holdSeconds = 9999): void {
    const mood = m as Mood;
    if (["boss", "finalboss", "finalboss2", "finalboss3", "death", "forge", "victory", "ending", "title", "battle"].includes(mood)) {
      this.override = { mood, until: performance.now() + (mood === "victory" ? 9000 : holdSeconds * 1000) };
    } else this.override = null;
    this.switchMood(mood);
  }

  setLocation(loc: "village" | "explore" | "cave" | "night", force = false): void {
    this.location = loc;
    if (force) this.override = null;
  }

  setDarkness(p: number): void {
    this.darkness = p;
  }

  setPoisonLevel(l: number): void {
    this.poisonLevel = l;
  }

  private switchMood(m: Mood): void {
    if (m === this.mood || !this.ctx) {
      this.mood = m;
      return;
    }
    const c = this.ctx;
    if (this.moodBus) {
      const old = this.moodBus;
      old.gain.setTargetAtTime(0, c.currentTime, 0.6);
      setTimeout(() => old.disconnect(), 4000);
    }
    this.moodBus = c.createGain();
    this.moodBus.gain.value = 0;
    this.moodBus.gain.setTargetAtTime(1, c.currentTime + 0.2, 0.8);
    this.moodBus.connect(this.musicBus);
    this.moodBus.connect(this.reverbSend);
    this.mood = m;
    this.step = 0;
    this.nextStep = c.currentTime + 0.15;
  }

  private autoMood(): Mood {
    const g = this.game;
    if (this.override && performance.now() < this.override.until) return this.override.mood;
    this.override = null;
    if (g.state === "title" || g.state === "loading") return "title";
    const p = g.player?.position;
    if (!p) return "explore";
    if (g.bosses?.active) return g.bosses.active.id === "zorg" ? "finalboss" : "boss";
    const inCombat = g.enemies.all().some((e) => e.alive && (e.state === "chase" || e.state === "windup" || e.state === "strike") && Math.hypot(e.position.x - p.x, e.position.z - p.z) < 35);
    if (inCombat) return "battle";
    if (g.interiors.current) return "cave";
    if (g.victory > 0) return "ending";
    const nearVillage = g.world.villages.some((v) => Math.hypot(v.x - p.x, v.z - p.z) < 90 && v.state !== "abandoned");
    if (g.time.isNight) return "night";
    if (nearVillage) return "village";
    return "explore";
  }

  // ------------------------------------------------------------------ synthesis helpers
  private env(g: GainNode, t: number, a: number, d: number, peak: number, sustainEnd?: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    if (sustainEnd !== undefined) g.gain.setValueAtTime(Math.max(0.0002, peak), sustainEnd);
    g.gain.exponentialRampToValueAtTime(0.0001, (sustainEnd ?? t + a) + d);
  }

  private osc(type: OscillatorType, f: number, t: number, dur: number, vol: number, dest: AudioNode, opts: { a?: number; d?: number; detune?: number; filter?: number; q?: number; pitchTo?: number; vib?: number } = {}): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (opts.pitchTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.pitchTo), t + dur);
    if (opts.detune) o.detune.value = opts.detune;
    if (opts.vib) {
      const l = c.createOscillator();
      const lg = c.createGain();
      l.frequency.value = 5.5;
      lg.gain.value = opts.vib;
      l.connect(lg).connect(o.frequency);
      l.start(t);
      l.stop(t + dur + 0.1);
    }
    const g = c.createGain();
    let node: AudioNode = o;
    if (opts.filter) {
      const fl = c.createBiquadFilter();
      fl.type = "lowpass";
      fl.frequency.value = opts.filter;
      fl.Q.value = opts.q ?? 0.7;
      o.connect(fl);
      node = fl;
    }
    node.connect(g).connect(dest);
    const a = opts.a ?? 0.005, d = opts.d ?? dur;
    this.env(g, t, a, d, vol, d < dur ? t + dur - d : undefined);
    o.start(t);
    o.stop(t + dur + (opts.d ?? 0) + 0.1);
  }

  private noiseHit(t: number, dur: number, vol: number, dest: AudioNode, type: BiquadFilterType, f: number, q = 1, fTo?: number, a = 0.003): void {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const fl = c.createBiquadFilter();
    fl.type = type;
    fl.frequency.setValueAtTime(f, t);
    if (fTo) fl.frequency.exponentialRampToValueAtTime(Math.max(30, fTo), t + dur);
    fl.Q.value = q;
    const g = c.createGain();
    s.connect(fl).connect(g).connect(dest);
    this.env(g, t, a, dur, vol);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + a + 0.05);
  }

  // ------------------------------------------------------------------ music scheduler
  private scheduleMusic(): void {
    const c = this.ctx!;
    const m = this.mood;
    if (m === "silence" || !this.moodBus) return;
    const def = MOODS[m as Exclude<Mood, "silence">];
    const dark = def.dark ? 1 : this.darkness;
    const spb = 60 / def.tempo / 4; // seconds per 16th
    const bus = this.moodBus;
    while (this.nextStep < c.currentTime + 0.25) {
      const t = this.nextStep;
      const s = this.step;
      const bar = Math.floor(s / 16);
      const inBar = s % 16;
      let scale = def.scale;
      // the apocalypse darkens major moods into minor ones
      if (!def.dark && this.darkness > 0.45 && scale === IONIAN) scale = AEOLIAN;
      else if (!def.dark && this.darkness > 0.7) scale = PHRYGIAN;
      const chordDeg = def.prog[bar % def.prog.length];
      const note = (deg: number, oct = 0) => {
        const n = scale.length;
        const d = ((deg % n) + n) % n;
        const o = Math.floor(deg / n);
        return def.root + scale[d] + 12 * (o + oct);
      };
      const chord = [note(chordDeg), note(chordDeg + 2), note(chordDeg + 4)];
      const bright = lerp(2400, 900, dark * 0.7);
      const beatLen = spb * 4;
      // pad on bar start
      if (inBar === 0 && def.pad > 0) {
        for (const n of chord) for (const det of [-7, 7]) this.osc("sawtooth", mtof(n), t, beatLen * 4, 0.03 * def.pad, bus, { a: 0.6, d: 1.2, detune: det, filter: bright * 0.6 });
        if (this.darkness > 0.6 || m === "death" || m === "cave") this.osc("sawtooth", mtof(chord[0] + 6), t, beatLen * 4, 0.012 * (this.darkness + 0.3), bus, { a: 1, d: 1.5, filter: 700 });
      }
      // choir
      if (inBar === 0 && def.choir > 0 && (bar % 2 === 0 || def.choir > 0.6)) {
        for (const n of [chord[0] + 12, chord[1] + 12]) this.choir(mtof(n), t, beatLen * 4, 0.05 * def.choir, bus);
      }
      // bass
      if (def.bass > 0) {
        const pattern = def.drums > 0.6 ? [0, 3, 6, 8, 10, 12, 14] : [0, 8];
        if (pattern.includes(inBar)) this.osc(def.drums > 0.6 ? "sawtooth" : "triangle", mtof(chord[0] - 12), t, spb * (def.drums > 0.6 ? 1.6 : 6), 0.12 * def.bass, bus, { a: 0.01, d: spb * 3, filter: 500 });
      }
      // plucked arpeggios
      if (def.pluck > 0 && inBar % 2 === 0) {
        const idx = [0, 1, 2, 1, 0, 2, 1, 2][(inBar / 2) % 8];
        if (this.rng.next() < 0.85) this.osc("triangle", mtof(chord[idx] + 12), t, 0.5, 0.06 * def.pluck, bus, { a: 0.003, d: 0.5, filter: bright * 1.3 });
      }
      // strings ostinato (battle)
      if (def.strings > 0 && (inBar % 2 === 0 || def.strings > 0.85)) {
        const n = inBar % 4 === 0 ? chord[0] : chord[(inBar / 2) % 3];
        this.osc("sawtooth", mtof(n), t, spb * 0.9, 0.04 * def.strings, bus, { a: 0.008, d: spb, filter: 1800 });
      }
      // melody
      if (def.melody > 0 && inBar % 4 === 0 && this.rng.next() < 0.6) {
        const steps = [-2, -1, -1, 0, 1, 1, 2, 3];
        this.melodyDeg = Math.max(-3, Math.min(9, this.melodyDeg + steps[Math.floor(this.rng.next() * steps.length)]));
        if (inBar === 0) this.melodyDeg = chordDeg + [0, 2, 4][Math.floor(this.rng.next() * 3)];
        const len = this.rng.chance(0.3) ? beatLen * 2 : beatLen;
        this.osc(dark > 0.6 ? "sawtooth" : "sine", mtof(note(this.melodyDeg, 1)), t, len, 0.07 * def.melody, bus, { a: 0.06, d: len, vib: 4, filter: dark > 0.6 ? 1600 : 3000 });
      }
      // bells
      if (def.bells > 0 && inBar === 8 && this.rng.next() < def.bells) {
        const f = mtof(chord[Math.floor(this.rng.next() * 3)] + 24);
        for (const [mul, v] of [[1, 1], [2.76, 0.4], [5.4, 0.2]]) this.osc("sine", f * mul, t, 2.5, 0.03 * v, bus, { a: 0.002, d: 2.5 });
      }
      // drums
      if (def.drums > 0) {
        const heavy = def.drums > 0.6;
        if (inBar === 0 || (heavy && inBar === 8) || (heavy && inBar === 10 && bar % 2)) this.kick(t, 0.35 * def.drums, bus);
        if ((heavy && (inBar === 4 || inBar === 12)) || (!heavy && inBar === 8)) this.snare(t, 0.15 * def.drums, bus);
        if (heavy && inBar % 2 === 1) this.noiseHit(t, 0.04, 0.025 * def.drums, bus, "highpass", 7000);
        if (!heavy && inBar % 4 === 2) this.noiseHit(t, 0.06, 0.03 * def.drums, bus, "highpass", 6000);
        if (m.startsWith("finalboss") && inBar === 14) this.timpani(t, 0.3, bus);
      }
      this.step++;
      this.nextStep += spb;
    }
  }

  private choir(f: number, t: number, dur: number, vol: number, dest: AudioNode): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    const f1 = c.createBiquadFilter();
    f1.type = "bandpass";
    f1.frequency.value = 750;
    f1.Q.value = 6;
    const f2 = c.createBiquadFilter();
    f2.type = "bandpass";
    f2.frequency.value = 1150;
    f2.Q.value = 7;
    const g = c.createGain();
    o.connect(f1).connect(g);
    o.connect(f2).connect(g);
    g.connect(dest);
    this.env(g, t, 0.8, 1.2, vol, t + dur - 1.2);
    o.start(t);
    o.stop(t + dur + 0.2);
  }
  private kick(t: number, vol: number, dest: AudioNode): void {
    this.osc("sine", 120, t, 0.35, vol, dest, { pitchTo: 38, a: 0.002, d: 0.35 });
  }
  private snare(t: number, vol: number, dest: AudioNode): void {
    this.noiseHit(t, 0.18, vol, dest, "bandpass", 1800, 0.8);
    this.osc("triangle", 190, t, 0.1, vol * 0.5, dest, { a: 0.002, d: 0.1 });
  }
  private timpani(t: number, vol: number, dest: AudioNode): void {
    this.osc("sine", 90, t, 0.9, vol, dest, { pitchTo: 70, a: 0.004, d: 0.9 });
    this.noiseHit(t, 0.2, vol * 0.3, dest, "lowpass", 400);
  }

  // ------------------------------------------------------------------ ambience
  private startAmbience(): void {
    const c = this.ctx!;
    const mk = (type: BiquadFilterType, f: number, q: number) => {
      const s = c.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      const fl = c.createBiquadFilter();
      fl.type = type;
      fl.frequency.value = f;
      fl.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      s.connect(fl).connect(g).connect(this.ambBus);
      s.start();
      return { src: s, filter: fl, gain: g };
    };
    this.wind = mk("bandpass", 500, 0.6);
    this.river = mk("lowpass", 900, 0.5);
    this.poisonHiss = mk("highpass", 3000, 0.4);
  }

  private updateAmbience(dt: number): void {
    const g = this.game;
    const c = this.ctx!;
    if (!g.player || !this.wind) return;
    const p = g.player.position;
    const inside = !!g.interiors.current;
    const altitude = inside ? 0 : clamp01(p.y / 550);
    const t = c.currentTime;
    const windVol = inside ? 0.02 : 0.04 + altitude * 0.16 + this.darkness * 0.05;
    this.wind.gain.gain.setTargetAtTime(windVol, t, 0.5);
    this.wind.filter.frequency.setTargetAtTime(400 + Math.sin(t * 0.3) * 200 + altitude * 300, t, 0.5);
    const rd = inside ? 999 : g.hydro.riverDistance(p.x, p.z);
    this.river!.gain.gain.setTargetAtTime(rd < 45 ? 0.14 * (1 - rd / 45) : 0, t, 0.4);
    this.poisonHiss!.gain.gain.setTargetAtTime(this.poisonLevel * 0.08, t, 0.3);
    // heartbeat when in poison or low health
    const low = g.player.hp / g.player.maxHp < 0.25 && !g.player.dead;
    this.heartT -= dt;
    if ((this.poisonLevel > 0.2 || low) && this.heartT <= 0) {
      this.heartT = low ? 0.7 : 1.0;
      this.osc("sine", 55, t, 0.15, 0.25, this.sfxBus, { pitchTo: 40, a: 0.005, d: 0.15 });
      this.osc("sine", 50, t + 0.18, 0.15, 0.18, this.sfxBus, { pitchTo: 38, a: 0.005, d: 0.15 });
      if (this.poisonLevel > 0.2 && Math.random() < 0.3) this.osc("square", 880, t, 0.08, 0.02, this.sfxBus, { a: 0.002, d: 0.08 });
    }
    // random ambient events
    this.ambT -= dt;
    if (this.ambT <= 0) {
      this.ambT = 0.6 + Math.random() * 1.8;
      const night = g.time.isNight;
      if (inside) {
        if (Math.random() < 0.5) this.osc("sine", 1200 + Math.random() * 1200, t, 0.3, 0.03, this.reverbSend, { pitchTo: 600, a: 0.002, d: 0.3 });
      } else if (night) {
        if (Math.random() < 0.7 * (1 - this.darkness)) for (let k = 0; k < 3; k++) this.osc("sine", 4300 + Math.random() * 300, t + k * 0.07, 0.04, 0.012, this.ambBus, { a: 0.003, d: 0.04 });
        if (Math.random() < 0.05) this.osc("sine", 380, t, 0.6, 0.02, this.reverbSend, { pitchTo: 330, a: 0.05, d: 0.6 }); // owl
      } else if (Math.random() < 0.6 * (1 - this.darkness * 1.1)) {
        const f = 2200 + Math.random() * 1800;
        const n = 2 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n; k++) this.osc("sine", f, t + k * 0.11, 0.08, 0.018, this.ambBus, { pitchTo: f * (1.2 + Math.random() * 0.3), a: 0.005, d: 0.08 });
      }
      if (this.darkness > 0.5 && !inside && Math.random() < 0.15) this.osc("sawtooth", 45, t, 3, 0.03, this.reverbSend, { a: 1, d: 2, filter: 200 }); // distant rumble
    }
  }

  // ------------------------------------------------------------------ sound effects
  footstep(surface: "grass" | "gravel" | "stone"): void {
    if (!this.ctx || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    const f = surface === "grass" ? 900 : surface === "gravel" ? 1800 : 2600;
    this.noiseHit(t, 0.07, surface === "stone" ? 0.05 : 0.035, this.sfxBus, "bandpass", f, 1.2);
  }

  sfx(name: string, pos?: Vector3): void {
    if (!this.ctx || this.ctx.state !== "running") return;
    const c = this.ctx;
    const t = c.currentTime;
    let vol = 1;
    let dest: AudioNode = this.sfxBus;
    if (pos && this.game.player) {
      const p = this.game.player.position;
      const d = Math.hypot(pos.x - p.x, pos.y - p.y, pos.z - p.z);
      vol = clamp01(1.2 - d / 60);
      if (vol <= 0.02) return;
      const pan = c.createStereoPanner();
      const cam = this.game.camera.camera;
      const right = { x: Math.cos(this.game.camera.yaw), z: -Math.sin(this.game.camera.yaw) };
      const dx = pos.x - cam.position.x, dz = pos.z - cam.position.z;
      const l = Math.hypot(dx, dz) || 1;
      pan.pan.value = Math.max(-0.8, Math.min(0.8, (dx * right.x + dz * right.z) / l));
      pan.connect(this.sfxBus);
      dest = pan;
    }
    const v = (x: number) => x * vol;
    const rv = this.reverbSend;
    switch (name) {
      case "swing": this.noiseHit(t, 0.16, v(0.18), dest, "bandpass", 900, 1.5, 3500, 0.03); break;
      case "swingHeavy": this.noiseHit(t, 0.28, v(0.25), dest, "bandpass", 500, 1.2, 2500, 0.05); break;
      case "spin": this.noiseHit(t, 0.6, v(0.25), dest, "bandpass", 600, 2, 3000, 0.1); break;
      case "charge": this.osc("sine", 200, t, 0.6, v(0.08), dest, { pitchTo: 800, a: 0.05 }); break;
      case "hit": this.noiseHit(t, 0.1, v(0.3), dest, "lowpass", 1500); this.osc("sine", 160, t, 0.12, v(0.25), dest, { pitchTo: 60 }); break;
      case "hitHeavy": this.noiseHit(t, 0.18, v(0.35), dest, "lowpass", 1100); this.osc("sine", 110, t, 0.2, v(0.35), dest, { pitchTo: 45 }); break;
      case "block": for (const f of [820, 1330, 2100]) this.osc("square", f, t, 0.2, v(0.035), dest, { d: 0.2, filter: 3000 }); break;
      case "parry": for (const f of [1200, 1900, 2800, 3600]) this.osc("sine", f, t, 0.5, v(0.06), dest, { d: 0.5 }); this.noiseHit(t, 0.1, v(0.2), dest, "highpass", 3000); break;
      case "playerHurt": this.osc("sawtooth", 220, t, 0.2, v(0.1), dest, { pitchTo: 120, filter: 900 }); this.noiseHit(t, 0.12, v(0.2), dest, "lowpass", 900); break;
      case "jump": this.noiseHit(t, 0.1, v(0.06), dest, "bandpass", 600, 1, 1200); break;
      case "land": this.noiseHit(t, 0.12, v(0.12), dest, "lowpass", 400); break;
      case "dodge": this.noiseHit(t, 0.3, v(0.12), dest, "bandpass", 400, 1, 1600, 0.05); break;
      case "splash": this.noiseHit(t, 0.5, v(0.25), dest, "lowpass", 2500, 0.5, 400); break;
      case "pickup": for (const [k, f] of [[0, 880], [1, 1320]]) this.osc("sine", f, t + k * 0.06, 0.15, v(0.08), dest); break;
      case "coin": for (const [k, f] of [[0, 1568], [1, 2093]]) this.osc("square", f, t + k * 0.07, 0.1, v(0.04), dest, { filter: 5000 }); break;
      case "chestOpen": this.osc("sawtooth", 140, t, 0.5, v(0.05), dest, { pitchTo: 90, filter: 600 }); [523, 659, 784].forEach((f, k) => this.osc("triangle", f, t + 0.4 + k * 0.1, 0.4, v(0.08), dest)); break;
      case "chestRare": [523, 659, 784, 1047, 1319].forEach((f, k) => this.osc("triangle", f, t + 0.6 + k * 0.09, 0.6, v(0.09), dest)); this.noiseHit(t, 0.6, v(0.08), rv, "highpass", 4000); break;
      case "locked": this.osc("square", 150, t, 0.15, v(0.06), dest, { filter: 800 }); this.osc("square", 120, t + 0.12, 0.15, v(0.06), dest, { filter: 800 }); break;
      case "unlock": [660, 990, 1320].forEach((f, k) => this.osc("sine", f, t + k * 0.08, 0.3, v(0.08), dest)); break;
      case "runeOk": this.osc("sine", 660 + Math.random() * 200, t, 0.6, v(0.1), rv); break;
      case "runeFail": this.osc("sawtooth", 160, t, 0.4, v(0.08), dest, { pitchTo: 90, filter: 700 }); break;
      case "ignite": this.noiseHit(t, 0.5, v(0.15), dest, "bandpass", 800, 0.8, 2000, 0.05); break;
      case "fizzle": this.noiseHit(t, 0.4, v(0.1), dest, "highpass", 2000, 0.5, 800); break;
      case "lever": this.osc("square", 90, t, 0.6, v(0.08), dest, { filter: 300 }); this.noiseHit(t, 1.6, v(0.12), dest, "lowpass", 300); break;
      case "dig": for (let k = 0; k < 3; k++) this.noiseHit(t + k * 0.22, 0.12, v(0.15), dest, "lowpass", 700); break;
      case "chop": this.noiseHit(t, 0.08, v(0.25), dest, "bandpass", 1200, 2); this.osc("triangle", 300, t, 0.1, v(0.15), dest, { pitchTo: 150 }); break;
      case "treeFall": this.noiseHit(t, 1.5, v(0.25), dest, "lowpass", 600, 0.5, 120, 0.2); break;
      case "eat": for (let k = 0; k < 3; k++) this.noiseHit(t + k * 0.12, 0.06, v(0.1), dest, "bandpass", 2000); break;
      case "drink": for (let k = 0; k < 4; k++) this.osc("sine", 300 + k * 40, t + k * 0.1, 0.08, v(0.06), dest, { pitchTo: 500 }); break;
      case "equip": this.noiseHit(t, 0.15, v(0.12), dest, "bandpass", 3000, 2); this.osc("square", 1400, t, 0.08, v(0.03), dest, { filter: 4000 }); break;
      case "fanfare": [523, 659, 784, 1047].forEach((f, k) => this.osc("sawtooth", f, t + k * 0.12, 0.5, v(0.06), dest, { filter: 2500, a: 0.01 })); break;
      case "questStart": [392, 523, 659].forEach((f, k) => this.osc("triangle", f, t + k * 0.1, 0.5, v(0.08), rv)); break;
      case "questDone": [523, 659, 784, 1047, 784, 1047].forEach((f, k) => this.osc("triangle", f, t + k * 0.1, 0.5, v(0.08), rv)); break;
      case "lore": [440, 554, 659, 880].forEach((f, k) => this.osc("sine", f, t + k * 0.18, 1.2, v(0.05), rv)); break;
      case "lock": this.osc("sine", 1800, t, 0.06, v(0.05), dest); break;
      case "uiClick": this.osc("sine", 1200, t, 0.04, 0.04, this.sfxBus); break;
      case "uiOpen": this.osc("triangle", 600, t, 0.12, 0.05, this.sfxBus, { pitchTo: 900 }); break;
      case "uiClose": this.osc("triangle", 900, t, 0.12, 0.05, this.sfxBus, { pitchTo: 600 }); break;
      case "alert": this.osc("sawtooth", 300, t, 0.25, v(0.06), dest, { pitchTo: 450, filter: 1200 }); break;
      case "growl": this.osc("sawtooth", 90, t, 0.6, v(0.12), dest, { vib: 8, filter: 500 }); break;
      case "windup": this.osc("sawtooth", 140, t, 0.3, v(0.07), dest, { pitchTo: 200, filter: 600 }); break;
      case "enemySwing": this.noiseHit(t, 0.18, v(0.14), dest, "bandpass", 700, 1.2, 2000, 0.03); break;
      case "bite": this.noiseHit(t, 0.08, v(0.2), dest, "bandpass", 1500, 2); break;
      case "enemyDie": this.osc("sawtooth", 200, t, 0.5, v(0.08), dest, { pitchTo: 60, filter: 800 }); this.noiseHit(t, 0.6, v(0.1), rv, "lowpass", 800); break;
      case "fireball": this.noiseHit(t, 0.5, v(0.2), dest, "bandpass", 600, 0.7, 1800, 0.05); break;
      case "magicCast": this.osc("sine", 400, t, 0.4, v(0.08), rv, { pitchTo: 1200 }); break;
      case "magicHit": this.osc("sine", 900, t, 0.3, v(0.08), dest, { pitchTo: 300 }); break;
      case "explosion": this.noiseHit(t, 0.9, v(0.4), dest, "lowpass", 800, 0.6, 80); this.osc("sine", 70, t, 0.6, v(0.35), dest, { pitchTo: 30 }); break;
      case "iceShatter": for (const f of [2400, 3100, 3900, 5200]) this.osc("sine", f * (0.9 + Math.random() * 0.2), t + Math.random() * 0.05, 0.4, v(0.04), dest); this.noiseHit(t, 0.3, v(0.12), dest, "highpass", 3500); break;
      case "iceShards": this.noiseHit(t, 0.4, v(0.15), dest, "highpass", 2500, 1, 6000); break;
      case "iceBreath": this.noiseHit(t, 2.2, v(0.2), dest, "highpass", 1500, 0.5, 3000, 0.2); break;
      case "fireBreath": this.noiseHit(t, 2.2, v(0.28), dest, "bandpass", 500, 0.5, 900, 0.2); break;
      case "poisonBreath": this.noiseHit(t, 2.2, v(0.22), dest, "bandpass", 300, 0.8, 600, 0.3); break;
      case "thunder": this.noiseHit(t, 0.08, v(0.5), dest, "highpass", 2000); this.noiseHit(t + 0.05, 1.6, v(0.35), rv, "lowpass", 500, 0.5, 60, 0.05); break;
      case "slam": this.osc("sine", 60, t, 0.5, v(0.5), dest, { pitchTo: 28 }); this.noiseHit(t, 0.4, v(0.3), dest, "lowpass", 500); break;
      case "bossRoar": this.roar(t, 1.6, v(0.35), dest, 70); break;
      case "bossGrowl": this.roar(t, 0.8, v(0.25), dest, 90); break;
      case "bossStagger": this.osc("sawtooth", 160, t, 0.5, v(0.12), dest, { pitchTo: 80, filter: 600 }); break;
      case "bossDeath": this.roar(t, 3, v(0.4), dest, 55); this.noiseHit(t + 0.5, 2.5, v(0.3), rv, "lowpass", 600, 0.5, 80); break;
      case "roots": this.noiseHit(t, 0.8, v(0.2), dest, "lowpass", 400, 1, 150); break;
      case "rootBurst": this.noiseHit(t, 0.3, v(0.25), dest, "bandpass", 500, 1); this.osc("sine", 90, t, 0.2, v(0.2), dest, { pitchTo: 50 }); break;
      case "summon": [220, 277, 330].forEach((f, k) => this.osc("sawtooth", f, t + k * 0.1, 0.6, v(0.05), rv, { filter: 900 })); break;
      case "wings": for (let k = 0; k < 4; k++) this.noiseHit(t + k * 0.25, 0.2, v(0.2), dest, "lowpass", 300); break;
      case "teleport": this.osc("sine", 1500, t, 0.4, v(0.08), rv, { pitchTo: 200 }); this.noiseHit(t, 0.4, v(0.1), dest, "highpass", 2000, 1, 400); break;
      case "darkWave": this.osc("sawtooth", 80, t, 0.8, v(0.15), dest, { pitchTo: 160, filter: 500 }); this.noiseHit(t, 0.8, v(0.15), dest, "lowpass", 600); break;
      case "shardCollect": [523, 659, 784, 1047, 1319, 1568].forEach((f, k) => this.osc("sine", f, t + k * 0.08, 1.4, v(0.07), rv)); break;
      case "anvil": for (const f of [900, 1500, 2600, 3700]) this.osc("sine", f, t, 0.9, v(0.06), rv); this.noiseHit(t, 0.05, v(0.3), dest, "highpass", 2000); break;
      case "victoryBlast": this.osc("sine", 50, t, 1.5, v(0.5), dest, { pitchTo: 25 }); [262, 330, 392, 523, 659, 784].forEach((f, k) => this.osc("sawtooth", f, t + 0.1 + k * 0.05, 2.5, v(0.04), rv, { filter: 3000, a: 0.05 })); break;
      case "ability1": this.noiseHit(t, 0.6, v(0.25), dest, "bandpass", 700, 0.7, 2200, 0.02); break;
      case "ability2": [523, 659, 784, 1047].forEach((f, k) => this.osc("sine", f, t + k * 0.06, 0.8, v(0.07), rv)); break;
      case "ability3": this.sfx("iceShatter"); this.osc("sine", 2000, t, 0.6, v(0.06), rv, { pitchTo: 600 }); break;
      case "ability4": this.osc("sine", 600, t, 0.8, v(0.12), rv, { pitchTo: 1800 }); this.osc("sine", 1200, t, 0.8, v(0.08), rv, { pitchTo: 3600 }); break;
      case "ability5": this.sfx("thunder"); break;
      case "ultimate": [262, 330, 392, 523, 659, 784, 1047].forEach((f, k) => this.osc("sawtooth", f, t + k * 0.08, 2, v(0.05), rv, { filter: 4000 })); this.osc("sine", 60, t + 0.6, 1.2, v(0.5), dest, { pitchTo: 25 }); break;
      case "rainbowSlash": [784, 988, 1175, 1568].forEach((f, k) => this.osc("sine", f, t + k * 0.04, 0.6, v(0.08), rv)); this.noiseHit(t, 0.3, v(0.2), dest, "bandpass", 1500, 1, 4000); break;
      case "deathSting": this.osc("sawtooth", 220, t, 2.5, 0.12, rv, { pitchTo: 55, filter: 800 }); this.choir(110, t, 3, 0.08, rv); break;
      case "wasted": this.osc("sine", 55, t, 2, 0.5, this.sfxBus, { pitchTo: 30 }); this.noiseHit(t, 2, 0.2, rv, "lowpass", 400, 0.5, 60); break;
      case "dayBell": for (let k = 0; k < 3; k++) for (const [m, vv] of [[1, 1], [2.76, 0.4], [5.4, 0.2]]) this.osc("sine", 220 * m, t + k * 1.1, 3, 0.05 * vv, rv); break;
      default:
        if (name.startsWith("shardChime")) {
          const i = +name.slice(-1);
          this.osc("sine", mtof(72 + ([0, 4, 7, 11, 14][i] ?? 0)), t, 1.5, 0.1, rv);
        }
        break;
    }
  }

  private roar(t: number, dur: number, vol: number, dest: AudioNode, f: number): void {
    this.osc("sawtooth", f, t, dur, vol * 0.5, dest, { pitchTo: f * 0.7, vib: 12, filter: 700, a: 0.1 });
    this.osc("sawtooth", f * 1.5, t, dur, vol * 0.3, dest, { pitchTo: f, vib: 9, filter: 900, a: 0.1 });
    this.noiseHit(t, dur, vol * 0.4, dest, "bandpass", 400, 0.8, 200, 0.1);
  }

  update(dt: number): void {
    if (!this.ctx || !this.started) return;
    if (this.ctx.state !== "running") return;
    const want = this.autoMood();
    if (want !== this.mood) this.switchMood(want);
    this.scheduleMusic();
    this.updateAmbience(dt);
  }
}
