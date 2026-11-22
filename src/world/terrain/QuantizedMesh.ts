/**
 * Decoder for the Cesium "quantized-mesh-1.0" terrain format, as served by
 * MapTiler's `terrain-quantized-mesh-v2` tileset.
 *
 * Spec: https://github.com/CesiumGS/quantized-mesh
 */
export interface QuantizedMeshTile {
  minHeight: number;
  maxHeight: number;
  vertexCount: number;
  /** 0..32767 across the tile, west -> east */
  u: Uint16Array;
  /** 0..32767 across the tile, south -> north */
  v: Uint16Array;
  /** 0..32767 between minHeight and maxHeight */
  h: Uint16Array;
  indices: Uint16Array | Uint32Array;
}

function zigZag(v: number): number {
  return (v >> 1) ^ -(v & 1);
}

export function decodeQuantizedMesh(buffer: ArrayBuffer): QuantizedMeshTile {
  const dv = new DataView(buffer);
  let o = 0;
  // --- Header (88 bytes)
  o += 24; // CenterX/Y/Z (double)
  const minHeight = dv.getFloat32(o, true);
  const maxHeight = dv.getFloat32(o + 4, true);
  o += 8;
  o += 32; // bounding sphere (4 doubles)
  o += 24; // horizon occlusion point (3 doubles)

  // --- Vertex data
  const vertexCount = dv.getUint32(o, true);
  o += 4;
  const u = new Uint16Array(vertexCount);
  const v = new Uint16Array(vertexCount);
  const h = new Uint16Array(vertexCount);
  let uu = 0, vv = 0, hh = 0;
  for (let i = 0; i < vertexCount; i++) {
    uu += zigZag(dv.getUint16(o + i * 2, true));
    u[i] = uu;
  }
  o += vertexCount * 2;
  for (let i = 0; i < vertexCount; i++) {
    vv += zigZag(dv.getUint16(o + i * 2, true));
    v[i] = vv;
  }
  o += vertexCount * 2;
  for (let i = 0; i < vertexCount; i++) {
    hh += zigZag(dv.getUint16(o + i * 2, true));
    h[i] = hh;
  }
  o += vertexCount * 2;

  // --- Index data (high-water-mark encoded)
  const use32 = vertexCount > 65536;
  if (use32) {
    if (o % 4 !== 0) o += 4 - (o % 4);
  } else if (o % 2 !== 0) {
    o += 1;
  }
  const triangleCount = dv.getUint32(o, true);
  o += 4;
  const n = triangleCount * 3;
  const indices = use32 ? new Uint32Array(n) : new Uint16Array(n);
  let highest = 0;
  for (let i = 0; i < n; i++) {
    const code = use32 ? dv.getUint32(o + i * 4, true) : dv.getUint16(o + i * 2, true);
    indices[i] = highest - code;
    if (code === 0) highest++;
  }
  // Edge indices and extensions follow; we don't need them for heightfield rasterisation.
  return { minHeight, maxHeight, vertexCount, u, v, h, indices };
}

/** Encoder (used by unit tests to validate the decoder round-trip). */
export function encodeQuantizedMesh(t: { minHeight: number; maxHeight: number; u: number[]; v: number[]; h: number[]; indices: number[] }): ArrayBuffer {
  const n = t.u.length;
  const use32 = n > 65536;
  const zz = (x: number) => ((x << 1) ^ (x >> 31)) & 0xffff;
  let size = 88 + 4 + n * 6;
  if (use32 && size % 4) size += 4 - (size % 4);
  size += 4 + t.indices.length * (use32 ? 4 : 2) + 16; // + empty edge lists
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  let o = 24;
  dv.setFloat32(o, t.minHeight, true);
  dv.setFloat32(o + 4, t.maxHeight, true);
  o = 88;
  dv.setUint32(o, n, true);
  o += 4;
  for (const arr of [t.u, t.v, t.h]) {
    let prev = 0;
    for (let i = 0; i < n; i++) {
      dv.setUint16(o + i * 2, zz(arr[i] - prev), true);
      prev = arr[i];
    }
    o += n * 2;
  }
  if (use32 && o % 4) o += 4 - (o % 4);
  dv.setUint32(o, t.indices.length / 3, true);
  o += 4;
  let highest = 0;
  for (let i = 0; i < t.indices.length; i++) {
    const idx = t.indices[i];
    const code = highest - idx;
    if (use32) dv.setUint32(o + i * 4, code, true);
    else dv.setUint16(o + i * 2, code, true);
    if (code === 0) highest++;
  }
  return buf;
}
