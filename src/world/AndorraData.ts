import { WORLD } from "../config";

/**
 * Real geographic data for Andorra.
 * Border polygon: Natural Earth 1:10m Admin-0 countries (public domain).
 * Place coordinates: verified against the elevation model (see README).
 */

// [lon, lat] pairs, closed ring.
export const ANDORRA_BORDER_LONLAT: [number, number][] = [
  [1.707006, 42.502781], [1.697498, 42.494462], [1.686336, 42.490612], [1.674244, 42.490508], [1.662358, 42.493712],
  [1.659774, 42.496813], [1.656984, 42.49764], [1.653986, 42.496529], [1.650369, 42.493402], [1.639517, 42.466427],
  [1.607478, 42.456428], [1.544432, 42.450356], [1.538851, 42.445653], [1.534511, 42.439917], [1.528206, 42.434233],
  [1.51663, 42.429504], [1.508466, 42.428677], [1.447901, 42.434646], [1.436429, 42.440951], [1.436429, 42.453482],
  [1.407593, 42.486762], [1.424543, 42.492472], [1.430227, 42.493557], [1.449968, 42.504073], [1.446557, 42.519886],
  [1.428987, 42.531462], [1.406456, 42.52924], [1.409764, 42.540609], [1.4263, 42.561796], [1.426403, 42.565646],
  [1.418032, 42.569832], [1.419272, 42.579263], [1.424853, 42.589365], [1.429297, 42.595386], [1.451415, 42.602052],
  [1.466814, 42.641455], [1.49844, 42.640241], [1.527793, 42.648535], [1.543089, 42.649362], [1.597349, 42.621921],
  [1.608304, 42.618123], [1.721993, 42.609855], [1.713311, 42.589546], [1.729434, 42.582001], [1.752688, 42.576679],
  [1.761107, 42.567646], [1.765091, 42.563372], [1.739976, 42.561641], [1.721683, 42.548515], [1.710624, 42.527741],
  [1.707006, 42.502781],
];

export function geoToWorld(lat: number, lon: number): { x: number; z: number } {
  return {
    x: ((lon - WORLD.lon0) / (WORLD.lon1 - WORLD.lon0)) * WORLD.width - WORLD.halfW,
    z: ((lat - WORLD.lat0) / (WORLD.lat1 - WORLD.lat0)) * WORLD.depth - WORLD.halfD,
  };
}

export function worldToGeo(x: number, z: number): { lat: number; lon: number } {
  return {
    lon: WORLD.lon0 + ((x + WORLD.halfW) / WORLD.width) * (WORLD.lon1 - WORLD.lon0),
    lat: WORLD.lat0 + ((z + WORLD.halfD) / WORLD.depth) * (WORLD.lat1 - WORLD.lat0),
  };
}

/** Border polygon in world coords, flat [x0,z0,x1,z1,...] (open ring). */
export function borderWorld(): Float32Array {
  const ring = ANDORRA_BORDER_LONLAT.slice(0, -1);
  const out = new Float32Array(ring.length * 2);
  ring.forEach(([lon, lat], i) => {
    const p = geoToWorld(lat, lon);
    out[i * 2] = p.x;
    out[i * 2 + 1] = p.z;
  });
  return out;
}

export interface VillageDef {
  id: string;
  name: string;
  lat: number;
  lon: number;
  houses: number;
  npcs: number;
  hasInn: boolean;
  hasSmith: boolean;
  hasShop: boolean;
  description: string;
}

export const VILLAGES: VillageDef[] = [
  { id: "ordino", name: "Ordino", lat: 42.5562, lon: 1.5331, houses: 11, npcs: 11, hasInn: true, hasSmith: true, hasShop: true, description: "A peaceful stone village in the northern valley. Your home." },
  { id: "lamassana", name: "La Massana", lat: 42.5449, lon: 1.5148, houses: 7, npcs: 5, hasInn: false, hasSmith: false, hasShop: true, description: "A farming village where the valleys meet." },
  { id: "andorra", name: "Andorra la Vella", lat: 42.5062, lon: 1.5218, houses: 13, npcs: 8, hasInn: true, hasSmith: true, hasShop: true, description: "The old capital, seat of the Council of the Valleys." },
  { id: "santjulia", name: "Sant Julià de Lòria", lat: 42.4637, lon: 1.4913, houses: 8, npcs: 5, hasInn: true, hasSmith: false, hasShop: true, description: "The southern gate of Andorra." },
  { id: "encamp", name: "Encamp", lat: 42.5348, lon: 1.58, houses: 8, npcs: 5, hasInn: false, hasSmith: true, hasShop: true, description: "A village of healers and herbalists." },
  { id: "canillo", name: "Canillo", lat: 42.5676, lon: 1.5974, houses: 9, npcs: 6, hasInn: true, hasSmith: false, hasShop: true, description: "A proud village guarded by the Valley Watch." },
  { id: "soldeu", name: "Soldeu", lat: 42.5766, lon: 1.6675, houses: 6, npcs: 4, hasInn: true, hasSmith: false, hasShop: false, description: "A high hamlet of shepherds below the eastern peaks." },
  { id: "pasdelacasa", name: "Pas de la Casa", lat: 42.5424, lon: 1.7333, houses: 6, npcs: 4, hasInn: false, hasSmith: false, hasShop: true, description: "A windswept trading post on the eastern pass." },
  { id: "arinsal", name: "Arinsal", lat: 42.5719, lon: 1.4846, houses: 6, npcs: 4, hasInn: false, hasSmith: true, hasShop: false, description: "The last village before Comapedrosa." },
  { id: "elserrat", name: "El Serrat", lat: 42.6176, lon: 1.5407, houses: 5, npcs: 3, hasInn: false, hasSmith: false, hasShop: false, description: "A tiny hamlet beside the northern waterfalls." },
];

export const HOME_VILLAGE = "ordino";

/** Road network between villages (A* along valleys builds the actual paths). */
export const ROADS: [string, string][] = [
  ["ordino", "lamassana"],
  ["lamassana", "andorra"],
  ["andorra", "santjulia"],
  ["andorra", "encamp"],
  ["encamp", "canillo"],
  ["canillo", "soldeu"],
  ["soldeu", "pasdelacasa"],
  ["lamassana", "arinsal"],
  ["ordino", "elserrat"],
  ["ordino", "canillo"],
];

export interface PeakDef {
  id: string;
  name: string;
  lat: number;
  lon: number;
  elev: number;
}

export const PEAKS: PeakDef[] = [
  { id: "comapedrosa", name: "Comapedrosa", lat: 42.5913, lon: 1.4434, elev: 2942 },
  { id: "estanyo", name: "Pic de l'Estanyó", lat: 42.6086, lon: 1.5919, elev: 2915 },
  { id: "casamanya", name: "Pic de Casamanya", lat: 42.5845, lon: 1.5654, elev: 2740 },
  { id: "pessons", name: "Pic dels Pessons", lat: 42.5075, lon: 1.6648, elev: 2865 },
  { id: "picnegre", name: "Pic Negre", lat: 42.4576, lon: 1.569, elev: 2642 },
  { id: "envalira", name: "Pic Negre d'Envalira", lat: 42.5174, lon: 1.723, elev: 2825 },
  { id: "medecourbe", name: "Pic de Medecourbe", lat: 42.5985, lon: 1.4422, elev: 2914 },
  { id: "serrera", name: "Pic de la Serrera", lat: 42.6261, lon: 1.6282, elev: 2913 },
];

export interface LocationDef {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: "boss" | "forge" | "lake" | "ruin" | "cave" | "landmark" | "zorg";
  /** shown on the map from the start */
  known?: boolean;
}

export const LOCATIONS: LocationDef[] = [
  { id: "zorgcave", name: "Zorg's Cave (Comapedrosa)", lat: 42.5885, lon: 1.4468, kind: "zorg", known: true },
  { id: "boss_flame", name: "Cave of the Black Peak", lat: 42.4628, lon: 1.5655, kind: "boss" },
  { id: "boss_forest", name: "Elder Grove of Madriu", lat: 42.4935, lon: 1.5965, kind: "boss" },
  { id: "boss_frost", name: "Frozen Hollow of l'Estanyó", lat: 42.6040, lon: 1.5885, kind: "boss" },
  { id: "boss_shadow", name: "Fortress of Enclar", lat: 42.4985, lon: 1.4855, kind: "boss" },
  { id: "boss_thunder", name: "Summit of the Pessons", lat: 42.5075, lon: 1.6648, kind: "boss" },
  { id: "forge", name: "The Hidden Forge", lat: 42.5812, lon: 1.5742, kind: "forge" },
  { id: "engolasters", name: "Lake Engolasters", lat: 42.5196, lon: 1.5682, kind: "lake" },
  { id: "tristaina", name: "Tristaina Lakes", lat: 42.6430, lon: 1.4880, kind: "lake" },
  { id: "juclar", name: "Juclar Lakes", lat: 42.6103, lon: 1.7182, kind: "lake" },
  { id: "meritxell", name: "Sanctuary of Meritxell", lat: 42.5559, lon: 1.5901, kind: "landmark" },
  { id: "margineda", name: "Bridge of La Margineda", lat: 42.4855, lon: 1.4904, kind: "landmark" },
  { id: "ruins_engolasters", name: "Ruins of the Old Kings", lat: 42.5255, lon: 1.5600, kind: "ruin" },
  { id: "ruins_coll", name: "Watchtower of Coll d'Ordino", lat: 42.5560, lon: 1.5560, kind: "ruin" },
  { id: "ruins_incles", name: "Shepherds' Ruins of Incles", lat: 42.5950, lon: 1.6800, kind: "ruin" },
  { id: "waterfall", name: "Falls of Ransol", lat: 42.5830, lon: 1.6380, kind: "landmark" },
  { id: "cave_hidden1", name: "Smugglers' Grotto", lat: 42.4730, lon: 1.5150, kind: "cave" },
  { id: "cave_hidden2", name: "Crystal Hollow", lat: 42.5480, lon: 1.6420, kind: "cave" },
];

export function locById(id: string): LocationDef {
  const l = LOCATIONS.find((l) => l.id === id);
  if (!l) throw new Error("unknown location " + id);
  return l;
}
export function villageById(id: string): VillageDef {
  const v = VILLAGES.find((v) => v.id === id);
  if (!v) throw new Error("unknown village " + id);
  return v;
}
