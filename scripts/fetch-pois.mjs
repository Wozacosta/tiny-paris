// Cafés, bars and restaurants (for terraces) from OpenStreetMap.
//   node scripts/fetch-pois.mjs
// Writes public/data/paris-pois.json: { cafes: [[x, y, kind, outdoor], …] } in decimetres.

import { writeFile } from "node:fs/promises";
import { bb, inParis, overpass, proj } from "./geo.mjs";

const osm = await overpass(`[out:json][timeout:120];
(
  node["amenity"~"^(cafe|bar|pub|restaurant)$"](${bb});
);
out;`);

const KIND = { cafe: 0, bar: 1, pub: 1, restaurant: 2 };
const cafes = osm.elements.filter((e) => inParis(e.lon, e.lat)).map((e) => {
  const [x, y] = proj(e.lon, e.lat);
  const outdoor = e.tags.outdoor_seating === "yes" ? 1 : e.tags.outdoor_seating === "no" ? -1 : 0;
  return [x, y, KIND[e.tags.amenity], outdoor];
});
await writeFile("public/data/paris-pois.json", JSON.stringify({ cafes }));
console.log(`${cafes.length} cafés, bars and restaurants`);
