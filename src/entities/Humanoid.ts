import { Scene, TransformNode, Mesh, Vector3 } from "@babylonjs/core";
import { PartBuilder, glowPart } from "./CharacterKit";
import { clamp01, damp, easeInOut, easeOutCubic, lerp, TAU } from "../core/MathUtil";

export interface HumanoidLook {
  skin: string;
  hair: string;
  top: string;
  bottom: string;
  boots: string;
  hairStyle?: "short" | "long" | "bald" | "bun" | "spiky" | "ponytail";
  hat?: "none" | "hood" | "cap" | "straw" | "helmet" | "horned" | "crown" | "circlet" | "kerchief" | "greathelm";
  hatColor?: string;
  beard?: string;
  skirt?: string;
  apron?: string;
  cape?: string;
  belt?: string;
  armor?: string;
  eyeGlow?: string;
  scale?: number;
  bulk?: number;
  skeleton?: boolean;
  ears?: boolean;
  sleeves?: string;
}

type V3 = [number, number, number];
type Pose = Record<string, V3>;

const BONES = ["hips", "spine", "chest", "neck", "head", "shL", "elL", "haL", "shR", "elR", "haR", "thL", "knL", "ftL", "thR", "knR", "ftR"] as const;
type BoneName = (typeof BONES)[number];

export interface AnimState {
  speed: number;
  grounded: boolean;
  vy: number;
  action: string | null;
  actionT: number;
  actionDur: number;
  blocking: boolean;
  swim?: boolean;
  lookYaw?: number;
  carry?: boolean;
  /** armed with a weapon in the right hand */
  armed?: boolean;
}

/**
 * Procedurally built & animated humanoid. Body parts are vertex-coloured and merged per bone
 * so each character costs ~15 draw calls.
 */
export class Humanoid {
  root: TransformNode;
  tilt: TransformNode;
  bones = {} as Record<BoneName, TransformNode>;
  handR: TransformNode;
  handL: TransformNode;
  back: TransformNode;
  cape: TransformNode | null = null;
  meshes: Mesh[] = [];
  private cur: Pose = {};
  private hipsY = 0.95;
  private curHipsY = 0.95;
  private walkPhase = 0;
  private time = Math.random() * 10;
  readonly scale: number;
  spin = 0;

  constructor(public scene: Scene, public look: HumanoidLook, name = "human") {
    this.scale = look.scale ?? 1;
    const S = this.scale;
    this.root = new TransformNode(name, scene);
    this.tilt = new TransformNode(name + "_tilt", scene);
    this.tilt.parent = this.root;
    this.tilt.scaling.setAll(S);
    const mk = (n: BoneName, parent: TransformNode, x: number, y: number, z: number) => {
      const t = new TransformNode(name + "_" + n, scene);
      t.parent = parent;
      t.position.set(x, y, z);
      this.bones[n] = t;
      this.cur[n] = [0, 0, 0];
      return t;
    };
    const bulk = look.bulk ?? 1;
    const hips = mk("hips", this.tilt, 0, 0.95, 0);
    const spine = mk("spine", hips, 0, 0.1, 0);
    const chest = mk("chest", spine, 0, 0.2, 0);
    const neck = mk("neck", chest, 0, 0.26, 0);
    const head = mk("head", neck, 0, 0.08, 0);
    const shL = mk("shL", chest, -0.2 * bulk, 0.2, 0);
    const elL = mk("elL", shL, 0, -0.29, 0);
    const haL = mk("haL", elL, 0, -0.27, 0);
    const shR = mk("shR", chest, 0.2 * bulk, 0.2, 0);
    const elR = mk("elR", shR, 0, -0.29, 0);
    const haR = mk("haR", elR, 0, -0.27, 0);
    const thL = mk("thL", hips, -0.1 * bulk, -0.03, 0);
    const knL = mk("knL", thL, 0, -0.44, 0);
    const ftL = mk("ftL", knL, 0, -0.44, 0);
    const thR = mk("thR", hips, 0.1 * bulk, -0.03, 0);
    const knR = mk("knR", thR, 0, -0.44, 0);
    const ftR = mk("ftR", knR, 0, -0.44, 0);

    this.handR = new TransformNode(name + "_sockR", scene);
    this.handR.parent = haR;
    this.handR.position.set(0, -0.05, 0.02);
    this.handL = new TransformNode(name + "_sockL", scene);
    this.handL.parent = elL;
    this.handL.position.set(-0.07, -0.15, 0);
    this.back = new TransformNode(name + "_back", scene);
    this.back.parent = chest;
    this.back.position.set(0, 0.12, -0.16);

    this.build(look, { hips, spine, chest, neck, head, shL, elL, haL, shR, elR, haR, thL, knL, ftL, thR, knR, ftR });
  }

  private build(L: HumanoidLook, b: Record<BoneName, TransformNode>): void {
    const s = this.scene;
    const pb = new PartBuilder(s);
    const bulk = L.bulk ?? 1;
    const limbR = L.skeleton ? 0.032 : 0.058;
    const legR = L.skeleton ? 0.036 : 0.072;
    const push = (m: Mesh | null) => {
      if (m) this.meshes.push(m);
    };
    // Pelvis
    pb.box(L.bottom, 0.32 * bulk, 0.2, 0.2, { pos: [0, -0.02, 0] });
    if (L.belt) pb.cyl(L.belt, 0.06, 0.36 * bulk, 0.36 * bulk, { pos: [0, 0.08, 0], scale: [1, 1, 0.66] }, 12);
    if (L.skirt) pb.cyl(L.skirt, 0.5, 0.36 * bulk, 0.52 * bulk, { pos: [0, -0.2, 0], scale: [1, 1, 0.75] }, 10);
    if (L.apron) pb.box(L.apron, 0.3, 0.55, 0.02, { pos: [0, -0.18, 0.13] });
    push(pb.merge("hips", b.hips));
    // Torso
    if (L.skeleton) {
      pb.cyl(L.top, 0.32, 0.05, 0.05, { pos: [0, 0.05, 0] }, 6);
      for (let k = 0; k < 4; k++) pb.torus(L.top, 0.3 - k * 0.02, 0.025, { pos: [0, 0.14 + k * 0.06 - 0.12, 0.0], scale: [1, 1, 0.7] }, 10);
    } else {
      pb.box(L.top, 0.38 * bulk, 0.36, 0.22, { pos: [0, 0.02, 0] });
    }
    push(pb.merge("spine", b.spine));
    if (!L.skeleton) {
      pb.box(L.top, 0.42 * bulk, 0.3, 0.25, { pos: [0, 0.12, 0] });
      pb.sphere(L.top, 0.2, { pos: [-0.19 * bulk, 0.2, 0], scale: [1, 0.8, 1] });
      pb.sphere(L.top, 0.2, { pos: [0.19 * bulk, 0.2, 0], scale: [1, 0.8, 1] });
    } else {
      pb.box(L.top, 0.3, 0.05, 0.08, { pos: [0, 0.2, 0] });
    }
    if (L.armor) {
      pb.box(L.armor, 0.44 * bulk, 0.26, 0.27, { pos: [0, 0.12, 0.005] });
      pb.sphere(L.armor, 0.26, { pos: [-0.22 * bulk, 0.22, 0], scale: [1, 0.7, 1] });
      pb.sphere(L.armor, 0.26, { pos: [0.22 * bulk, 0.22, 0], scale: [1, 0.7, 1] });
    }
    if (L.cape) {
      // collar
      pb.torus(L.cape, 0.3, 0.05, { pos: [0, 0.27, -0.02], scale: [1, 1, 0.8] }, 12);
    }
    push(pb.merge("chest", b.chest));
    // Neck + head
    pb.cyl(L.skin, 0.12, 0.09, 0.1, { pos: [0, 0.02, 0] }, 8);
    push(pb.merge("neck", b.neck));
    const headY = 0.12;
    if (L.skeleton) {
      pb.sphere(L.skin, 0.25, { pos: [0, headY, 0], scale: [0.9, 1, 1] }, 8);
      pb.box(L.skin, 0.14, 0.07, 0.1, { pos: [0, headY - 0.12, 0.05] });
    } else {
      pb.sphere(L.skin, 0.26, { pos: [0, headY, 0], scale: [0.92, 1.05, 1] }, 10);
      pb.box(L.skin, 0.04, 0.06, 0.05, { pos: [0, headY - 0.01, 0.13] });
      if (L.ears) {
        pb.cone(L.skin, 0.14, 0.06, { pos: [-0.14, headY + 0.03, -0.01], rot: [0, 0, 1.2] }, 6);
        pb.cone(L.skin, 0.14, 0.06, { pos: [0.14, headY + 0.03, -0.01], rot: [0, 0, -1.2] }, 6);
      }
    }
    if (!L.eyeGlow) {
      const eye = L.skeleton ? "#111111" : "#1c1a22";
      pb.sphere(eye, 0.035, { pos: [-0.05, headY + 0.02, 0.115] }, 6);
      pb.sphere(eye, 0.035, { pos: [0.05, headY + 0.02, 0.115] }, 6);
      if (!L.skeleton) pb.box("#7a4a40", 0.06, 0.012, 0.01, { pos: [0, headY - 0.06, 0.122] });
    }
    // Hair
    const hs = L.hairStyle ?? "short";
    if (!L.skeleton && hs !== "bald") {
      pb.sphere(L.hair, 0.28, { pos: [0, headY + 0.035, -0.02], scale: [0.98, 0.9, 1.0] }, 10);
      if (hs === "long") pb.box(L.hair, 0.26, 0.3, 0.08, { pos: [0, headY - 0.12, -0.1] });
      if (hs === "bun") pb.sphere(L.hair, 0.12, { pos: [0, headY + 0.12, -0.1] }, 8);
      if (hs === "ponytail") pb.capsule(L.hair, 0.26, 0.04, { pos: [0, headY - 0.06, -0.15], rot: [0.3, 0, 0] });
      if (hs === "spiky") for (let k = 0; k < 5; k++) pb.cone(L.hair, 0.12, 0.07, { pos: [-0.08 + k * 0.04, headY + 0.14, -0.02], rot: [-0.4, 0, (k - 2) * 0.25] }, 5);
    }
    if (L.beard) pb.box(L.beard, 0.16, 0.12, 0.08, { pos: [0, headY - 0.1, 0.09] });
    const hc = L.hatColor ?? "#5a3a22";
    switch (L.hat) {
      case "hood":
        pb.sphere(hc, 0.32, { pos: [0, headY + 0.03, -0.04], scale: [1, 1.05, 1.05] }, 10);
        pb.cone(hc, 0.18, 0.18, { pos: [0, headY + 0.03, -0.2], rot: [-1.9, 0, 0] }, 8);
        break;
      case "cap":
        pb.cyl(hc, 0.1, 0.26, 0.29, { pos: [0, headY + 0.12, 0] }, 12);
        break;
      case "straw":
        pb.cyl(hc, 0.02, 0.56, 0.56, { pos: [0, headY + 0.1, 0] }, 14);
        pb.cyl(hc, 0.12, 0.18, 0.26, { pos: [0, headY + 0.16, 0] }, 12);
        break;
      case "kerchief":
        pb.sphere(hc, 0.285, { pos: [0, headY + 0.05, -0.02], scale: [1, 0.8, 1] }, 10);
        break;
      case "helmet":
        pb.sphere(hc, 0.3, { pos: [0, headY + 0.05, 0], scale: [1, 0.9, 1] }, 10);
        pb.box(hc, 0.03, 0.12, 0.03, { pos: [0, headY - 0.01, 0.15] });
        break;
      case "horned":
        pb.sphere(hc, 0.3, { pos: [0, headY + 0.05, 0], scale: [1, 0.9, 1] }, 10);
        pb.cone("#e8e0c8", 0.22, 0.08, { pos: [-0.16, headY + 0.16, 0], rot: [0, 0, 0.9] }, 6);
        pb.cone("#e8e0c8", 0.22, 0.08, { pos: [0.16, headY + 0.16, 0], rot: [0, 0, -0.9] }, 6);
        break;
      case "greathelm":
        pb.cyl(hc, 0.34, 0.27, 0.3, { pos: [0, headY + 0.03, 0] }, 10);
        pb.box("#111111", 0.2, 0.03, 0.02, { pos: [0, headY + 0.04, 0.14] });
        pb.cone(hc, 0.12, 0.27, { pos: [0, headY + 0.25, 0] }, 10);
        break;
      case "crown":
        pb.cyl("#e8c24a", 0.07, 0.27, 0.27, { pos: [0, headY + 0.14, 0] }, 12);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * TAU;
          pb.cone("#e8c24a", 0.08, 0.05, { pos: [Math.sin(a) * 0.13, headY + 0.21, Math.cos(a) * 0.13] }, 4);
        }
        break;
      case "circlet":
        pb.torus("#d8c070", 0.27, 0.02, { pos: [0, headY + 0.08, 0], rot: [0.15, 0, 0] }, 16);
        break;
      default:
        break;
    }
    push(pb.merge("head", b.head));
    if (L.eyeGlow) {
      this.meshes.push(glowPart(this.scene, "sphere", L.eyeGlow, 0.05, b.head, [-0.055, headY + 0.02, 0.12], 2));
      this.meshes.push(glowPart(this.scene, "sphere", L.eyeGlow, 0.05, b.head, [0.055, headY + 0.02, 0.12], 2));
    }
    // Arms
    const sleeve = L.sleeves ?? L.top;
    for (const side of ["L", "R"] as const) {
      const sh = b[("sh" + side) as BoneName], el = b[("el" + side) as BoneName], ha = b[("ha" + side) as BoneName];
      pb.capsule(L.skeleton ? L.top : sleeve, 0.3, limbR * bulk, { pos: [0, -0.14, 0] });
      if (L.armor) pb.sphere(L.armor, 0.13, { pos: [0, -0.02, 0], scale: [1.1, 0.9, 1.1] });
      push(pb.merge("upper" + side, sh));
      pb.capsule(L.skeleton ? L.top : L.skin, 0.28, limbR * 0.88 * bulk, { pos: [0, -0.13, 0] });
      if (!L.skeleton && sleeve !== L.top) pb.cyl(sleeve, 0.1, limbR * 2.3, limbR * 2.2, { pos: [0, -0.04, 0] });
      if (L.armor) pb.cyl(L.armor, 0.14, limbR * 2.4, limbR * 2.6, { pos: [0, -0.16, 0] });
      push(pb.merge("fore" + side, el));
      pb.sphere(L.skeleton ? L.top : L.skin, 0.11, { pos: [0, -0.03, 0.01], scale: [0.8, 1, 0.9] });
      push(pb.merge("hand" + side, ha));
    }
    // Legs
    for (const side of ["L", "R"] as const) {
      const th = b[("th" + side) as BoneName], kn = b[("kn" + side) as BoneName], ft = b[("ft" + side) as BoneName];
      pb.capsule(L.skeleton ? L.top : L.bottom, 0.46, legR * bulk, { pos: [0, -0.21, 0] });
      push(pb.merge("thigh" + side, th));
      pb.capsule(L.skeleton ? L.top : L.boots, 0.46, legR * 0.85 * bulk, { pos: [0, -0.22, 0] });
      if (L.armor) pb.cyl(L.armor, 0.16, legR * 2.4, legR * 2.2, { pos: [0, -0.08, 0.01] });
      push(pb.merge("shin" + side, kn));
      pb.box(L.skeleton ? L.top : L.boots, 0.11, 0.08, 0.24, { pos: [0, -0.01, 0.05] });
      push(pb.merge("foot" + side, ft));
    }
    // Cape
    if (L.cape) {
      const cape = new TransformNode("cape", this.scene);
      cape.parent = b.chest;
      cape.position.set(0, 0.26, -0.15);
      pb.box(L.cape, 0.46 * bulk, 0.95, 0.025, { pos: [0, -0.47, 0] });
      pb.box(L.cape, 0.5 * bulk, 0.1, 0.03, { pos: [0, -0.92, -0.005] });
      push(pb.merge("cape", cape));
      this.cape = cape;
    }
  }

  setPosition(x: number, y: number, z: number, yaw: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
  }

  setEnabled(v: boolean): void {
    this.root.setEnabled(v);
  }

  dispose(): void {
    this.root.dispose(false, false);
  }

  /** Compute & apply the pose for this frame. */
  animate(dt: number, a: AnimState): void {
    this.time += dt;
    const T: Pose = {};
    for (const n of BONES) T[n] = [0, 0, 0];
    let hipsY = 0.95;
    let tiltX = 0, tiltZ = 0;
    let stiff = 14;
    const sp = a.speed;
    const run = clamp01((sp - 3.5) / 4);
    const walkK = clamp01(sp / 1.5);

    // ---------------- locomotion
    if (a.swim) {
      this.walkPhase += dt * 4;
      const s = Math.sin(this.walkPhase);
      tiltX = 1.2;
      hipsY = 0.9;
      T.shL = [-2.8 + s * 0.6, 0, -0.3];
      T.shR = [-2.8 - s * 0.6, 0, 0.3];
      T.thL = [s * 0.5, 0, 0];
      T.thR = [-s * 0.5, 0, 0];
      T.neck = [-0.9, 0, 0];
    } else if (!a.grounded) {
      const up = a.vy > 0 ? 1 : 0;
      T.thL = [-0.9, 0, -0.05];
      T.knL = [1.2, 0, 0];
      T.thR = [up ? -0.2 : -0.5, 0, 0.05];
      T.knR = [up ? 0.5 : 0.9, 0, 0];
      T.shL = [-0.6, 0, -0.6];
      T.shR = [-0.6, 0, 0.6];
      T.elL = [-0.5, 0, 0];
      T.elR = [-0.5, 0, 0];
    } else if (walkK > 0.02) {
      this.walkPhase += dt * (3.2 + sp * 1.05);
      const s = Math.sin(this.walkPhase);
      const c = Math.cos(this.walkPhase);
      const amp = lerp(0.45, 0.95, run) * walkK;
      T.thL = [s * amp, 0, 0];
      T.thR = [-s * amp, 0, 0];
      T.knL = [Math.max(0, -c) * amp * 1.6 + 0.1 * walkK, 0, 0];
      T.knR = [Math.max(0, c) * amp * 1.6 + 0.1 * walkK, 0, 0];
      T.ftL = [-s * 0.2 * walkK, 0, 0];
      T.ftR = [s * 0.2 * walkK, 0, 0];
      T.shL = [-s * amp * 0.8, 0, -0.08];
      T.shR = [s * amp * 0.8, 0, 0.08];
      T.elL = [-0.25 - run * 0.9, 0, 0];
      T.elR = [-0.25 - run * 0.9, 0, 0];
      T.spine = [run * 0.25, s * 0.06, 0];
      T.chest = [0, -s * 0.1 * walkK, 0];
      hipsY = 0.95 - Math.abs(c) * 0.04 * walkK - run * 0.05;
    } else {
      // idle breathing
      const br = Math.sin(this.time * 1.6);
      T.chest = [br * 0.02, 0, 0];
      T.shL = [0.02, 0, -0.07 - br * 0.01];
      T.shR = [0.02, 0, 0.07 + br * 0.01];
      T.elL = [-0.15, 0, 0];
      T.elR = [-0.15, 0, 0];
      T.head = [0, Math.sin(this.time * 0.4) * 0.15, 0];
    }
    if (a.armed && !a.action) {
      // sword-ready right arm
      T.shR = [T.shR[0] * 0.4 - 0.25, 0, 0.18];
      T.elR = [-0.95, 0, 0];
      T.haR = [0, 0, 0];
    }
    if (a.carry) {
      T.shL = [-1.0, 0, 0.2];
      T.shR = [-1.0, 0, -0.2];
      T.elL = [-0.6, 0, 0];
      T.elR = [-0.6, 0, 0];
    }
    if (a.blocking) {
      T.shL = [-1.25, 0.45, -0.1];
      T.elL = [-1.35, 0, 0];
      T.spine = [0.08, 0, 0];
      hipsY -= 0.04;
    }
    if (a.lookYaw) T.head[1] += a.lookYaw;

    // ---------------- actions
    const act = a.action;
    const p = a.actionDur > 0 ? clamp01(a.actionT / a.actionDur) : 0;
    this.spin = 0;
    if (act) {
      stiff = 26;
      switch (act) {
        case "attack1": {
          // horizontal slash right -> left
          const k = p < 0.3 ? easeOutCubic(p / 0.3) : 1;
          const s2 = p < 0.3 ? 0 : easeOutCubic((p - 0.3) / 0.35);
          T.chest = [0.05, lerp(lerp(0, 0.85, k), -0.9, s2), 0];
          T.shR = [lerp(-0.6, -1.45, k), 0, lerp(0.3, 0.2, s2)];
          T.elR = [lerp(-0.9, -0.15, k), 0, 0];
          T.haR = [0, 0, lerp(-0.2, -1.45, k)];
          T.shL = [-0.5, 0, -0.35];
          T.thL = [-0.35, 0, 0];
          T.knL = [0.4, 0, 0];
          T.thR = [0.25, 0, 0];
          hipsY = 0.9;
          break;
        }
        case "attack2": {
          // backhand slash left -> right
          const k = p < 0.28 ? easeOutCubic(p / 0.28) : 1;
          const s2 = p < 0.28 ? 0 : easeOutCubic((p - 0.28) / 0.35);
          T.chest = [0.05, lerp(lerp(0, -0.85, k), 0.95, s2), 0];
          T.shR = [lerp(-0.6, -1.4, k), 0, lerp(-0.55, 0.45, s2)];
          T.elR = [lerp(-0.9, -0.4, k), 0, 0];
          T.haR = [0, 0, lerp(0.2, 1.45, k)];
          T.shL = [-0.4, 0, -0.3];
          T.thR = [-0.35, 0, 0];
          T.knR = [0.4, 0, 0];
          T.thL = [0.25, 0, 0];
          hipsY = 0.9;
          break;
        }
        case "attack3":
        case "plunge": {
          // overhead chop
          const k = p < 0.35 ? easeOutCubic(p / 0.35) : 1;
          const s2 = p < 0.35 ? 0 : easeOutCubic((p - 0.35) / 0.3);
          T.shR = [lerp(lerp(-0.6, -2.9, k), -0.55, s2), 0, 0.1];
          T.elR = [lerp(-0.9, -0.5, k) * (1 - s2) + -0.1 * s2, 0, 0];
          T.shL = [lerp(-0.6, -2.7, k) * (1 - s2) - 0.6 * s2, 0, -0.1];
          T.elL = [-0.6, 0, 0];
          T.spine = [lerp(-0.2, 0.45, s2), 0, 0];
          T.thL = [-0.5 * s2, 0, 0];
          T.knL = [0.6 * s2, 0, 0];
          T.thR = [0.3 * s2, 0, 0];
          hipsY = 0.95 - 0.12 * s2;
          break;
        }
        case "heavy": {
          // spinning slash
          const k = easeInOut(p);
          this.spin = k * TAU;
          T.shR = [-0.3, 0, 1.45];
          T.elR = [-0.1, 0, 0];
          T.haR = [0, 0, -1.4];
          T.shL = [-0.3, 0, -1.2];
          T.thL = [-0.3, 0, -0.2];
          T.thR = [0.3, 0, 0.2];
          T.knL = [0.5, 0, 0];
          hipsY = 0.85;
          break;
        }
        case "charge": {
          T.shR = [-0.4, 0, 1.0];
          T.elR = [-0.3, 0, 0];
          T.haR = [0, 0, -1.4];
          T.chest = [0.1, 0.7, 0];
          T.thL = [-0.5, 0, 0];
          T.knL = [0.7, 0, 0];
          T.thR = [0.4, 0, 0];
          hipsY = 0.82 + Math.sin(this.time * 40) * 0.005;
          break;
        }
        case "cast": {
          const k = easeOutCubic(Math.min(1, p * 2.5));
          T.shR = [-1.55 * k, 0, 0.05];
          T.elR = [-0.1, 0, 0];
          T.shL = [-1.4 * k, 0, -0.1];
          T.elL = [-0.2, 0, 0];
          T.spine = [-0.1 * k, 0, 0];
          break;
        }
        case "dodge": {
          const k = easeInOut(p);
          tiltX = k * TAU;
          hipsY = 0.95 - Math.sin(p * Math.PI) * 0.4;
          T.thL = [-1.6, 0, 0];
          T.thR = [-1.6, 0, 0];
          T.knL = [2.0, 0, 0];
          T.knR = [2.0, 0, 0];
          T.shL = [-1.2, 0, 0];
          T.shR = [-1.2, 0, 0];
          T.spine = [0.6, 0, 0];
          stiff = 40;
          break;
        }
        case "backstep": {
          T.spine = [-0.2, 0, 0];
          T.thL = [0.3, 0, 0];
          T.thR = [-0.4, 0, 0];
          break;
        }
        case "hit": {
          const k = Math.sin(p * Math.PI);
          T.spine = [-0.45 * k, 0, 0.1 * k];
          T.chest = [-0.2 * k, 0, 0];
          T.shL = [-0.5 * k, 0, -0.6 * k];
          T.shR = [-0.5 * k, 0, 0.6 * k];
          T.head = [-0.3 * k, 0, 0];
          stiff = 30;
          break;
        }
        case "death": {
          const k1 = easeOutCubic(Math.min(1, p / 0.3));
          const k2 = clamp01((p - 0.25) / 0.55);
          T.spine = [-0.4 * k1 + 0.3 * k2, 0, 0];
          T.head = [-0.4 * k1, 0, 0.2];
          T.shL = [-0.8 * k1, 0, -0.9];
          T.shR = [-0.8 * k1, 0, 0.9];
          T.thL = [-1.2 * k1 * (1 - k2), 0, 0];
          T.knL = [1.9 * k1 * (1 - k2), 0, 0];
          T.thR = [-1.0 * k1 * (1 - k2), 0, 0];
          T.knR = [1.6 * k1 * (1 - k2), 0, 0];
          hipsY = 0.95 - 0.45 * k1 * (1 - k2);
          tiltX = 1.45 * (k2 * k2) + Math.sin(k2 * Math.PI) * 0.1;
          stiff = 10;
          break;
        }
        case "talk": {
          const g = Math.sin(this.time * 3.1);
          T.shR = [-0.5 + g * 0.2, 0, 0.2];
          T.elR = [-1.0 - g * 0.3, 0, 0];
          T.shL = [-0.2, 0, -0.2 + Math.sin(this.time * 2.3) * 0.1];
          T.elL = [-0.6, 0, 0];
          T.head = [Math.sin(this.time * 2) * 0.05, Math.sin(this.time * 0.9) * 0.15, 0];
          stiff = 8;
          break;
        }
        case "wave": {
          T.shR = [-0.4, 0, 2.6];
          T.elR = [0, 0, Math.sin(this.time * 9) * 0.5];
          stiff = 12;
          break;
        }
        case "cheer": {
          T.shR = [-0.3, 0, 2.7 + Math.sin(this.time * 8) * 0.2];
          T.shL = [-0.3, 0, -2.7 - Math.sin(this.time * 8) * 0.2];
          hipsY = 0.95 + Math.abs(Math.sin(this.time * 8)) * 0.08;
          break;
        }
        case "hammer": {
          const ph = (this.time * 1.6) % 1;
          const up = ph < 0.6 ? easeInOut(ph / 0.6) : 1 - easeOutCubic((ph - 0.6) / 0.2);
          T.shR = [-0.4 - up * 2.0, 0, 0.2];
          T.elR = [-0.8 - up * 0.4, 0, 0];
          T.spine = [0.25 - up * 0.1, 0, 0];
          T.shL = [-0.8, 0, -0.1];
          T.elL = [-0.8, 0, 0];
          stiff = 30;
          break;
        }
        case "hoe": {
          const ph = (this.time * 1.0) % 1;
          const up = ph < 0.55 ? easeInOut(ph / 0.55) : 1 - easeOutCubic((ph - 0.55) / 0.25);
          T.shR = [-0.5 - up * 1.8, 0, -0.1];
          T.shL = [-0.6 - up * 1.6, 0, 0.1];
          T.elR = [-0.5, 0, 0];
          T.elL = [-0.5, 0, 0];
          T.spine = [0.45 - up * 0.3, 0, 0];
          hipsY = 0.9;
          stiff = 20;
          break;
        }
        case "sit": {
          hipsY = 0.48;
          T.thL = [-1.5, 0, -0.08];
          T.thR = [-1.5, 0, 0.08];
          T.knL = [1.45, 0, 0];
          T.knR = [1.45, 0, 0];
          T.shL = [-0.6, 0, 0];
          T.shR = [-0.6, 0, 0];
          T.elL = [-0.6, 0, 0];
          T.elR = [-0.6, 0, 0];
          break;
        }
        case "sleep": {
          tiltX = -1.5;
          hipsY = 0.18;
          T.shL = [0, 0, -0.2];
          T.shR = [0, 0, 0.2];
          T.head = [0, 0.5, 0];
          stiff = 5;
          break;
        }
        case "cower": {
          hipsY = 0.55;
          T.thL = [-1.6, 0, 0];
          T.thR = [-1.6, 0, 0];
          T.knL = [2.2, 0, 0];
          T.knR = [2.2, 0, 0];
          T.spine = [0.7, 0, 0];
          T.shL = [-2.2, 0, 0.4];
          T.shR = [-2.2, 0, -0.4];
          T.elL = [-1.8, 0, 0];
          T.elR = [-1.8, 0, 0];
          break;
        }
        case "roar": {
          const k = Math.sin(clamp01(p) * Math.PI);
          T.spine = [-0.4 * k, 0, 0];
          T.head = [-0.4 * k, 0, 0];
          T.shL = [-0.6 * k, 0, -1.2 * k];
          T.shR = [-0.6 * k, 0, 1.2 * k];
          T.elL = [-0.8 * k, 0, 0];
          T.elR = [-0.8 * k, 0, 0];
          break;
        }
        case "kneel": {
          hipsY = 0.62;
          T.thL = [-1.5, 0, 0];
          T.knL = [1.5, 0, 0];
          T.thR = [0.2, 0, 0];
          T.knR = [1.9, 0, 0];
          T.ftR = [0.4, 0, 0];
          T.spine = [0.3, 0, 0];
          T.head = [0.4, 0, 0];
          break;
        }
        case "drink": {
          T.shR = [-1.2, 0, -0.1];
          T.elR = [-1.6, 0, 0];
          T.head = [-0.4 * Math.sin(p * Math.PI), 0, 0];
          break;
        }
        case "pickup": {
          const k = Math.sin(p * Math.PI);
          T.spine = [0.9 * k, 0, 0];
          T.shR = [-0.9 * k, 0, 0];
          T.thL = [-0.5 * k, 0, 0];
          T.knL = [0.9 * k, 0, 0];
          T.thR = [-0.5 * k, 0, 0];
          T.knR = [0.9 * k, 0, 0];
          hipsY = 0.95 - 0.25 * k;
          break;
        }
        case "raise": {
          // hold an item (shard / sword) high
          T.shR = [-0.3, 0, 2.9];
          T.elR = [0, 0, 0.1];
          T.shL = [-0.2, 0, -0.3];
          T.head = [-0.45, 0, 0];
          break;
        }
        default:
          break;
      }
    }

    // ---------------- apply with smoothing
    const k = dt > 0 ? stiff : 1000;
    for (const n of BONES) {
      const c = this.cur[n];
      const t = T[n];
      c[0] = damp(c[0], t[0], k, dt);
      c[1] = damp(c[1], t[1], k, dt);
      c[2] = damp(c[2], t[2], k, dt);
      const bone = this.bones[n];
      bone.rotation.set(c[0], c[1], c[2]);
    }
    this.curHipsY = damp(this.curHipsY, hipsY, k, dt);
    this.bones.hips.position.y = this.curHipsY;
    this.bones.hips.rotation.y += this.spin;
    this.tilt.rotation.x = act === "dodge" || act === "death" || act === "sleep" ? tiltX : damp(this.tilt.rotation.x, tiltX, 12, dt);
    this.tilt.rotation.z = tiltZ;
    if (this.cape) {
      const flare = 0.12 + Math.min(sp, 10) * 0.06 + (a.grounded ? 0 : 0.3);
      this.cape.rotation.x = damp(this.cape.rotation.x, -flare - Math.sin(this.time * 6 + sp) * 0.04 * (0.3 + sp * 0.1), 8, dt);
    }
  }

  /** World position of the right hand socket. */
  handPosition(out = new Vector3()): Vector3 {
    this.handR.computeWorldMatrix(true);
    return out.copyFrom(this.handR.getAbsolutePosition());
  }
}
