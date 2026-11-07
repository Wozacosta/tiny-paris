// Fetches north-east Paris from OpenStreetMap (Overpass) and writes a
// compact local-metre dataset to public/data/northeast.json.
//
//   node scripts/fetch-osm.mjs
//
// Data © OpenStreetMap contributors, ODbL.

import { writeFile, mkdir } from "node:fs/promises";
import { BBOX, bb, kx, ky, overpass, proj } from "./geo.mjs";
const query = `[out:json][timeout:300];
(
  way["building"](${bb});
  relation["building"](${bb});
  way["natural"="water"](${bb});
  relation["natural"="water"](${bb});
  way["leisure"~"^(park|garden|pitch)$"](${bb});
  relation["leisure"~"^(park|garden)$"](${bb});
  way["landuse"~"^(grass|village_green|flowerbed|cemetery)$"](${bb});
  relation["landuse"="cemetery"](${bb});
  way["railway"~"^(rail|light_rail|tram)$"](${bb});
  way["railway"="subway"][!"service"](${bb});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|service|footway|path|cycleway)$"](${bb});
  way["man_made"="bridge"](${bb});
  relation["man_made"="bridge"](${bb});
  node["natural"="tree"](${bb});
);
out geom(${bb});`;

const W = Math.round((BBOX.e - BBOX.w) * kx);
const H = Math.round((BBOX.n - BBOX.s) * ky);

const osm = await overpass(query);

const ptsOf = (geom) => geom.filter(Boolean).map((g) => proj(g.lon, g.lat));

// Drop a closing duplicate point and simplify collinear/duplicate points.
function cleanRing(r) {
  if (r.length > 1 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]) r = r.slice(0, -1);
  const out = [];
  for (const p of r) {
    const q = out.at(-1);
    if (q && Math.abs(q[0] - p[0]) < 3 && Math.abs(q[1] - p[1]) < 3) continue;
    out.push(p);
  }
  return out.length >= 3 ? out : null;
}

// Join relation member ways into closed rings.
function assembleRings(ways) {
  const pool = ways.filter((w) => w.length >= 2).map((w) => w.slice());
  const rings = [];
  const eq = (a, b) => a[0] === b[0] && a[1] === b[1];
  while (pool.length) {
    let ring = pool.shift();
    let grew = true;
    while (!eq(ring[0], ring.at(-1)) && grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i];
        if (eq(ring.at(-1), w[0])) ring = ring.concat(w.slice(1));
        else if (eq(ring.at(-1), w.at(-1))) ring = ring.concat(w.slice(0, -1).reverse());
        else if (eq(ring[0], w.at(-1))) ring = w.concat(ring.slice(1));
        else if (eq(ring[0], w[0])) ring = w.slice().reverse().concat(ring.slice(1));
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    // Rings clipped by the bbox may stay open; closing them is good enough.
    const c = cleanRing(ring);
    if (c) rings.push(c);
  }
  return rings;
}

// Polygon as [outer, ...holes], or several polygons for multipolygons.
function polygonsOf(el) {
  if (el.type === "way") {
    const r = cleanRing(ptsOf(el.geometry ?? []));
    return r ? [[r]] : [];
  }
  const outers = assembleRings(el.members.filter((m) => m.role !== "inner" && m.geometry).map((m) => ptsOf(m.geometry)));
  const inners = assembleRings(el.members.filter((m) => m.role === "inner" && m.geometry).map((m) => ptsOf(m.geometry)));
  const polys = outers.map((o) => [o]);
  for (const hole of inners) {
    const p = polys.find((poly) => pointInRing(hole[0], poly[0]));
    if (p) p.push(hole);
  }
  return polys;
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function centroid(ring) {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}

const inBox = ([x, y]) => Math.abs(x) <= W * 5 && Math.abs(y) <= H * 5;

function parseMetres(v) {
  if (!v) return null;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function heightOf(t) {
  const h = parseMetres(t.height);
  if (h) return h;
  const lv = parseMetres(t["building:levels"]);
  if (lv) return lv * 3.1 + (parseMetres(t["roof:levels"]) ?? 1) * 2.5;
  return null;
}

// Keep only tags worth showing in the info card.
function infoOf(t) {
  const info = {};
  for (const k of ["name", "building", "amenity", "tourism", "historic", "start_date", "building:levels", "height", "wikipedia"]) {
    if (t[k]) info[k] = t[k];
  }
  const addr = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  if (addr) info.addr = addr;
  return info;
}

const ROAD_WIDTH = {
  motorway: 14, trunk: 14, primary: 12, secondary: 10, tertiary: 8, unclassified: 6, residential: 6,
  living_street: 5, pedestrian: 6, service: 4, footway: 2.5, path: 2, cycleway: 2.5,
};

const out = {
  bbox: BBOX, size: [W, H], scale: 10,
  buildings: [], water: [], parks: [], bridges: [], roads: [], trees: [], metro: [],
};
const subwayWays = [];

for (const el of osm.elements) {
  const t = el.tags ?? {};
  if (el.type === "node") {
    const p = proj(el.lon, el.lat);
    if (t.natural === "tree") out.trees.push(p);
    continue;
  }
  if (t.railway === "subway" && el.type === "way") {
    // Elevation per way: viaducts up, tunnels down. Smoothed into ramps client-side.
    const z = t.bridge ? parseMetres(t.height) ?? 7 : t.tunnel ? -12 : 0;
    const pts = ptsOf(el.geometry ?? []);
    if (pts.length >= 2) subwayWays.push({ pts, z, line: t.ref ?? "" });
    continue;
  }
  if (t.railway && el.type === "way") {
    if (t.tunnel === "yes" || t.covered === "yes") continue;
    const pts = ptsOf(el.geometry ?? []);
    if (pts.length >= 2) out.roads.push({ w: t.railway === "tram" ? 2 : 3, k: "rail", p: pts.flat() });
    continue;
  }
  if (t.highway && el.type === "way") {
    if (t.area === "yes" || t.tunnel === "yes" || t.covered === "yes") continue;
    const pts = ptsOf(el.geometry ?? []);
    if (pts.length >= 2) out.roads.push({ w: ROAD_WIDTH[t.highway] ?? 4, k: t.highway, p: pts.flat() });
    continue;
  }
  // Covered canals (Voûte Richard-Lenoir, Voûte du Temple) and other
  // underground features aren't visible from above.
  if (!t.building && (t.tunnel || t.location === "underground" || t.covered === "yes" || parseFloat(t.layer) < 0)) continue;
  const polys = polygonsOf(el);
  if (!polys.length) continue;
  const flat = (poly) => poly.map((r) => r.flat());
  if (t.building) {
    if (t.building === "construction" || t.location === "underground") continue;
    for (const poly of polys) {
      if (!inBox(centroid(poly[0]))) continue;
      const h = heightOf(t);
      out.buildings.push({ r: flat(poly), h, i: infoOf(t) });
    }
  } else if (t.natural === "water") {
    for (const poly of polys) out.water.push(flat(poly));
  } else if (t.man_made === "bridge") {
    for (const poly of polys) out.bridges.push(flat(poly));
  } else {
    const kind = t.leisure === "pitch" ? "pitch" : t.landuse === "cemetery" ? "cemetery" : "park";
    for (const poly of polys) out.parks.push({ k: kind, r: flat(poly) });
  }
}

// Join subway ways head-to-tail into directed track chains.
{
  const key = (p) => `${p[0]},${p[1]}`;
  const byStart = new Map();
  for (const w of subwayWays) {
    const k = key(w.pts[0]);
    byStart.set(k, [...(byStart.get(k) ?? []), w]);
  }
  const hasPred = new Set(subwayWays.flatMap((w) => (byStart.get(key(w.pts.at(-1))) ?? []).map((n) => n)));
  const used = new Set();
  for (const start of [...subwayWays.filter((w) => !hasPred.has(w)), ...subwayWays]) {
    if (used.has(start)) continue;
    const pts = [], zs = [];
    let w = start;
    while (w && !used.has(w)) {
      used.add(w);
      const from = pts.length ? 1 : 0;
      for (let i = from; i < w.pts.length; i++) { pts.push(w.pts[i]); zs.push(w.z); }
      w = (byStart.get(key(w.pts.at(-1))) ?? []).find((n) => !used.has(n));
    }
    if (pts.length >= 2 && zs.some((z) => z >= 0)) out.metro.push({ line: start.line, p: pts.flat(), z: zs });
  }
}

// Strip empty info objects to save bytes.
for (const b of out.buildings) {
  if (!Object.keys(b.i).length) delete b.i;
  if (b.h == null) delete b.h;
}

await mkdir("public/data", { recursive: true });
const json = JSON.stringify(out);
await writeFile(`public/data/northeast.json`, json);
console.log(
  `wrote public/data/northeast.json (${(json.length / 1e6).toFixed(1)} MB): ` +
    `${out.buildings.length} buildings, ${out.trees.length} trees, ${out.roads.length} roads, ` +
    `${out.water.length} water, ${out.parks.length} parks, ${out.bridges.length} bridges, ` +
    `${out.metro.length} metro chains`,
);
