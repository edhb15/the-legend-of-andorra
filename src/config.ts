/**
 * Global configuration for THE LEGEND OF ANDORRA.
 *
 * The playable world is a 1:5 horizontal scale model of Andorra (with a 1.4x vertical
 * exaggeration so the Pyrenees feel majestic at human scale). One world unit = one "game metre".
 */

export const WORLD = {
  // Geographic bounds of the heightmap (WGS84 degrees). Andorra + ~3 km margin.
  lon0: 1.371195,
  lon1: 1.800405,
  lat0: 42.395015,
  lat1: 42.683085,
  // Heightmap grid (vertices). Row 0 = south edge.
  nx: 1409,
  nz: 1281,
  cell: 5, // game metres between heightmap vertices (= 25 real metres)
  width: 7040,
  depth: 6400,
  halfW: 3520,
  halfD: 3200,
  hScale: 0.2, // game metres per real metre (horizontal)
  vScale: 0.28, // game metres per real metre (vertical)
  elevBase: 760, // real elevation (m) mapped to y = 0
  chunkCells: 128,
};

/** Total game duration before the cloud consumes everything: exactly 14 in-game days. */
export const DOOM_DAYS = 14;
/** The game starts on Day 1 at 07:00. */
export const START_HOUR = 7;

export const MAPTILER_TILES_JSON = "https://api.maptiler.com/tiles/terrain-quantized-mesh-v2/tiles.json?key={key}";

export type Quality = "low" | "medium" | "high";

export interface Settings {
  maptilerKey: string;
  terrainSource: "auto" | "maptiler" | "offline";
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  ambientVolume: number;
  mouseSensitivity: number;
  invertY: boolean;
  quality: Quality;
  dayLengthMinutes: number;
  showFps: boolean;
}

const SETTINGS_KEY = "loa.settings.v1";

function envKey(): string {
  try {
    return (import.meta as any).env?.VITE_MAPTILER_KEY ?? "";
  } catch {
    return "";
  }
}

function urlParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

export function defaultSettings(): Settings {
  return {
    maptilerKey: envKey(),
    terrainSource: "auto",
    masterVolume: 0.8,
    musicVolume: 0.6,
    sfxVolume: 0.8,
    ambientVolume: 0.7,
    mouseSensitivity: 1,
    invertY: false,
    quality: "medium",
    dayLengthMinutes: 16,
    showFps: false,
  };
}

export function loadSettings(): Settings {
  const s = defaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) Object.assign(s, JSON.parse(raw));
  } catch {
    /* storage unavailable */
  }
  // URL overrides (handy for sharing / testing)
  const k = urlParam("maptilerKey") ?? urlParam("key");
  if (k) s.maptilerKey = k;
  const q = urlParam("quality");
  if (q === "low" || q === "medium" || q === "high") s.quality = q;
  const dl = urlParam("dayLength");
  if (dl && !isNaN(+dl)) s.dayLengthMinutes = Math.max(0.2, +dl);
  const src = urlParam("terrain");
  if (src === "offline" || src === "maptiler" || src === "auto") s.terrainSource = src;
  if (!s.maptilerKey) s.maptilerKey = envKey();
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export const DEBUG = (() => {
  try {
    return new URLSearchParams(window.location.search).has("debug");
  } catch {
    return false;
  }
})();
