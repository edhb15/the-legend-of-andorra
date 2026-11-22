import { Scene, TransformNode, Mesh, MeshBuilder, StandardMaterial, Color3, DynamicTexture, Texture } from "@babylonjs/core";
import { PartBuilder, glowMaterial } from "./CharacterKit";
import type { WeaponStats } from "../data/items";

export interface WeaponModel {
  root: TransformNode;
  blade: Mesh;
  tip: TransformNode;
  base: TransformNode;
  length: number;
}

let rainbowMat: StandardMaterial | null = null;
let rainbowTex: DynamicTexture | null = null;

export function rainbowMaterial(scene: Scene): StandardMaterial {
  if (rainbowMat && rainbowMat.getScene() === scene) return rainbowMat;
  rainbowTex = new DynamicTexture("rainbowTex", { width: 256, height: 16 }, scene, true);
  const ctx = rainbowTex.getContext() as unknown as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  const cols = ["#ff3b30", "#ff9500", "#ffd60a", "#34e05a", "#3ab0ff", "#8e5cff", "#ff3bd4", "#ff3b30"];
  cols.forEach((c, i) => g.addColorStop(i / (cols.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 16);
  rainbowTex.update();
  rainbowTex.wrapU = Texture.WRAP_ADDRESSMODE;
  const m = new StandardMaterial("rainbowMat", scene);
  m.diffuseTexture = rainbowTex;
  m.emissiveTexture = rainbowTex;
  m.emissiveColor = new Color3(1, 1, 1);
  m.specularColor = new Color3(1, 1, 1);
  m.specularPower = 64;
  rainbowMat = m;
  return m;
}

/** Animate the rainbow blade's flowing colours. */
export function tickRainbow(dt: number): void {
  if (rainbowTex) rainbowTex.uOffset = (rainbowTex.uOffset + dt * 0.35) % 1;
}

export function buildWeapon(scene: Scene, w: WeaponStats | { model: string; reach?: number }): WeaponModel {
  const root = new TransformNode("weapon", scene);
  const base = new TransformNode("weaponBase", scene);
  base.parent = root;
  // sword local: grip at origin, blade along +Y
  const pb = new PartBuilder(scene);
  const model = w.model;
  let bladeLen = 0.9, bladeW = 0.085, bladeCol = "#c9ced6", guard = "#6b5a3a", grip = "#3b2616", pommel = "#8a7a50";
  let glow: string | null = null;
  switch (model) {
    case "wood": bladeLen = 0.8; bladeW = 0.09; bladeCol = "#9b7653"; guard = "#7b5a3a"; break;
    case "traveler": bladeLen = 0.85; break;
    case "iron": bladeLen = 0.92; bladeCol = "#aab0b8"; guard = "#555b60"; break;
    case "steel": bladeLen = 1.05; bladeW = 0.08; bladeCol = "#dfe5ee"; guard = "#8a8f99"; break;
    case "knight": bladeLen = 1.0; bladeW = 0.095; bladeCol = "#e8edf5"; guard = "#c9a227"; grip = "#22305a"; pommel = "#c9a227"; break;
    case "claymore": bladeLen = 1.4; bladeW = 0.13; bladeCol = "#b8bfc8"; guard = "#4a4a4a"; grip = "#2b1a10"; break;
    case "ember": bladeLen = 0.95; bladeCol = "#ff6a2a"; guard = "#2a1a1a"; glow = "#ff5a1a"; break;
    case "frost": bladeLen = 1.0; bladeCol = "#9fe3ff"; guard = "#d8f3ff"; glow = "#6fd0ff"; break;
    case "rainbow": bladeLen = 1.15; bladeW = 0.1; guard = "#f2d37a"; grip = "#ffffff"; pommel = "#ffffff"; break;
    case "club": bladeLen = 0.75; bladeW = 0.16; bladeCol = "#6b4a2a"; guard = "#6b4a2a"; break;
    case "spear": bladeLen = 1.6; bladeW = 0.04; bladeCol = "#6b4a2a"; break;
    case "dark": bladeLen = 1.1; bladeW = 0.11; bladeCol = "#2a2233"; guard = "#120d18"; glow = "#a23cff"; break;
    case "bone": bladeLen = 0.85; bladeW = 0.08; bladeCol = "#d9d2bd"; guard = "#b8ad92"; break;
  }
  // grip, guard, pommel
  pb.cyl(grip, 0.22, 0.045, 0.05, { pos: [0, 0.0, 0] }, 8);
  if (model !== "club" && model !== "spear") {
    pb.box(guard, 0.26 + (model === "claymore" ? 0.12 : 0), 0.04, 0.06, { pos: [0, 0.13, 0] });
    pb.sphere(pommel, 0.07, { pos: [0, -0.13, 0] }, 8);
  }
  if (model === "knight" || model === "rainbow") {
    pb.sphere(guard, 0.06, { pos: [-0.15, 0.13, 0] }, 6);
    pb.sphere(guard, 0.06, { pos: [0.15, 0.13, 0] }, 6);
  }
  const hilt = pb.merge("hilt", base)!;
  // blade
  let blade: Mesh;
  if (model === "club") {
    blade = MeshBuilder.CreateCylinder("blade", { height: bladeLen, diameterTop: 0.2, diameterBottom: 0.07, tessellation: 7 }, scene);
    blade.position.y = 0.12 + bladeLen / 2;
  } else if (model === "spear") {
    const shaft = MeshBuilder.CreateCylinder("shaft", { height: bladeLen, diameter: 0.05, tessellation: 6 }, scene);
    shaft.position.y = bladeLen / 2;
    const head = MeshBuilder.CreateCylinder("head", { height: 0.3, diameterTop: 0, diameterBottom: 0.1, tessellation: 4 }, scene);
    head.position.y = bladeLen + 0.15;
    blade = Mesh.MergeMeshes([shaft, head], true, true)!;
  } else {
    blade = MeshBuilder.CreateCylinder("blade", { height: bladeLen, diameterTop: bladeW * 0.25, diameterBottom: bladeW, tessellation: 4 }, scene);
    blade.scaling.z = 0.28;
    blade.position.y = 0.15 + bladeLen / 2;
    blade.rotation.y = Math.PI / 4;
  }
  blade.parent = base;
  if (model === "rainbow") {
    blade.material = rainbowMaterial(scene);
  } else if (glow) {
    blade.material = glowMaterial(scene, glow, 0.9);
  } else {
    const m = new StandardMaterial("bladeMat_" + model, scene);
    m.diffuseColor = Color3.FromHexString(bladeCol);
    m.specularColor = model === "wood" || model === "club" || model === "spear" ? new Color3(0.1, 0.1, 0.1) : new Color3(0.9, 0.9, 0.9);
    m.specularPower = 64;
    blade.material = m;
  }
  blade.isPickable = false;
  hilt.isPickable = false;
  const tip = new TransformNode("tip", scene);
  tip.parent = base;
  tip.position.y = 0.15 + bladeLen;
  return { root, blade, tip, base, length: bladeLen + 0.15 };
}

export function buildShield(scene: Scene, style: "wood" | "knight" | "dark" = "wood"): TransformNode {
  const pb = new PartBuilder(scene);
  const main = style === "knight" ? "#2a3f7a" : style === "dark" ? "#1a1422" : "#7a5230";
  const rim = style === "knight" ? "#c9a227" : style === "dark" ? "#5b2a7a" : "#5a5a5a";
  pb.cyl(main, 0.05, 0.55, 0.55, { rot: [Math.PI / 2, 0, 0] }, 16);
  pb.torus(rim, 0.55, 0.04, { rot: [Math.PI / 2, 0, 0] }, 20);
  pb.sphere(rim, 0.12, { pos: [0, 0, 0.03], scale: [1, 1, 0.5] }, 8);
  if (style === "knight") pb.box("#e8e0c8", 0.06, 0.4, 0.02, { pos: [0, 0, 0.035] }), pb.box("#e8e0c8", 0.3, 0.06, 0.02, { pos: [0, 0.05, 0.035] });
  const root = new TransformNode("shield", scene);
  const m = pb.merge("shieldMesh", root)!;
  m.isPickable = false;
  return root;
}
