import { MAPTILER_TILES_JSON, WORLD } from "../../config";
import { NOISE } from "../../core/Noise";
import { PEAKS, VILLAGES, ROADS, geoToWorld } from "../AndorraData";
import { decodeQuantizedMesh } from "./QuantizedMesh";

export type Progress = (fraction: number, label: string) => void;

/** Real elevations in metres, nx*nz, row j = south -> north. */
export interface ElevationResult {
  elev: Float32Array;
  source: "maptiler" | "offline" | "procedural";
  note?: string;
}

const NX = WORLD.nx;
const NZ = WORLD.nz;

function lonOfI(i: number): number {
  return WORLD.lon0 + (i / (NX - 1)) * (WORLD.lon1 - WORLD.lon0);
}
function latOfJ(j: number): number {
  return WORLD.lat0 + (j / (NZ - 1)) * (WORLD.lat1 - WORLD.lat0);
}

// ---------------------------------------------------------------------------------------------
// Offline DEM baked from public-domain/open elevation data (see README "Data sources").
// ---------------------------------------------------------------------------------------------
export async function loadOfflineDEM(progress: Progress): Promise<Float32Array> {
  progress(0.05, "Reading the ancient maps of Andorra…");
  const url = new URL("data/andorra_dem.png", document.baseURI).toString();
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`DEM fetch failed: ${resp.status}`);
  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" } as ImageBitmapOptions);
  if (bmp.width !== NX || bmp.height !== NZ) throw new Error(`DEM has unexpected size ${bmp.width}x${bmp.height}`);
  const canvas = document.createElement("canvas");
  canvas.width = NX;
  canvas.height = NZ;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, NX, NZ).data;
  const elev = new Float32Array(NX * NZ);
  for (let r = 0; r < NZ; r++) {
    const j = NZ - 1 - r;
    for (let i = 0; i < NX; i++) {
      const p = (r * NX + i) * 4;
      elev[j * NX + i] = (data[p] * 256 + data[p + 1]) / 10;
    }
  }
  progress(0.15, "Elevation data loaded");
  return elev;
}

// ---------------------------------------------------------------------------------------------
// MapTiler quantized-mesh terrain (live). Tiles are rasterised into our regular grid.
// ---------------------------------------------------------------------------------------------
interface TileJson {
  tiles: string[];
  scheme?: string;
  maxzoom?: number;
  minzoom?: number;
  projection?: string;
}

async function maybeGunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] === 0x1f && b[1] === 0x8b && typeof (window as any).DecompressionStream !== "undefined") {
    const ds = new (window as any).DecompressionStream("gzip");
    const stream = new Blob([buf]).stream().pipeThrough(ds);
    return await new Response(stream).arrayBuffer();
  }
  return buf;
}

export async function loadMapTilerElevation(key: string, progress: Progress, zoomPref = 13): Promise<{ elev: Float32Array; coverage: Uint8Array }> {
  progress(0.02, "Contacting MapTiler terrain service…");
  const tjUrl = MAPTILER_TILES_JSON.replace("{key}", encodeURIComponent(key));
  const tjResp = await fetch(tjUrl);
  if (!tjResp.ok) throw new Error(`MapTiler tiles.json failed (${tjResp.status})`);
  const tj = (await tjResp.json()) as TileJson;
  if (!tj.tiles || !tj.tiles.length) throw new Error("MapTiler tiles.json has no tile URLs");
  let template = tj.tiles[0];
  if (!/[?&]key=/.test(template)) template += (template.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(key);
  const scheme = (tj.scheme ?? "tms").toLowerCase();
  const z = Math.max(tj.minzoom ?? 0, Math.min(tj.maxzoom ?? 12, zoomPref));
  // Geographic (EPSG:4326) tiling: 2^(z+1) x 2^z tiles, each 180/2^z degrees.
  const size = 180 / Math.pow(2, z);
  const numY = Math.pow(2, z);
  const x0 = Math.floor((WORLD.lon0 + 180) / size);
  const x1 = Math.floor((WORLD.lon1 + 180) / size);
  const y0 = Math.floor((WORLD.lat0 + 90) / size);
  const y1 = Math.floor((WORLD.lat1 + 90) / size);

  const elev = new Float32Array(NX * NZ);
  const coverage = new Uint8Array(NX * NZ);
  const jobs: { x: number; y: number }[] = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) jobs.push({ x: tx, y: ty });
  let done = 0;
  let failures = 0;

  const rasterise = (tx: number, ty: number, buf: ArrayBuffer) => {
    const t = decodeQuantizedMesh(buf);
    const west = -180 + tx * size;
    const south = -90 + ty * size;
    const n = t.vertexCount;
    // vertex positions in grid index space
    const gi = new Float32Array(n);
    const gj = new Float32Array(n);
    const hv = new Float32Array(n);
    const hr = t.maxHeight - t.minHeight;
    for (let k = 0; k < n; k++) {
      const lon = west + (t.u[k] / 32767) * size;
      const lat = south + (t.v[k] / 32767) * size;
      gi[k] = ((lon - WORLD.lon0) / (WORLD.lon1 - WORLD.lon0)) * (NX - 1);
      gj[k] = ((lat - WORLD.lat0) / (WORLD.lat1 - WORLD.lat0)) * (NZ - 1);
      hv[k] = t.minHeight + (t.h[k] / 32767) * hr;
    }
    const idx = t.indices;
    for (let k = 0; k < idx.length; k += 3) {
      const a = idx[k], b = idx[k + 1], c = idx[k + 2];
      const ax = gi[a], ay = gj[a], bx = gi[b], by = gj[b], cx = gi[c], cy = gj[c];
      const minI = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 1e-6));
      const maxI = Math.min(NX - 1, Math.floor(Math.max(ax, bx, cx) + 1e-6));
      const minJ = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 1e-6));
      const maxJ = Math.min(NZ - 1, Math.floor(Math.max(ay, by, cy) + 1e-6));
      if (minI > maxI || minJ > maxJ) continue;
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(det) < 1e-12) continue;
      for (let j = minJ; j <= maxJ; j++) {
        for (let i = minI; i <= maxI; i++) {
          const l1 = ((by - cy) * (i - cx) + (cx - bx) * (j - cy)) / det;
          const l2 = ((cy - ay) * (i - cx) + (ax - cx) * (j - cy)) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
          const p = j * NX + i;
          elev[p] = l1 * hv[a] + l2 * hv[b] + l3 * hv[c];
          coverage[p] = 1;
        }
      }
    }
  };

  const worker = async () => {
    while (jobs.length) {
      const job = jobs.shift()!;
      const yy = scheme === "xyz" ? numY - 1 - job.y : job.y;
      const url = template.replace("{z}", String(z)).replace("{x}", String(job.x)).replace("{y}", String(yy));
      try {
        const r = await fetch(url, { headers: { Accept: "application/vnd.quantized-mesh,application/octet-stream;q=0.9,*/*;q=0.01" } });
        if (!r.ok) throw new Error(String(r.status));
        const buf = await maybeGunzip(await r.arrayBuffer());
        rasterise(job.x, job.y, buf);
      } catch (e) {
        failures++;
        console.warn("[MapTiler] tile failed", job, e);
      }
      done++;
      progress(0.02 + 0.13 * (done / ((x1 - x0 + 1) * (y1 - y0 + 1))), `Streaming MapTiler 3D terrain (${done} tiles)…`);
    }
  };
  await Promise.all(new Array(8).fill(0).map(worker));
  const total = (x1 - x0 + 1) * (y1 - y0 + 1);
  if (failures > total * 0.5) throw new Error(`Too many MapTiler tiles failed (${failures}/${total})`);
  return { elev, coverage };
}

// ---------------------------------------------------------------------------------------------
// Procedural approximation (last-resort fallback if no data at all is available).
// ---------------------------------------------------------------------------------------------
export function proceduralAndorra(): Float32Array {
  const elev = new Float32Array(NX * NZ);
  const villages = Object.fromEntries(VILLAGES.map((v) => [v.id, geoToWorld(v.lat, v.lon)]));
  const valleys = ROADS.map(([a, b]) => [villages[a], villages[b]]);
  const peaks = PEAKS.map((p) => ({ ...geoToWorld(p.lat, p.lon), e: p.elev }));
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const x = i * WORLD.cell - WORLD.halfW;
      const z = j * WORLD.cell - WORLD.halfD;
      let e = 1900 + NOISE.ridge2(x * 0.0009, z * 0.0009, 5) * 900 - 450;
      for (const p of peaks) {
        const d = Math.hypot(x - p.x, z - p.z);
        e = Math.max(e, p.e - d * 0.9);
      }
      let vd = 1e9;
      for (const [a, b] of valleys) {
        const vx = b.x - a.x, vz = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz)));
        vd = Math.min(vd, Math.hypot(a.x + vx * t - x, a.z + vz * t - z));
      }
      const valleyFloor = 950 + (z + WORLD.halfD) * 0.12 + Math.max(0, x) * 0.15;
      const k = Math.min(1, vd / 450);
      e = valleyFloor + (e - valleyFloor) * (k * k * (3 - 2 * k));
      elev[j * NX + i] = e;
    }
  }
  return elev;
}

export async function loadElevation(opts: { key: string; source: "auto" | "maptiler" | "offline" }, progress: Progress): Promise<ElevationResult> {
  let offline: Float32Array | null = null;
  const getOffline = async () => {
    if (!offline) offline = await loadOfflineDEM(progress);
    return offline;
  };
  if (opts.key && opts.source !== "offline") {
    try {
      const mt = await loadMapTilerElevation(opts.key, progress);
      // Fill any gaps from the offline model.
      let missing = 0;
      for (let p = 0; p < mt.coverage.length; p++) if (!mt.coverage[p]) missing++;
      if (missing > 0) {
        const off = await getOffline().catch(() => null);
        for (let p = 0; p < mt.coverage.length; p++) {
          if (!mt.coverage[p]) mt.elev[p] = off ? off[p] : 1500;
        }
      }
      return { elev: mt.elev, source: "maptiler", note: missing ? `${missing} cells filled from offline data` : undefined };
    } catch (e) {
      console.warn("[Terrain] MapTiler unavailable, falling back to offline elevation", e);
      try {
        return { elev: await getOffline(), source: "offline", note: `MapTiler unavailable (${(e as Error).message}) — using offline elevation data` };
      } catch {
        return { elev: proceduralAndorra(), source: "procedural", note: "No elevation data available — using procedural approximation" };
      }
    }
  }
  try {
    return { elev: await getOffline(), source: "offline", note: opts.key ? undefined : "No MapTiler key set — using offline elevation data" };
  } catch (e) {
    console.warn("[Terrain] offline DEM unavailable", e);
    return { elev: proceduralAndorra(), source: "procedural", note: "Using procedural approximation of Andorra" };
  }
}

export { lonOfI, latOfJ };
