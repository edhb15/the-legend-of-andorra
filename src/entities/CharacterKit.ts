import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, VertexBuffer, TransformNode, Vector3, VertexData } from "@babylonjs/core";

/** Shared helpers to build vertex-coloured, merged low-poly models. */
let sharedMat: StandardMaterial | null = null;
const glowMats = new Map<string, StandardMaterial>();

export function charMaterial(scene: Scene): StandardMaterial {
  if (!sharedMat || sharedMat.getScene() !== scene) {
    sharedMat = new StandardMaterial("charMat", scene);
    sharedMat.diffuseColor = new Color3(1, 1, 1);
    sharedMat.specularColor = new Color3(0.12, 0.12, 0.12);
    sharedMat.specularPower = 24;
    sharedMat.maxSimultaneousLights = 6;
  }
  return sharedMat;
}

export function glowMaterial(scene: Scene, hex: string, intensity = 1): StandardMaterial {
  const key = hex + intensity;
  let m = glowMats.get(key);
  if (!m) {
    m = new StandardMaterial("glow_" + key, scene);
    const c = Color3.FromHexString(hex);
    m.diffuseColor = c.scale(0.3);
    m.emissiveColor = c.scale(intensity);
    m.specularColor = new Color3(0, 0, 0);
    m.disableLighting = false;
    glowMats.set(key, m);
  }
  return m;
}

export function hexColor(hex: string): Color3 {
  return Color3.FromHexString(hex);
}

export function colorize(mesh: Mesh, color: Color3 | string, jitter = 0): Mesh {
  const c = typeof color === "string" ? Color3.FromHexString(color) : color;
  const n = mesh.getTotalVertices();
  const cols = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const j = jitter ? 1 + (Math.random() - 0.5) * jitter : 1;
    cols[i * 4] = c.r * j;
    cols[i * 4 + 1] = c.g * j;
    cols[i * 4 + 2] = c.b * j;
    cols[i * 4 + 3] = 1;
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, cols);
  return mesh;
}

type PartOpts = { pos?: [number, number, number]; rot?: [number, number, number]; scale?: [number, number, number] };

function place(m: Mesh, o: PartOpts): Mesh {
  if (o.pos) m.position.set(o.pos[0], o.pos[1], o.pos[2]);
  if (o.rot) m.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
  if (o.scale) m.scaling.set(o.scale[0], o.scale[1], o.scale[2]);
  return m;
}

export class PartBuilder {
  parts: Mesh[] = [];
  constructor(public scene: Scene) {}

  box(color: string, w: number, h: number, d: number, o: PartOpts = {}): Mesh {
    const m = MeshBuilder.CreateBox("p", { width: w, height: h, depth: d }, this.scene);
    colorize(place(m, o), color);
    this.parts.push(m);
    return m;
  }
  sphere(color: string, diam: number, o: PartOpts = {}, seg = 8): Mesh {
    const m = MeshBuilder.CreateSphere("p", { diameter: diam, segments: seg }, this.scene);
    colorize(place(m, o), color);
    this.parts.push(m);
    return m;
  }
  capsule(color: string, height: number, radius: number, o: PartOpts = {}, tess = 8): Mesh {
    const m = MeshBuilder.CreateCapsule("p", { height: Math.max(height, radius * 2 + 0.001), radius, tessellation: tess, subdivisions: 1, capSubdivisions: 3 }, this.scene);
    colorize(place(m, o), color);
    this.parts.push(m);
    return m;
  }
  cyl(color: string, height: number, dTop: number, dBot: number, o: PartOpts = {}, tess = 8): Mesh {
    const m = MeshBuilder.CreateCylinder("p", { height, diameterTop: dTop, diameterBottom: dBot, tessellation: tess }, this.scene);
    colorize(place(m, o), color);
    this.parts.push(m);
    return m;
  }
  cone(color: string, height: number, d: number, o: PartOpts = {}, tess = 8): Mesh {
    return this.cyl(color, height, 0, d, o, tess);
  }
  torus(color: string, diam: number, thick: number, o: PartOpts = {}, tess = 16): Mesh {
    const m = MeshBuilder.CreateTorus("p", { diameter: diam, thickness: thick, tessellation: tess }, this.scene);
    colorize(place(m, o), color);
    this.parts.push(m);
    return m;
  }
  ico(color: string, radius: number, o: PartOpts = {}, sub = 1, jitter = 0): Mesh {
    const m = MeshBuilder.CreateIcoSphere("p", { radius, subdivisions: sub, flat: true }, this.scene);
    colorize(place(m, o), color, jitter);
    this.parts.push(m);
    return m;
  }
  poly(color: string, type: number, size: number, o: PartOpts = {}): Mesh {
    const m = MeshBuilder.CreatePolyhedron("p", { type, size }, this.scene);
    m.convertToFlatShadedMesh();
    colorize(place(m, o), color);
    this.parts.push(m);
    return m;
  }

  /** Merge all parts into one mesh parented to `parent`. */
  merge(name: string, parent: TransformNode | null, material?: StandardMaterial): Mesh | null {
    if (!this.parts.length) return null;
    // all parts must share the same attribute set (position, normal, uv, color)
    for (const p of this.parts) {
      const n = p.getTotalVertices();
      if (!p.isVerticesDataPresent(VertexBuffer.UVKind)) p.setVerticesData(VertexBuffer.UVKind, new Float32Array(n * 2));
      if (!p.isVerticesDataPresent(VertexBuffer.ColorKind)) colorize(p, "#ffffff");
      if (!p.isVerticesDataPresent(VertexBuffer.NormalKind)) {
        const norms: number[] = [];
        const pos = p.getVerticesData(VertexBuffer.PositionKind)!;
        const idx = p.getIndices()!;
        VertexData.ComputeNormals(pos, idx, norms);
        p.setVerticesData(VertexBuffer.NormalKind, norms);
      }
      for (const k of [VertexBuffer.UV2Kind, VertexBuffer.TangentKind]) if (p.isVerticesDataPresent(k)) p.removeVerticesData(k);
    }
    const merged = Mesh.MergeMeshes(this.parts, true, true, undefined, false, false);
    this.parts = [];
    if (!merged) return null;
    merged.name = name;
    merged.material = material ?? charMaterial(this.scene);
    if (parent) merged.parent = parent;
    merged.isPickable = false;
    return merged;
  }
}

export function glowPart(scene: Scene, kind: "sphere" | "box", hex: string, size: number, parent: TransformNode, pos: [number, number, number], intensity = 1.2): Mesh {
  const m = kind === "sphere" ? MeshBuilder.CreateSphere("glow", { diameter: size, segments: 6 }, scene) : MeshBuilder.CreateBox("glow", { size }, scene);
  m.material = glowMaterial(scene, hex, intensity);
  m.parent = parent;
  m.position.set(pos[0], pos[1], pos[2]);
  m.isPickable = false;
  return m;
}

export function vec(x: number, y: number, z: number): Vector3 {
  return new Vector3(x, y, z);
}

export const C4 = Color4;
