/**
 * Keyboard + mouse input with pointer lock. Tracks "pressed this frame" edges so gameplay code
 * can poll cleanly from the fixed update loop.
 */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  mouseButtons = [false, false, false];
  private mousePressed = [false, false, false];
  private mouseReleased = [false, false, false];
  mouseDownTime = [0, 0, 0];
  pointerLocked = false;
  /** When false, gameplay ignores input (menus open). */
  enabled = true;
  private lastAnyInput = 0;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      this.down.add(e.code);
      this.pressed.add(e.code);
      this.lastAnyInput = performance.now();
      if (["Space", "Tab", "KeyQ", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener("blur", () => {
      this.down.clear();
      this.mouseButtons = [false, false, false];
    });
    canvas.addEventListener("mousedown", (e) => {
      if (e.button > 2) return;
      this.mouseButtons[e.button] = true;
      this.mousePressed[e.button] = true;
      this.mouseDownTime[e.button] = performance.now();
      this.lastAnyInput = performance.now();
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button > 2) return;
      if (this.mouseButtons[e.button]) this.mouseReleased[e.button] = true;
      this.mouseButtons[e.button] = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("mousemove", (e) => {
      if (this.pointerLocked) {
        // Guard against occasional huge spikes some browsers emit on lock
        if (Math.abs(e.movementX) < 400 && Math.abs(e.movementY) < 400) {
          this.mouseDX += e.movementX;
          this.mouseDY += e.movementY;
        }
      } else if (this.mouseButtons[0] || this.mouseButtons[2]) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
  }

  requestPointerLock(): void {
    if (document.pointerLockElement === this.canvas) return;
    try {
      const p = (this.canvas.requestPointerLock as any).call(this.canvas);
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
      /* not allowed (e.g. headless) */
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.enabled && this.down.has(code);
  }
  wasPressed(code: string): boolean {
    return this.enabled && this.pressed.has(code);
  }
  /** Ignores the enabled flag (used by menus). */
  rawPressed(code: string): boolean {
    return this.pressed.has(code);
  }
  wasReleased(code: string): boolean {
    return this.enabled && this.released.has(code);
  }
  mouseDown(b: number): boolean {
    return this.enabled && this.mouseButtons[b];
  }
  mouseWasPressed(b: number): boolean {
    return this.enabled && this.mousePressed[b];
  }
  mouseWasReleased(b: number): boolean {
    return this.enabled && this.mouseReleased[b];
  }
  mouseHeldFor(b: number): number {
    return this.mouseButtons[b] ? (performance.now() - this.mouseDownTime[b]) / 1000 : 0;
  }
  idleSeconds(): number {
    return (performance.now() - this.lastAnyInput) / 1000;
  }

  /** Simulate a key press (used by automated tests / touch helpers). */
  simulateKey(code: string, isDown: boolean): void {
    if (isDown) {
      this.down.add(code);
      this.pressed.add(code);
    } else {
      this.down.delete(code);
      this.released.add(code);
    }
  }
  simulateMouse(button: number, isDown: boolean): void {
    if (isDown) {
      this.mouseButtons[button] = true;
      this.mousePressed[button] = true;
      this.mouseDownTime[button] = performance.now();
    } else {
      this.mouseButtons[button] = false;
      this.mouseReleased[button] = true;
    }
  }

  /** Call at end of frame. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed = [false, false, false];
    this.mouseReleased = [false, false, false];
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
