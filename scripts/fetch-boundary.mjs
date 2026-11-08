// The map's outline: Paris inside the Boulevard Périphérique (so without
// the Bois de Boulogne and de Vincennes), traced along the ring road's outer
// edge, from OpenStreetMap.
//   node scripts/fetch-boundary.mjs
// Writes scripts/boundary.json: { ring: [[lon, lat], ...] }.

import { writeFile } from "node:fs/promises";
import { overpass } from "./geo.mjs";

const osm = await overpass(`[out:json][timeout:120];
way["highway"~"^(motorway|trunk)$"]["name"~"Périphérique"](48.80,2.21,48.91,2.48);
out geom;`);

// Local metres around the middle of Paris.
const lat0 = 48.8586, lon0 = 2.3337, R = 6378137;
const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180), ky = (Math.PI / 180) * R;
const toM = (lon, lat) => [(lon - lon0) * kx, (lat - lat0) * ky];
const toLL = (x, y) => [lon0 + x / kx, lat0 + y / ky];

// Farthest périphérique point per half-degree around the centre: the ring
// road's outer carriageway. Segments are sampled every 10 m so long straight
// stretches still land in every bin they cross.
const BINS = 720;
const far = new Float64Array(BINS);
for (const w of osm.elements) {
  const pts = (w.geometry ?? []).filter(Boolean).map((g) => toM(g.lon, g.lat));
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 10));
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
      const b = Math.floor(((Math.atan2(y, x) / (2 * Math.PI) + 1) % 1) * BINS);
      far[b] = Math.max(far[b], Math.hypot(x, y));
    }
  }
}
// Fill any empty bin from its neighbours, then smooth lightly and push out
// 25 m so the road itself, with its verges, stays inside.
for (let b = 0; b < BINS; b++) {
  if (far[b]) continue;
  let l = b, r = b;
  while (!far[(l + BINS) % BINS]) l--;
  while (!far[r % BINS]) r++;
  far[b] = (far[(l + BINS) % BINS] + far[r % BINS]) / 2;
}
const ring = [];
for (let b = 0; b < BINS; b++) {
  let s = 0;
  for (let d = -2; d <= 2; d++) s += far[(b + d + BINS) % BINS];
  const r = s / 5 + 25, a = ((b + 0.5) / BINS) * 2 * Math.PI;
  ring.push(toLL(Math.cos(a) * r, Math.sin(a) * r).map((v) => Number(v.toFixed(6))));
}
await writeFile("scripts/boundary.json", JSON.stringify({ ring }));
const lons = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
console.log(`boundary: ${ring.length} points, lon ${Math.min(...lons)}–${Math.max(...lons)}, lat ${Math.min(...lats)}–${Math.max(...lats)}`);
