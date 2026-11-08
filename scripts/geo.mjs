// Area and projection shared by the data scripts.

import { readFileSync } from "node:fs";

/** Paris inside the Boulevard Périphérique, from fetch-boundary.mjs: [[lon, lat], ...]. */
export const BOUNDARY = JSON.parse(readFileSync(new URL("./boundary.json", import.meta.url), "utf8")).ring;

const lons = BOUNDARY.map((p) => p[0]), lats = BOUNDARY.map((p) => p[1]);
export const BBOX = { s: Math.min(...lats), w: Math.min(...lons), n: Math.max(...lats), e: Math.max(...lons) };
export const ENDPOINT = "https://overpass-api.de/api/interpreter";
export const bb = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;

// Equirectangular projection in decimetres, around a fixed origin: the
// centre of the first map (north-east Paris), so its world coordinates, and
// everything painted and placed in them, stay valid as the map grows.
export const ORIGIN = { lon: 2.365, lat: 48.878 };
const lat0 = ORIGIN.lat;
const lon0 = ORIGIN.lon;
const R = 6378137;
export const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180);
export const ky = (Math.PI / 180) * R;
export const proj = (lon, lat) => [Math.round((lon - lon0) * kx * 10), Math.round(-(lat - lat0) * ky * 10)];

/** Whether a lon/lat point is inside the boundary. */
export function inParis(lon, lat) {
  let inside = false;
  for (let i = 0, j = BOUNDARY.length - 1; i < BOUNDARY.length; j = i++) {
    const [xi, yi] = BOUNDARY[i], [xj, yj] = BOUNDARY[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Mirrors to fall back on when the main instance is overloaded.
const MIRRORS = [ENDPOINT, "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

export async function overpass(query) {
  let last;
  for (const url of MIRRORS) {
    console.log(`querying ${new URL(url).host}…`);
    const res = await fetch(url, {
      method: "POST",
      headers: { "User-Agent": "tiny-paris/0.1", "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));
    if (res.ok) {
      const osm = await res.json();
      console.log(`got ${osm.elements.length} elements`);
      return osm;
    }
    last = `overpass ${res.status}: ${(await res.text()).slice(0, 200)}`;
    console.warn(last);
  }
  throw new Error(last);
}
