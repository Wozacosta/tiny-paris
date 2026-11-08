// Builds Paris inside the périphérique from an OpenStreetMap extract and
// writes a compact local-metre dataset to public/data/paris.json, and its
// origin and outline to public/data/paris-meta.json.
//
//   node scripts/fetch-osm.mjs
//
// Uses Geofabrik's Île-de-France extract and osmium (brew install
// osmium-tool): Overpass is far too slow for a city this size.
// Data © OpenStreetMap contributors, ODbL.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { BBOX, BOUNDARY, ORIGIN, inParis, proj } from "./geo.mjs";

const DIR = "paint/osm";
const PBF = `${DIR}/ile-de-france.osm.pbf`;
await mkdir(DIR, { recursive: true });
if (!existsSync(PBF)) {
  console.log("downloading the Île-de-France extract…");
  execFileSync("curl", ["-sL", "-o", PBF, "https://download.geofabrik.de/europe/france/ile-de-france-latest.osm.pbf"], { stdio: "inherit" });
}
const m = 0.003;
const run = (...args) => execFileSync("osmium", args, { stdio: ["ignore", "ignore", "inherit"] });
run("extract", "-b", `${BBOX.w - m},${BBOX.s - m},${BBOX.e + m},${BBOX.n + m}`, "--strategy", "smart", "-O", "-o", `${DIR}/paris.osm.pbf`, PBF);
run("tags-filter", "-O", "-o", `${DIR}/paris-f.osm.pbf`, `${DIR}/paris.osm.pbf`,
  "w/building", "r/building", "w/natural=water", "r/natural=water", "w/leisure=park,garden,pitch", "r/leisure=park,garden",
  "w/landuse=grass,village_green,flowerbed,cemetery", "r/landuse=cemetery", "w/railway=rail,light_rail,tram,subway",
  "w/highway=motorway,trunk,primary,secondary,tertiary,unclassified,residential,living_street,pedestrian,service,footway,path,cycleway",
  "w/man_made=bridge", "r/man_made=bridge", "n/natural=tree");
run("export", "-O", "-f", "geojsonseq", "--geometry-types=point,linestring,polygon", "-o", `${DIR}/paris.geojsonseq`, `${DIR}/paris-f.osm.pbf`);

// Features as { tags, kind: "point" | "line" | "area", coords }.
const features = [];
for (const line of readFileSync(`${DIR}/paris.geojsonseq`, "utf8").split("\x1e")) {
  if (!line.trim()) continue;
  const f = JSON.parse(line);
  const g = f.geometry;
  if (g.type === "Point") features.push({ tags: f.properties, kind: "point", coords: g.coordinates });
  else if (g.type === "LineString") features.push({ tags: f.properties, kind: "line", coords: g.coordinates });
  else if (g.type === "Polygon") features.push({ tags: f.properties, kind: "area", coords: [g.coordinates] });
  else if (g.type === "MultiPolygon") features.push({ tags: f.properties, kind: "area", coords: g.coordinates });
}

// Keep what's in Paris: things with a point inside the boundary (ground
// layers are clipped to it when drawn), buildings and trees by their centre.
const kept = features.filter((f) => {
  if (f.kind === "point") return inParis(...f.coords);
  const pts = f.kind === "line" ? f.coords : f.coords.flatMap((poly) => poly[0]);
  if (!f.tags.building) return pts.some(([lon, lat]) => inParis(lon, lat));
  return inParis(pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length);
});

const boundary = BOUNDARY.map(([lon, lat]) => proj(lon, lat));
const xs = boundary.map((p) => p[0] / 10), ys = boundary.map((p) => p[1] / 10);
const bounds = [Math.floor(Math.min(...xs)), Math.floor(Math.min(...ys)), Math.ceil(Math.max(...xs)), Math.ceil(Math.max(...ys))];

const ptsOf = (coords) => coords.map(([lon, lat]) => proj(lon, lat));

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
  // World metres (×scale) around `origin`; `bounds` in metres; `boundary` the outline.
  bbox: BBOX, origin: ORIGIN, bounds, boundary: boundary.flat(), scale: 10,
  buildings: [], water: [], parks: [], bridges: [], roads: [], trees: [], metro: [],
};
const subwayWays = [];

for (const f of kept) {
  const t = f.tags;
  if (f.kind === "point") {
    if (t.natural === "tree") out.trees.push(proj(...f.coords));
    continue;
  }
  if (f.kind === "line") {
    const pts = ptsOf(f.coords);
    if (pts.length < 2) continue;
    if (t.railway === "subway") {
      if (t.service) continue;
      // Elevation per way: viaducts up, tunnels down. Smoothed into ramps client-side.
      const z = t.bridge ? parseMetres(t.height) ?? 7 : t.tunnel ? -12 : 0;
      subwayWays.push({ pts, z, line: t.ref ?? "" });
    } else if (t.railway) {
      if (t.tunnel === "yes" || t.covered === "yes") continue;
      out.roads.push({ w: t.railway === "tram" ? 2 : 3, k: "rail", p: pts.flat() });
    } else if (t.highway) {
      if (t.area === "yes" || t.tunnel === "yes" || t.covered === "yes") continue;
      out.roads.push({ w: ROAD_WIDTH[t.highway] ?? 4, k: t.highway, p: pts.flat() });
    }
    continue;
  }
  // Covered canals (Voûte Richard-Lenoir, Voûte du Temple) and other
  // underground features aren't visible from above.
  if (!t.building && (t.tunnel || t.location === "underground" || t.covered === "yes" || parseFloat(t.layer) < 0)) continue;
  if (t.highway || t.railway) continue;
  const polys = f.coords.map((poly) => poly.map((r) => cleanRing(ptsOf(r))).filter(Boolean)).filter((p) => p.length);
  if (!polys.length) continue;
  const flat = (poly) => poly.map((r) => r.flat());
  if (t.building) {
    // Building sites are usually just hoardings, but ones mapped with a
    // height are towers about to open (the Tour Triangle): keep those.
    if ((t.building === "construction" && !parseMetres(t.height)) || t.location === "underground") continue;
    for (const poly of polys) out.buildings.push({ r: flat(poly), h: heightOf(t), i: infoOf(t) });
  } else if (t.natural === "water") {
    for (const poly of polys) out.water.push(flat(poly));
  } else if (t.man_made === "bridge") {
    for (const poly of polys) out.bridges.push(flat(poly));
  } else if (t.leisure || t.landuse) {
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
await writeFile(`public/data/paris.json`, json);
// The few kB the app needs to show the painting before the rest arrives.
await writeFile(`public/data/paris-meta.json`, JSON.stringify({ origin: out.origin, scale: out.scale, boundary: out.boundary }));
console.log(
  `wrote public/data/paris.json (${(json.length / 1e6).toFixed(1)} MB): ` +
    `${out.buildings.length} buildings, ${out.trees.length} trees, ${out.roads.length} roads, ` +
    `${out.water.length} water, ${out.parks.length} parks, ${out.bridges.length} bridges, ` +
    `${out.metro.length} metro chains`,
);
