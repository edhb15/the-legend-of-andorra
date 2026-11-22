/**
 * Keyboard + mouse input with pointer lock. Tracks "pressed this frame" edges so gameplay code
 * can poll cleanly from the fixed update loop. Touch controls (ui/TouchControls) feed the same
 * state through simulateKey / simulateMouse, plus an analog movement axis for the joystick.
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
  /** True while on-screen touch controls are in use (no pointer lock, no mouse look). */
  touchMode = false;
  /** Analog movement from the touch joystick: x = right, y = forward, length 0..1. */
  private axis = { x: 0, y: 0 };
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
    // Mouse buttons and movement come from pointer events. Babylon's scene cancels pointerdown on
    // the canvas, and browsers then never send mousedown/mouseup/mousemove while a button is held,
    // so listening to mouse events would miss every click. Pointer events always arrive.
    const mouseLike = (e: PointerEvent) => e.pointerType !== "touch" && !this.touchMode;
    canvas.addEventListener("pointerdown", (e) => {
      if (mouseLike(e)) this.applyButtons(e.buttons, true);
    });
    window.addEventListener("pointerup", (e) => {
      if (mouseLike(e)) this.applyButtons(e.buttons, false);
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("pointermove", (e) => {
      if (!mouseLike(e)) return;
      // a second button pressed while one is held arrives as a move; it only counts over the game
      this.applyButtons(e.buttons, e.target === canvas);
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

  /**
   * Sync button state from PointerEvent.buttons (bits: 1 left, 2 right, 4 middle) into our
   * indices (0 left, 1 middle, 2 right). Presses only count when `allowPress` (over the canvas);
   * releases count anywhere.
   */
  private applyButtons(buttons: number, allowPress: boolean): void {
    const now = [(buttons & 1) !== 0, (buttons & 4) !== 0, (buttons & 2) !== 0];
    for (let b = 0; b < 3; b++) {
      if (now[b] && !this.mouseButtons[b] && allowPress) {
        this.mouseButtons[b] = true;
        this.mousePressed[b] = true;
        this.mouseDownTime[b] = performance.now();
        this.lastAnyInput = performance.now();
      } else if (!now[b] && this.mouseButtons[b]) {
        this.mouseButtons[b] = false;
        this.mouseReleased[b] = true;
      }
    }
  }

  requestPointerLock(): void {
    if (this.touchMode || document.pointerLockElement === this.canvas) return;
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
  /** Joystick movement (zero when gameplay input is disabled). */
  moveAxis(): { x: number; y: number } {
    return this.enabled ? this.axis : { x: 0, y: 0 };
  }
  setMoveAxis(x: number, y: number): void {
    this.axis.x = x;
    this.axis.y = y;
    if (x || y) this.lastAnyInput = performance.now();
  }
  /** Add camera rotation from a touch drag (in screen pixels). */
  addLook(dx: number, dy: number): void {
    this.mouseDX += dx;
    this.mouseDY += dy;
    this.lastAnyInput = performance.now();
  }
  idleSeconds(): number {
    return (performance.now() - this.lastAnyInput) / 1000;
  }

  /** Simulate a key press (used by automated tests / touch helpers). */
  simulateKey(code: string, isDown: boolean): void {
    this.lastAnyInput = performance.now();
    if (isDown) {
      this.down.add(code);
      this.pressed.add(code);
    } else {
      this.down.delete(code);
      this.released.add(code);
    }
  }
  simulateMouse(button: number, isDown: boolean): void {
    this.lastAnyInput = performance.now();
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
