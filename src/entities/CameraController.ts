import { FreeCamera, Vector3 } from "@babylonjs/core";
import type { Game } from "../core/Game";
import { clamp, damp, dampAngle, yawTo } from "../core/MathUtil";

export type CamMode = "follow" | "cinematic" | "orbit";

/** Third-person orbit camera with collision, lock-on framing and shake. */
export class CameraController {
  camera: FreeCamera;
  mode: CamMode = "orbit";
  yaw = 0;
  pitch = 0.32;
  distance = 6.5;
  targetDistance = 6.5;
  private focus = new Vector3();
  private focusInit = false;
  private shakeAmt = 0;
  private shakeT = 0;
  orbitCenter = new Vector3();
  orbitRadius = 900;
  orbitHeight = 500;
  orbitSpeed = 0.03;
  private orbitAngle = 0;
  cinematicPos = new Vector3();
  cinematicTarget = new Vector3();
  fovTarget = 0.9;

  constructor(private game: Game) {
    this.camera = new FreeCamera("mainCam", new Vector3(0, 400, -800), game.scene);
    this.camera.minZ = 0.25;
    this.camera.maxZ = 6500;
    this.camera.fov = 0.9;
    this.camera.inputs.clear();
  }

  shake(amount: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  /** Horizontal forward vector (for camera-relative movement). */
  forwardXZ(): { x: number; z: number } {
    return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
  }

  snapBehindPlayer(): void {
    const p = this.game.player;
    if (!p) return;
    this.yaw = p.yaw;
    this.pitch = 0.3;
    this.focus.copyFrom(p.position).addInPlaceFromFloats(0, 1.55, 0);
    this.focusInit = true;
  }

  update(dt: number): void {
    const g = this.game;
    const cam = this.camera;
    this.shakeT += dt;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
    const sh = this.shakeAmt;
    const shakeOff = new Vector3(Math.sin(this.shakeT * 53) * sh * 0.25, Math.sin(this.shakeT * 61 + 1) * sh * 0.25, Math.cos(this.shakeT * 47) * sh * 0.2);
    cam.fov = damp(cam.fov, this.fovTarget, 4, dt);

    if (this.mode === "orbit") {
      this.orbitAngle += dt * this.orbitSpeed;
      const c = this.orbitCenter;
      cam.position.set(c.x + Math.sin(this.orbitAngle) * this.orbitRadius, c.y + this.orbitHeight, c.z + Math.cos(this.orbitAngle) * this.orbitRadius);
      cam.setTarget(c);
      return;
    }
    if (this.mode === "cinematic") {
      cam.position.copyFrom(this.cinematicPos).addInPlace(shakeOff);
      cam.setTarget(this.cinematicTarget);
      return;
    }
    const p = g.player;
    if (!p) return;
    const inp = g.input;
    const sens = 0.0025 * g.settings.mouseSensitivity;
    if (g.state === "playing") {
      this.yaw += inp.mouseDX * sens;
      this.pitch += inp.mouseDY * sens * (g.settings.invertY ? -1 : 1);
      if (inp.wheel) this.targetDistance = clamp(this.targetDistance + inp.wheel * 0.8, 2.2, 16);
      // arrow keys as an alternative camera control
      if (inp.isDown("ArrowLeft")) this.yaw -= dt * 2;
      if (inp.isDown("ArrowRight")) this.yaw += dt * 2;
      if (inp.isDown("ArrowUp")) this.pitch -= dt * 1.5;
      if (inp.isDown("ArrowDown")) this.pitch += dt * 1.5;
    }
    const lock = g.combat.lockTarget;
    let focusTarget = p.position.add(new Vector3(0, 1.55, 0));
    if (lock && lock.alive) {
      const lp = lock.lockPoint();
      const desired = yawTo(p.position.x, p.position.z, lp.x, lp.z);
      this.yaw = dampAngle(this.yaw, desired, 6, dt);
      this.pitch = damp(this.pitch, 0.22, 3, dt);
      focusTarget = Vector3.Lerp(focusTarget, lp, 0.25);
    }
    this.pitch = clamp(this.pitch, -0.6, 1.25);
    if (!this.focusInit) {
      this.focus.copyFrom(focusTarget);
      this.focusInit = true;
    }
    this.focus.x = damp(this.focus.x, focusTarget.x, 18, dt);
    this.focus.z = damp(this.focus.z, focusTarget.z, 18, dt);
    this.focus.y = damp(this.focus.y, focusTarget.y, 10, dt);
    this.distance = damp(this.distance, this.targetDistance * (lock ? 1.15 : 1), 6, dt);
    const cp = Math.cos(this.pitch);
    const dir = new Vector3(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    const desiredPos = this.focus.subtract(dir.scale(this.distance));
    // collision against terrain / caves / buildings
    const frac = g.physics.raycast(this.focus, desiredPos, 0.35);
    let d = Math.max(0.7, this.distance * frac);
    let pos = this.focus.subtract(dir.scale(d));
    const gh = g.physics.terrainHeight(pos.x, pos.z);
    if (pos.y < gh + 0.45) pos.y = gh + 0.45;
    if (g.physics.interior) {
      const ceil = g.physics.interior.ceilingAt(pos.x, pos.z) - 0.4;
      if (pos.y > ceil) pos.y = ceil;
    }
    cam.position.copyFrom(pos).addInPlace(shakeOff);
    cam.setTarget(this.focus.add(shakeOff.scale(0.5)));
  }

  setCinematic(pos: Vector3, target: Vector3): void {
    this.mode = "cinematic";
    this.cinematicPos.copyFrom(pos);
    this.cinematicTarget.copyFrom(target);
  }

  release(): void {
    this.mode = "follow";
    this.focusInit = false;
  }
}
