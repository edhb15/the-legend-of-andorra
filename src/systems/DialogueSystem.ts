import type { Game, GameState } from "../core/Game";

/**
 * Promise-based dialogue flow: `await say(...)`, `await ask(...)`. The UI renders the box with
 * the speaker's name, a typewriter effect and clickable choices.
 */
export class DialogueSystem {
  active = false;
  private prevState: GameState = "playing";
  private resolver: ((v: number) => void) | null = null;
  speakerColor = "#e8c66a";

  constructor(private game: Game) {}

  open(): void {
    if (this.active) return;
    this.active = true;
    this.prevState = this.game.state === "dialogue" ? "playing" : this.game.state;
    this.game.state = "dialogue";
    this.game.time.paused = true;
    this.game.input.exitPointerLock();
  }

  close(): void {
    if (!this.active) return;
    this.active = false;
    this.game.ui.hideDialogue();
    if (this.game.state === "dialogue") this.game.state = this.prevState === "cinematic" ? "cinematic" : "playing";
    this.game.time.paused = false;
    if (this.game.state === "playing") this.game.input.requestPointerLock();
  }

  /** Show one or more lines; resolves after the last is dismissed. */
  async say(speaker: string, lines: string | string[], color?: string): Promise<void> {
    this.open();
    const arr = Array.isArray(lines) ? lines : [lines];
    for (const line of arr) {
      await new Promise<number>((res) => {
        this.resolver = res;
        this.game.ui.showDialogue(speaker, line, [], color ?? this.speakerColor, (i) => this.pick(i));
      });
    }
  }

  /** Ask a question with choices; resolves with the chosen index. */
  async ask(speaker: string, text: string, choices: string[], color?: string): Promise<number> {
    this.open();
    return await new Promise<number>((res) => {
      this.resolver = res;
      this.game.ui.showDialogue(speaker, text, choices, color ?? this.speakerColor, (i) => this.pick(i));
    });
  }

  pick(i: number): void {
    const r = this.resolver;
    this.resolver = null;
    this.game.audio.sfx("uiClick");
    r?.(i);
  }

  /** Convenience for a whole conversation. */
  async run(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } finally {
      this.close();
    }
  }
}
