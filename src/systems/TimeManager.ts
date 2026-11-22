import { DOOM_DAYS, START_HOUR } from "../config";
import { clamp01 } from "../core/MathUtil";
import type { Game } from "../core/Game";

/**
 * Keeps the in-game clock. `minutes` counts game minutes since Day 1 00:00.
 * The cloud is released at Day 1 07:00 and consumes Andorra exactly 14 days later.
 */
export class TimeManager {
  minutes = START_HOUR * 60;
  paused = false;
  /** Extra multiplier (sleeping fast-forward / debug). */
  scale = 1;
  readonly startMinutes = START_HOUR * 60;
  readonly endMinutes = START_HOUR * 60 + DOOM_DAYS * 1440;
  private lastDay = 1;
  private lastHour = -1;

  constructor(private game: Game) {}

  get day(): number {
    return Math.floor(this.minutes / 1440) + 1;
  }
  /** Hour of day as float 0..24 */
  get hour(): number {
    return (this.minutes % 1440) / 60;
  }
  /** 0..1 progress of the 14-day apocalypse. */
  get doomProgress(): number {
    return clamp01((this.minutes - this.startMinutes) / (this.endMinutes - this.startMinutes));
  }
  /** Fractional days elapsed since the cloud was released. */
  get daysElapsed(): number {
    return (this.minutes - this.startMinutes) / 1440;
  }
  get minutesLeft(): number {
    return Math.max(0, this.endMinutes - this.minutes);
  }
  get isNight(): boolean {
    const h = this.hour;
    return h < 5.5 || h > 20.5;
  }
  /** 0 = midnight dark, 1 = full day */
  get daylight(): number {
    const h = this.hour;
    if (h < 5 || h > 21.5) return 0;
    if (h < 7.5) return (h - 5) / 2.5;
    if (h > 19) return 1 - (h - 19) / 2.5;
    return 1;
  }

  gameMinutesPerSecond(): number {
    return 1440 / (Math.max(0.1, this.game.settings.dayLengthMinutes) * 60);
  }

  update(dt: number): void {
    if (this.paused) return;
    this.minutes += dt * this.gameMinutesPerSecond() * this.scale;
    this.checkEvents();
  }

  /** Advance time instantly (sleeping). */
  advance(gameMinutes: number): void {
    this.minutes += gameMinutes;
    this.checkEvents();
  }

  private checkEvents(): void {
    if (this.minutes >= this.endMinutes) {
      this.minutes = this.endMinutes;
      this.game.events.emit("doom");
    }
    const d = this.day;
    if (d !== this.lastDay) {
      const prev = this.lastDay;
      this.lastDay = d;
      if (d > prev) this.game.events.emit("newDay", d);
    }
    const hr = Math.floor(this.hour);
    if (hr !== this.lastHour) {
      this.lastHour = hr;
      this.game.events.emit("hour", hr);
    }
  }

  serialize() {
    return { minutes: this.minutes };
  }
  deserialize(d: any) {
    if (d && typeof d.minutes === "number") {
      this.minutes = d.minutes;
      this.lastDay = this.day;
      this.lastHour = Math.floor(this.hour);
    }
  }
}
