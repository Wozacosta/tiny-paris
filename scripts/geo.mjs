// Area and projection shared by the data scripts.

// Montmartre, the canals, Buttes-Chaumont, Belleville, Père-Lachaise.
export const BBOX = { s: 48.858, w: 2.33, n: 48.898, e: 2.4 };
export const ENDPOINT = "https://overpass-api.de/api/interpreter";
export const bb = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;

// Equirectangular projection around the bbox centre, in decimetres.
const lat0 = (BBOX.s + BBOX.n) / 2;
const lon0 = (BBOX.w + BBOX.e) / 2;
const R = 6378137;
export const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180);
export const ky = (Math.PI / 180) * R;
export const proj = (lon, lat) => [Math.round((lon - lon0) * kx * 10), Math.round(-(lat - lat0) * ky * 10)];

export async function overpass(query) {
  console.log("querying overpass…");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "User-Agent": "tiny-paris/0.1", "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`overpass ${res.status}: ${await res.text()}`);
  const osm = await res.json();
  console.log(`got ${osm.elements.length} elements`);
  return osm;
}
