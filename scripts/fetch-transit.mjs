// Fetches RATP bus lines and Vélib' stations into public/data/paris-transit.json.
// Separate from fetch-osm.mjs so the city geometry (which the painted area is
// aligned to) doesn't change when transit is refreshed.
//
//   node scripts/fetch-transit.mjs
//
// Data © OpenStreetMap contributors, ODbL.

import { writeFile } from "node:fs/promises";
import { BBOX, bb, overpass, proj } from "./geo.mjs";

const osm = await overpass(`[out:json][timeout:180];
(
  relation["route"="bus"]["network"~"^(RATP|Noctilien)$"](${bb});
  node["amenity"="bicycle_rental"]["network"~"Vélib"](${bb});
);
out geom(${bb});`);

const ways = {};
const lines = [];
const velib = [];

for (const el of osm.elements) {
  const t = el.tags ?? {};
  if (el.type === "node") {
    velib.push({ p: proj(el.lon, el.lat), cap: Number(t.capacity) || 20, name: t.name ?? "Vélib'" });
    continue;
  }
  // Route members: the street ways the bus drives along (stops are nodes).
  const ids = [];
  for (const m of el.members) {
    if (m.type !== "way" || !m.geometry || !/^(|forward|backward)$/.test(m.role)) continue;
    const pts = m.geometry.filter(Boolean).map((g) => proj(g.lon, g.lat));
    if (pts.length < 2) continue;
    ways[m.ref] ??= pts.flat();
    ids.push(m.ref);
  }
  if (ids.length) lines.push({ ref: t.ref ?? "?", colour: t.colour ?? "#00a88f", night: t.network === "Noctilien", ways: ids });
}

// Rivers and canals as continuous centrelines, for boats. Reach a little south
// of the map so the Seine, which runs along its southern edge, is included.
const water = await overpass(`[out:json][timeout:120];
way["waterway"~"^(river|canal)$"](${BBOX.s - 0.006},${BBOX.w},${BBOX.n},${BBOX.e});
out tags geom;`);
const byName = new Map();
for (const w of water.elements) {
  const t = w.tags ?? {};
  if (t.tunnel || !t.name || /Bras/.test(t.name)) continue;
  const pts = w.geometry.filter(Boolean).map((g) => proj(g.lon, g.lat));
  if (pts.length < 2) continue;
  byName.set(t.name, [...(byName.get(t.name) ?? []), { kind: t.waterway, pts }]);
}
const waterways = [];
for (const [name, parts] of byName) {
  for (const pts of joinLines(parts.map((p) => p.pts))) waterways.push({ name, kind: parts[0].kind, p: pts.flat() });
}

/** Joins polylines that share endpoints (in either direction) into longer ones. */
function joinLines(lines) {
  const eq = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 5;
  const pool = lines.map((l) => l.slice());
  const out = [];
  while (pool.length) {
    let cur = pool.shift();
    for (let grew = true; grew; ) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i];
        if (eq(cur.at(-1), l[0])) cur = cur.concat(l.slice(1));
        else if (eq(cur.at(-1), l.at(-1))) cur = cur.concat(l.slice(0, -1).reverse());
        else if (eq(cur[0], l.at(-1))) cur = l.concat(cur.slice(1));
        else if (eq(cur[0], l[0])) cur = l.slice().reverse().concat(cur.slice(1));
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    out.push(cur);
  }
  return out;
}

// Outlines of squares where crowds gather.
const sq = await overpass(`[out:json][timeout:60];
(
  way["name"="Place de la République"]["area"="yes"](${bb});
  way["amenity"="fountain"](${bb});
);
out geom;`);
const ringOf = (w) => w.geometry.map((g) => proj(g.lon, g.lat)).flat();
const fountains = sq.elements.filter((w) => w.tags.amenity === "fountain");
const squares = sq.elements
  .filter((w) => w.tags.name === "Place de la République" && w.tags.area === "yes")
  .map((w) => ({ name: w.tags.name, p: ringOf(w), holes: fountains.map(ringOf) }));

// Each line usually exists once per direction; keep both, they share ways.
const out = { ways, lines, velib, waterways, squares };
const json = JSON.stringify(out);
await writeFile("public/data/paris-transit.json", json);
console.log(
  `wrote public/data/paris-transit.json (${(json.length / 1e6).toFixed(1)} MB): ` +
    `${lines.length} bus line directions (${new Set(lines.map((l) => l.ref)).size} lines), ` +
    `${Object.keys(ways).length} ways, ${velib.length} Vélib' stations, ` +
    `waterways: ${waterways.map((w) => `${w.name} (${w.p.length / 2} pts)`).join(", ")}, squares: ${squares.length}`,
);
