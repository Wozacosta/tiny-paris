// The search box at the top of the Go to list: the landmarks, the buildings
// on the map with a name or an address, and any address from the IGN
// Géoplateforme geocoder (the national address base: free, no key).

/** Lower case, no accents, punctuation as spaces: "Saint-Jean de l'Île" → "saint jean de l ile". */
export function fold(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Abbreviations people type, as the names spell them. */
const SHORT: Record<string, string> = { st: "saint", ste: "sainte", bd: "boulevard", bld: "boulevard", av: "avenue", pl: "place", fbg: "faubourg" };

/** A query as the words to look for: each must start a word of the name (numbers must be whole). */
export function queryWords(q: string) {
  return fold(q).split(" ").filter(Boolean).map((w) => SHORT[w] ?? w);
}

/** How well `text` (folded) matches: lower is better, null for no match. */
export function rank(text: string, words: string[]) {
  if (!words.length) return null;
  const t = ` ${text} `;
  if (!words.every((w) => t.includes(/^\d+$/.test(w) ? ` ${w} ` : ` ${w}`))) return null;
  // Names that start with the query first, then the shorter ones.
  return (t.startsWith(` ${words[0]}`) ? 0 : 1000) + text.length;
}

/** "75003" → "3e", "75001" → "1er"; other towns by name. */
export function placeNote(postcode: string, city: string) {
  const m = /^75(?:0(\d\d)|1(16))$/.exec(postcode);
  if (!m) return city;
  const n = Number(m[1] ?? m[2]);
  return n === 1 ? "1er" : `${n}e`;
}

export interface Address {
  label: string;
  note: string;
  lon: number;
  lat: number;
  /** A house number, rather than a street or a town. */
  house: boolean;
  /** How close to fly: a house closer than a street, a street closer than a town. */
  zoom: number;
}

const ZOOM: Record<string, number> = { housenumber: 4, street: 2.6, locality: 3, municipality: 1.4 };

/** Addresses and streets matching `q`, nearest `near` (lon, lat) first among equals. */
export async function findAddresses(q: string, near: [number, number], signal: AbortSignal): Promise<Address[]> {
  const params = new URLSearchParams({ q, index: "address", limit: "10", lon: near[0].toFixed(4), lat: near[1].toFixed(4) });
  const res = await fetch(`https://data.geopf.fr/geocodage/search?${params}`, { signal });
  if (!res.ok) return [];
  const json: { features?: { geometry: { coordinates: [number, number] }; properties: Record<string, string> }[] } = await res.json();
  return (json.features ?? []).map(({ geometry, properties: p }) => ({
    label: p.type === "municipality" ? p.city : p.name,
    note: placeNote(p.postcode ?? "", p.city ?? ""),
    lon: geometry.coordinates[0],
    lat: geometry.coordinates[1],
    house: p.type === "housenumber",
    zoom: ZOOM[p.type] ?? 3,
  }));
}
